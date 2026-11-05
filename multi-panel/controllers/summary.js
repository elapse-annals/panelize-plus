/**
 * Owns summary behavior and its page-local state.
 * Deferred controller getters keep composition in the entry point.
 */
import { isProviderAllowedUrl } from '../../modules/providers/provider-open-url.js';
import {
  AI_SUMMARY_API_KEY_STORAGE_KEY,
  AI_SUMMARY_TIMEOUT_ERROR,
  buildSummaryMessages,
  formatSummaryText,
  groupItemsBySources,
  getSummaryOriginPattern,
  hasSummaryContent,
  isRetryableSummaryError,
  isRoundReadyForAutoSummary,
  isRoundReadyForSummary,
  isStronglySupported,
  isSummaryConfigured,
  parseSummaryResponse,
  pickAnchorText,
  replaceSourceIds,
  requestSummary,
  shouldExpandSummary
} from '../../modules/answers/ai-summary.js';
import {
  AI_SUMMARY_ACTIVE_PROFILE_STORAGE_KEY,
  AI_SUMMARY_API_KEYS_STORAGE_KEY,
  AI_SUMMARY_PROFILES_STORAGE_KEY,
  getAiSummaryProfileLabel,
  loadAiSummarySetup,
  resolveAiSummaryConfig,
  saveAiSummaryActiveProfileId
} from '../../modules/answers/ai-summary-profiles.js';
import { parseOverviewBlocks, renderOverviewBlocks } from '../../modules/answers/ai-summary-overview.js';
import {
  createAiSummaryCacheEntry,
  loadAiSummaryCache,
  matchAiSummaryCache,
  saveAiSummaryCacheEntry
} from '../../modules/answers/ai-summary-cache.js';
import { getLocalizedText, showToast } from './ui.js';
import { PANELIZE_GET_ANSWER_TEXT, PANELIZE_LOCATE_ANSWER_TEXT } from './protocol.js';

export function createSummaryController({
  getAnswersController,
  getPanelsController,
  getPresentationController,
  getSharingController
}) {
  const AI_SUMMARY_LOCATE_TIMEOUT_MS = 1500;

  // How long a summary asked for by hand waits for panels to report their answer.
  const AI_SUMMARY_COLLECT_TIMEOUT_MS = 1500;

  // How often the running summary's elapsed time is refreshed.
  const AI_SUMMARY_PROGRESS_INTERVAL_MS = 1000;

  const aiSummaryConfig = { autoEnabled: false, baseUrl: '', model: '', apiKey: '' };

  // Profiles keep their metadata in sync storage; keys are this device's only.
  let aiSummaryProfiles = [];

  let aiSummaryApiKeys = {};

  let aiSummaryActiveProfileId = '';

  let aiSummarySetupLoadId = 0;

  const autoSummarizedRoundIds = new Set();

  const remindedAiSummaryRoundIds = new Set();

  const pendingAnswerTextRequests = new Map();

  const pendingLocateAnswerRequests = new Map();

  // status: 'idle', 'collecting', 'running', 'done' or 'error'.
  let aiSummaryState = {
    roundId: null,
    status: 'idle',
    sources: [],
    missing: [],
    summary: null,
    error: '',
    needsSetup: false,
    fromCache: false,
    cachedAt: null
  };

  let aiSummaryController = null;

  async function reloadAiSummarySetup() {
    const loadId = ++aiSummarySetupLoadId;
    try {
      const state = await loadAiSummarySetup();
      // A later reload won; discard this response so an older storage read
      // cannot overwrite the newest profile list.
      if (loadId !== aiSummarySetupLoadId) {
        return;
      }
      aiSummaryProfiles = state.profiles;
      aiSummaryApiKeys = state.apiKeys;
      aiSummaryActiveProfileId = state.activeProfileId;
      applyAiSummaryProfileConfig();
    } catch (error) {
      console.warn('[Multi-Panel] Failed to load the AI summary profiles:', error);
    }
  }

  function applyAiSummaryProfileConfig() {
    const config = resolveAiSummaryConfig(aiSummaryProfiles, aiSummaryApiKeys, aiSummaryActiveProfileId);
    aiSummaryActiveProfileId = config.profileId || '';
    aiSummaryConfig.baseUrl = config.baseUrl;
    aiSummaryConfig.model = config.model;
    aiSummaryConfig.apiKey = config.apiKey;
    renderAiSummaryProfileSelect();
  }

  function renderAiSummaryProfileSelect() {
    const select = document.getElementById('ai-summary-profile-select');
    if (!select) {
      return;
    }
    if (aiSummaryProfiles.length === 0) {
      select.replaceChildren();
      select.hidden = true;
      select.disabled = true;
      return;
    }
    const options = aiSummaryProfiles.map(profile => {
      const option = document.createElement('option');
      option.value = profile.id;
      const label = getAiSummaryProfileLabel(profile) || profile.id;
      const configured = isSummaryConfigured({
        baseUrl: profile.baseUrl,
        model: profile.model,
        apiKey: aiSummaryApiKeys[profile.id] || ''
      });
      option.textContent = configured
        ? label
        : `${label} — ${getLocalizedText('aiSummaryProfileUnconfigured', 'Not set up')}`;
      return option;
    });
    select.replaceChildren(...options);
    select.value = aiSummaryActiveProfileId || aiSummaryProfiles[0].id;
    select.hidden = false;
    select.disabled = aiSummaryProfiles.length <= 1;
  }

  function chooseAiSummaryProfile(profileId) {
    const profile = aiSummaryProfiles.find(candidate => candidate.id === profileId);
    if (!profile) {
      return;
    }
    // Switching changes only the next summary; the current result stays.
    aiSummaryActiveProfileId = profile.id;
    aiSummaryConfig.baseUrl = profile.baseUrl;
    aiSummaryConfig.model = profile.model;
    aiSummaryConfig.apiKey = aiSummaryApiKeys[profile.id] || '';
    void saveAiSummaryActiveProfileId(profile.id).catch((error) => {
      console.warn('[Multi-Panel] Failed to save the AI summary profile:', error);
    });
  }

  function applyAiSummaryConfigChanges(changes, areaName) {
    if (changes.aiSummaryAutoEnabled) aiSummaryConfig.autoEnabled = changes.aiSummaryAutoEnabled.newValue === true;

    const profilesChanged = changes[AI_SUMMARY_PROFILES_STORAGE_KEY]
      || changes[AI_SUMMARY_ACTIVE_PROFILE_STORAGE_KEY]
      || changes.aiSummaryBaseUrl
      || changes.aiSummaryModel
      || (areaName === 'local' && (changes[AI_SUMMARY_API_KEYS_STORAGE_KEY] || changes[AI_SUMMARY_API_KEY_STORAGE_KEY]));
    if (profilesChanged) {
      void reloadAiSummarySetup();
    }
  }

  // The drawer grows out of the toolbar button and shrinks back into it.
  const AI_SUMMARY_OPEN_MS = 420;

  const AI_SUMMARY_CLOSE_MS = 280;

  // With at least this many summarized AIs, a point all of them back shows one
  // "All N AIs" badge instead of a chip per AI.
  const AI_SUMMARY_ALL_SOURCES_MIN = 3;

  let aiSummaryDrawerAnimation = null;

  // Counts real closes, so an automatic summary that finishes later does not
  // reopen a drawer the user closed while it was running.
  let aiSummaryDrawerCloseCount = 0;

  function isAiSummaryDrawerOpen() {
    const drawer = document.getElementById('ai-summary-drawer');
    return drawer?.hidden === false && !drawer.classList.contains('ai-summary-closing');
  }

  // Keyframes that place the drawer at the button, scaled down to a dot.
  function getAiSummaryCollapsedFrame(drawer) {
    const button = document.getElementById('ai-summary-btn');
    const drawerRect = drawer.getBoundingClientRect();
    const buttonRect = button?.getBoundingClientRect();
    if (buttonRect && buttonRect.width) {
      const x = buttonRect.left + buttonRect.width / 2 - drawerRect.left;
      const y = buttonRect.top + buttonRect.height / 2 - drawerRect.top;
      drawer.style.transformOrigin = `${x}px ${y}px`;
    } else {
      drawer.style.transformOrigin = 'top right';
    }
    return { transform: 'scale(0.04)', opacity: 0, borderRadius: '50vh', filter: 'blur(8px)' };
  }

  function animateAiSummaryDrawer(drawer, opening) {
    aiSummaryDrawerAnimation?.cancel();
    aiSummaryDrawerAnimation = null;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion || typeof drawer.animate !== 'function') {
      return null;
    }
    const collapsed = getAiSummaryCollapsedFrame(drawer);
    const expanded = { transform: 'scale(1)', opacity: 1, borderRadius: getComputedStyle(drawer).borderRadius, filter: 'blur(0)' };
    const frames = opening
      ? [collapsed, { ...expanded, transform: 'scale(1.012)', offset: 0.72 }, expanded]
      : [expanded, { ...collapsed, opacity: 0.6, offset: 0.7 }, collapsed];
    aiSummaryDrawerAnimation = drawer.animate(frames, {
      duration: opening ? AI_SUMMARY_OPEN_MS : AI_SUMMARY_CLOSE_MS,
      easing: opening ? 'cubic-bezier(0.2, 0.9, 0.25, 1)' : 'cubic-bezier(0.5, 0, 0.75, 0)'
    });
    return aiSummaryDrawerAnimation;
  }

  function openAiSummaryDrawer() {
    const drawer = document.getElementById('ai-summary-drawer');
    if (!drawer || isAiSummaryDrawerOpen()) return;
    drawer.classList.remove('ai-summary-closing');
    drawer.hidden = false;
    const button = document.getElementById('ai-summary-btn');
    button?.setAttribute('aria-expanded', 'true');
    button?.classList.remove('ai-summary-ready');
    renderAiSummary();
    animateAiSummaryDrawer(drawer, true);
  }

  function closeAiSummaryDrawer() {
    const drawer = document.getElementById('ai-summary-drawer');
    if (!drawer || !isAiSummaryDrawerOpen()) return;
    aiSummaryDrawerCloseCount += 1;
    const button = document.getElementById('ai-summary-btn');
    button?.setAttribute('aria-expanded', 'false');
    const finish = () => {
      drawer.classList.remove('ai-summary-closing');
      drawer.hidden = true;
      // The button gives a little bounce as it takes the drawer in.
      button?.classList.remove('ai-summary-absorb');
      void button?.offsetWidth;
      button?.classList.add('ai-summary-absorb');
    };
    const animation = animateAiSummaryDrawer(drawer, false);
    if (!animation) {
      finish();
      return;
    }
    drawer.classList.add('ai-summary-closing');
    // A cancelled close (the drawer reopened) leaves the drawer showing.
    animation.addEventListener('finish', () => {
      if (aiSummaryDrawerAnimation === animation) aiSummaryDrawerAnimation = null;
      finish();
    });
  }

  // A finished summary picks the width by its length (see shouldExpandSummary);
  // a manual toggle holds until the next summary and across openings.
  function setAiSummaryExpanded(expanded) {
    document.getElementById('ai-summary-drawer')?.classList.toggle('ai-summary-expanded', expanded);
    const button = document.getElementById('ai-summary-expand-btn');
    if (!button) return;
    const label = expanded
      ? getLocalizedText('aiSummaryShrink', 'Shrink')
      : getLocalizedText('aiSummaryExpand', 'Expand');
    button.setAttribute('aria-pressed', String(expanded));
    button.title = label;
    button.setAttribute('aria-label', label);
    button.querySelector('.material-symbols-outlined').textContent = expanded ? 'close_fullscreen' : 'open_in_full';
  }

  function toggleAiSummaryExpanded() {
    const drawer = document.getElementById('ai-summary-drawer');
    setAiSummaryExpanded(!drawer?.classList.contains('ai-summary-expanded'));
  }

  // Clicks on empty space or text toggle the width; controls, source chips and
  // finishing a text selection do not.
  function handleAiSummaryDrawerClick(event) {
    const drawer = event.currentTarget;
    if (drawer.classList.contains('ai-summary-closing')) return;
    const target = event.target;
    if (target instanceof Element && target.closest('button, a, input, textarea, select, .ai-summary-source')) return;
    const selection = window.getSelection?.();
    if (selection && !selection.isCollapsed && drawer.contains(selection.anchorNode)) return;
    toggleAiSummaryExpanded();
  }

  function toggleAiSummaryDrawer() {
    if (isAiSummaryDrawerOpen()) {
      closeAiSummaryDrawer();
      return;
    }
    openAiSummaryDrawer();
    // Summarize the latest round unless it is already summarized or running.
    if (getAnswersController().latestAnswerRoundId && (aiSummaryState.roundId !== getAnswersController().latestAnswerRoundId
      || ['idle', 'error'].includes(aiSummaryState.status))) {
      void runAiSummary(getAnswersController().latestAnswerRoundId, { collect: true });
    }
  }

  // A new question replaces the summary of the previous one.
  function startAiSummaryRound(roundId) {
    aiSummaryController?.abort();
    aiSummaryController = null;
    aiSummaryState = {
      roundId,
      status: 'idle',
      sources: [],
      missing: [],
      summary: null,
      error: '',
      needsSetup: false,
      fromCache: false,
      cachedAt: null
    };
    document.getElementById('ai-summary-btn')?.classList.remove('ai-summary-ready');
    updateAiSummaryButtonBusy();
    renderAiSummary();
  }

  // A ring spins around the button while answers are read or summarized, and
  // turns green once the summary is done.
  function updateAiSummaryButtonBusy() {
    const busy = ['collecting', 'running'].includes(aiSummaryState.status);
    const button = document.getElementById('ai-summary-btn');
    button?.classList.toggle('ai-summary-busy', busy);
    button?.classList.toggle('ai-summary-done', aiSummaryState.status === 'done');
    button?.setAttribute('aria-busy', String(busy));
  }

  function maybeAutoSummarize(roundId) {
    const round = getAnswersController().answerRounds.get(roundId);
    if (!aiSummaryConfig.autoEnabled || roundId !== getAnswersController().latestAnswerRoundId || autoSummarizedRoundIds.has(roundId)
      || !isSummaryConfigured(aiSummaryConfig) || !isRoundReadyForAutoSummary(round, getRoundAnswerTexts(round))) {
      return;
    }
    autoSummarizedRoundIds.add(roundId);
    // The drawer opens only once there is a summary to read (see runAiSummary).
    void runAiSummary(roundId, { autoOpen: true });
  }

  // Rings the AI summary button once the latest round is ready and the drawer is
  // closed, so a finished comparison is not missed. Needs a configured API.
  function maybeRemindAiSummary(roundId) {
    const round = getAnswersController().answerRounds.get(roundId);
    if (roundId !== getAnswersController().latestAnswerRoundId || remindedAiSummaryRoundIds.has(roundId)
      || autoSummarizedRoundIds.has(roundId) || isAiSummaryDrawerOpen()
      || !isSummaryConfigured(aiSummaryConfig) || !isRoundReadyForSummary(round, getRoundAnswerTexts(round))) {
      return;
    }
    remindedAiSummaryRoundIds.add(roundId);
    document.getElementById('ai-summary-btn')?.classList.add('ai-summary-ready');
  }

  // Texts of the panels still showing the round's answer.
  function getRoundAnswerTexts(round) {
    const texts = new Map();
    const stored = getAnswersController().answerTextsByRound.get(round?.id);
    getPanelsController().panels.forEach(panel => {
      const text = stored?.get(panel.id);
      if (text && getAnswersController().isPanelInAnswerRound(round, panel)) texts.set(panel.id, text);
    });
    return texts;
  }

  function handleAnswerTextMessage(panel, data) {
    const request = pendingAnswerTextRequests.get(data.requestId);
    if (!request || request.panelId !== panel.id) {
      return;
    }
    pendingAnswerTextRequests.delete(data.requestId);
    request.resolve(typeof data.text === 'string' ? data.text.trim() : '');
  }

  function requestPanelAnswerText(panel) {
    const requestId = `ai-summary-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise(resolve => {
      pendingAnswerTextRequests.set(requestId, { panelId: panel.id, resolve });
      setTimeout(() => {
        if (pendingAnswerTextRequests.delete(requestId)) resolve('');
      }, AI_SUMMARY_COLLECT_TIMEOUT_MS);
      panel.iframe?.contentWindow?.postMessage({
        type: PANELIZE_GET_ANSWER_TEXT,
        requestId,
        context: 'multi-panel'
      }, '*');
    });
  }

  function handleLocateAnswerResult(panel, data) {
    const request = pendingLocateAnswerRequests.get(data.requestId);
    if (!request || request.panelId !== panel.id) return;
    clearTimeout(request.timeoutId);
    pendingLocateAnswerRequests.delete(data.requestId);
    request.resolve(data.found === true);
  }

  function requestPanelAnswerLocation(panel, anchor) {
    const frame = panel.iframe?.contentWindow;
    const targetUrl = panel.currentUrl || panel.iframe?.src;
    if (!frame || !isProviderAllowedUrl(panel.providerId, targetUrl)) return Promise.resolve(false);
    const requestId = `ai-summary-locate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise(resolve => {
      const timeoutId = setTimeout(() => {
        pendingLocateAnswerRequests.delete(requestId);
        resolve(false);
      }, AI_SUMMARY_LOCATE_TIMEOUT_MS);
      pendingLocateAnswerRequests.set(requestId, { panelId: panel.id, timeoutId, resolve });
      try {
        frame.postMessage({ type: PANELIZE_LOCATE_ANSWER_TEXT, context: 'multi-panel', requestId, anchor }, new URL(targetUrl).origin);
      } catch {
        clearTimeout(timeoutId);
        pendingLocateAnswerRequests.delete(requestId);
        resolve(false);
      }
    });
  }

  // Asks panels whose timing missed the answer for their last answer.
  async function collectRoundAnswerTexts(round) {
    const texts = getRoundAnswerTexts(round);
    const missingPanels = getPanelsController().panels.filter(panel => getAnswersController().isPanelInAnswerRound(round, panel) && !texts.has(panel.id));
    const replies = await Promise.all(missingPanels.map(requestPanelAnswerText));
    missingPanels.forEach((panel, index) => {
      if (replies[index]) {
        texts.set(panel.id, replies[index]);
        getAnswersController().answerTextsByRound.get(round.id)?.set(panel.id, replies[index]);
      }
    });
    return texts;
  }

  function isAiSummaryRoundBlind(round) {
    return round?.blind === true || getPresentationController().isBlindModeEnabled;
  }

  // Source labels follow the on-screen order. Blind rounds number the panels
  // instead of naming them, so the summary never reveals an AI.
  function getAiSummarySourceLabel(source, round) {
    if (isAiSummaryRoundBlind(round)) {
      return `${getLocalizedText('blindPanelLabel', 'Anonymous model')} ${source.position}`;
    }
    const panel = getPanelsController().panels.find(candidate => candidate.id === source.panelId);
    return panel ? getPresentationController().getPanelDisplayName(panel, { blind: false }) : source.panelId;
  }

  function getRoundSummaryPanels(round) {
    return getPresentationController().getDisplayedPanels()
      .map((panel, index) => ({ panel, position: index + 1 }))
      .filter(({ panel }) => getAnswersController().isPanelInAnswerRound(round, panel));
  }

  async function runAiSummary(roundId, { collect = false, autoOpen = false, forceRefresh = false } = {}) {
    const round = getAnswersController().answerRounds.get(roundId);
    if (!round) {
      return;
    }
    // A profile switch while this run is in flight must not change what it
    // asks for or what it writes to the cache.
    const config = { ...aiSummaryConfig };
    aiSummaryController?.abort();
    const controller = new AbortController();
    aiSummaryController = controller;
    const isCurrent = () => aiSummaryController === controller;
    const drawerCloseCountAtStart = aiSummaryDrawerCloseCount;
    const setState = (state) => {
      if (!isCurrent()) return;
      aiSummaryState = {
        roundId,
        sources: [],
        missing: [],
        summary: null,
        error: '',
        needsSetup: false,
        fromCache: false,
        cachedAt: null,
        ...state
      };
      updateAiSummaryButtonBusy();
      renderAiSummary();
    };

    setState({ status: 'collecting' });
    const texts = collect ? await collectRoundAnswerTexts(round) : getRoundAnswerTexts(round);
    if (!isCurrent()) return;

    const sources = [];
    const missing = [];
    getRoundSummaryPanels(round).forEach(({ panel, position }) => {
      const source = { panelId: panel.id, position, sourceId: `S${sources.length + 1}` };
      if (texts.get(panel.id)) {
        sources.push(source);
      } else {
        missing.push({ ...source, sourceId: '' });
      }
    });
    if (sources.length === 0) {
      setState({ status: 'error', missing, error: getLocalizedText('aiSummaryNoAnswers', 'No answer could be read from the panels yet.') });
      return;
    }

    const question = (getAnswersController().answerQuestionsByRound.get(roundId) || round.promptSummary || '').trim();
    const language = getSharingController().getSnapshotLocale();
    const summaryPanels = sources.map(source => {
      const panel = getPanelsController().panels.find(candidate => candidate.id === source.panelId);
      return { position: source.position, providerId: panel?.providerId || '' };
    });

    // The same question within three days reuses its finished summary; a manual
    // rerun always asks the API again.
    if (!forceRefresh && question) {
      const cached = matchAiSummaryCache(await loadAiSummaryCache(), {
        question,
        baseUrl: config.baseUrl,
        model: config.model,
        language,
        panels: summaryPanels
      });
      if (!isCurrent()) return;
      if (cached) {
        setState({
          status: 'done',
          sources,
          missing,
          summary: cached.summary,
          fromCache: true,
          cachedAt: cached.createdAt
        });
        if (isCurrent()) setAiSummaryExpanded(shouldExpandSummary(cached.summary));
        // A cached hit never opens the drawer by itself; ring the button so the
        // user can read it when they choose.
        if (autoOpen) document.getElementById('ai-summary-btn')?.classList.add('ai-summary-ready');
        return;
      }
    }

    if (!isSummaryConfigured(config)) {
      setState({ status: 'error', needsSetup: true, error: getLocalizedText('aiSummaryNotConfigured', 'Set up an OpenAI-compatible API in Settings to summarize answers.') });
      return;
    }

    try {
      const granted = await chrome.permissions.contains({ origins: [getSummaryOriginPattern(config.baseUrl)] });
      if (!granted) {
        setState({ status: 'error', needsSetup: true, missing, error: getLocalizedText('aiSummaryNoPermission', 'Panelize has no access to the API site. Use Save and test in Settings to allow it.') });
        return;
      }
    } catch (error) {
      console.warn('[Multi-Panel] Could not check AI summary access:', error);
    }

    setState({ status: 'running', sources, missing, startedAt: Date.now(), receivedChars: 0 });
    // Re-renders once a second so the elapsed time and received text keep moving.
    const progressTimerId = setInterval(() => {
      if (isCurrent() && aiSummaryState.status === 'running') renderAiSummary();
    }, AI_SUMMARY_PROGRESS_INTERVAL_MS);
    try {
      const messages = buildSummaryMessages({
        question,
        answers: sources.map(source => ({
          sourceId: source.sourceId,
          label: getAiSummarySourceLabel(source, round),
          text: texts.get(source.panelId)
        })),
        language
      });
      const content = await requestSummary({
        config,
        messages,
        signal: controller.signal,
        onProgress: (receivedChars) => {
          if (isCurrent() && aiSummaryState.status === 'running') aiSummaryState.receivedChars = receivedChars;
        }
      });
      const summary = parseSummaryResponse(content, sources.map(source => source.sourceId));
      if (!hasSummaryContent(summary)) {
        // A reply that parsed to nothing is no result: keep the drawer closed
        // for an automatic summary and report it when the user asks.
        setState({ status: 'error', sources, missing, error: getLocalizedText('aiSummaryEmpty', 'The summary came back empty. Try again or use another model.') });
        return;
      }
      void saveAiSummaryCacheEntry(createAiSummaryCacheEntry({
        question,
        config,
        language,
        panels: summaryPanels,
        sources,
        summary
      }));
      setState({ status: 'done', sources, missing, summary });
      // Each finished summary picks the drawer width by how much it says.
      if (isCurrent()) setAiSummaryExpanded(shouldExpandSummary(summary));
      // An automatic summary opens the drawer only now, and not if the user
      // closed it while this summary was running.
      if (autoOpen && isCurrent() && aiSummaryDrawerCloseCount === drawerCloseCountAtStart) openAiSummaryDrawer();
    } catch (error) {
      if (controller.signal.aborted && !isCurrent()) return;
      console.warn('[Multi-Panel] AI summary failed:', error);
      setState({
        status: 'error',
        sources,
        missing,
        error: error?.message === AI_SUMMARY_TIMEOUT_ERROR
          ? getLocalizedText('aiSummaryTimedOut', 'The summary timed out: the API sent nothing for a long time. Try again or use a faster model.')
          : isRetryableSummaryError(error)
            ? getLocalizedText('aiSummaryBusy', 'The summary API is busy and still failed after retries. Try again later or use another model. ($1)', [error.message])
            : getLocalizedText('aiSummaryFailed', 'Summary failed: $1', [error?.message || String(error)])
      });
    } finally {
      clearInterval(progressTimerId);
      if (isCurrent()) aiSummaryController = null;
    }
  }

  function createAiSummarySourceChips(sources, sourcesById, round, item) {
    return sources.map(sourceId => sourcesById.get(sourceId)).filter(Boolean).map(source => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'ai-summary-source';
      chip.textContent = getAiSummarySourceLabel(source, round);
      chip.title = getLocalizedText('aiSummaryJumpToPanel', 'Go to this panel');
      chip.addEventListener('click', () => {
        const panel = getPanelsController().panels.find(candidate => candidate.id === source.panelId);
        const position = getPresentationController().getDisplayedPanels().findIndex(candidate => candidate.id === source.panelId) + 1;
        getPresentationController().jumpToPanel(position);
        if (!getAnswersController().isPanelInAnswerRound(round, panel)) return;
        const answerText = getRoundAnswerTexts(round).get(panel.id);
        const anchor = pickAnchorText(item?.topic ? { ...item, text: item.topic } : item, source.sourceId, answerText);
        if (anchor) void requestPanelAnswerLocation(panel, anchor);
      });
      return chip;
    });
  }

  // The AIs behind one item, on their own row under its text. When every
  // summarized AI backs it, one badge stands in for the whole row of chips.
  function createAiSummarySources(sources, sourcesById, round, totalSources, item) {
    const row = document.createElement('span');
    row.className = 'ai-summary-item-sources';
    const known = sources.filter(sourceId => sourcesById.has(sourceId));
    if (totalSources >= AI_SUMMARY_ALL_SOURCES_MIN && known.length === totalSources) {
      const badge = document.createElement('span');
      badge.className = 'ai-summary-source ai-summary-source-all';
      badge.textContent = getLocalizedText('aiSummaryAllSources', 'All $1 AIs', [String(totalSources)]);
      badge.title = known.map(sourceId => getAiSummarySourceLabel(sourcesById.get(sourceId), round)).join(', ');
      row.append(badge);
    } else {
      row.append(...createAiSummarySourceChips(known, sourcesById, round, item));
    }
    return row;
  }

  // Item text with any source id the model left in replaced by its AI's name.
  function createAiSummaryText(text, sourcesById, round, tagName = 'p') {
    const element = document.createElement(tagName);
    element.className = 'ai-summary-item-text';
    element.textContent = replaceSourceIds(text, sourceId => {
      const source = sourcesById.get(sourceId);
      return source ? getAiSummarySourceLabel(source, round) : '';
    });
    return element;
  }

  function createAiSummaryArticle(items, sourcesById, round, totalSources) {
    const article = document.createDocumentFragment();
    let previousSection = '';
    items.forEach(item => {
      const section = item.section || '';
      if (section && section !== previousSection) {
        const heading = createAiSummaryText(section, sourcesById, round, 'h5');
        heading.className = 'ai-summary-article-heading';
        article.append(heading);
      }
      previousSection = section;
      const paragraph = createAiSummaryText(item.text, sourcesById, round);
      paragraph.classList.add('ai-summary-article-paragraph');
      paragraph.classList.toggle('ai-summary-strong', isStronglySupported(item.sources, totalSources));
      paragraph.append(createAiSummarySources(item.sources, sourcesById, round, totalSources, item));
      article.append(paragraph);
    });
    return article;
  }

  function createAiSummaryUniqueGroups(items, sourcesById, round) {
    return groupItemsBySources(items, [...sourcesById.keys()]).map(group => {
      const element = document.createElement('div');
      element.className = 'ai-summary-unique-group';
      const chips = createAiSummarySourceChips(group.sources, sourcesById, round, group.items[0]);
      if (chips.length) {
        const heading = document.createElement('h5');
        heading.className = 'ai-summary-unique-heading';
        heading.append(...chips);
        element.append(heading);
      }
      const list = document.createElement('ul');
      list.className = 'ai-summary-unique-list';
      group.items.forEach(item => {
        const li = document.createElement('li');
        li.append(createAiSummaryText(item.text, sourcesById, round));
        if (group.items.length > 1) {
          const sources = document.createElement('span');
          sources.className = 'ai-summary-item-sources';
          sources.append(...createAiSummarySourceChips(item.sources, sourcesById, round, item));
          li.append(sources);
        }
        list.append(li);
      });
      element.append(list);
      return element;
    });
  }

  // One disagreement: its topic, then its positions side by side, each column a
  // camp followed by the AIs that hold it.
  function createAiSummaryDisagreement(item, sourcesById, round, totalSources) {
    const card = document.createElement('div');
    card.className = 'ai-summary-disagreement';
    if (item.topic) {
      const topic = createAiSummaryText(item.topic, sourcesById, round);
      topic.className = 'ai-summary-disagreement-topic';
      card.append(topic);
      if (item.sources.length) card.append(createAiSummarySources(item.sources, sourcesById, round, totalSources, item));
    }
    if (item.positions.length) {
      const positions = document.createElement('ul');
      positions.className = 'ai-summary-positions';
      item.positions.forEach(position => {
        const row = document.createElement('li');
        row.className = 'ai-summary-position';
        row.classList.toggle('ai-summary-strong', isStronglySupported(position.sources, totalSources));
        row.append(createAiSummaryText(position.text, sourcesById, round), createAiSummarySources(position.sources, sourcesById, round, totalSources, position));
        positions.append(row);
      });
      card.append(positions);
    }
    return card;
  }

  // The running status with the seconds spent and, once the reply streams in,
  // how much of it has arrived.
  function getAiSummaryRunningText(state) {
    const count = String(state.sources.length);
    const seconds = String(Math.max(0, Math.floor((Date.now() - (state.startedAt || Date.now())) / 1000)));
    return state.receivedChars > 0
      ? getLocalizedText('aiSummaryReceiving', 'Summarizing $1 answers… $2 characters received ($3 s)', [count, String(state.receivedChars), seconds])
      : getLocalizedText('aiSummaryWaiting', 'Summarizing $1 answers… ($2 s)', [count, seconds]);
  }

  function renderAiSummary() {
    const drawer = document.getElementById('ai-summary-drawer');
    if (!drawer || drawer.hidden) {
      return;
    }
    const byId = id => document.getElementById(id);
    const state = aiSummaryState;
    const round = state.roundId ? getAnswersController().answerRounds.get(state.roundId) : null;

    const title = round?.promptSummary || getLocalizedText('aiSummaryTitle', 'AI summary');
    byId('ai-summary-title-text').textContent = title;
    byId('ai-summary-title').title = title;

    const status = byId('ai-summary-status');
    status.classList.toggle('error', state.status === 'error');
    drawer.dataset.fromCache = String(state.fromCache === true);
    const statusText = {
      idle: round
        ? getLocalizedText('aiSummaryIdle', 'Waiting for the answers. Use Summarize again to summarize now.')
        : getLocalizedText('aiSummaryNoRound', 'Send a question to several AIs, then summarize their answers here.'),
      collecting: getLocalizedText('aiSummaryCollecting', 'Reading the answers…'),
      running: getAiSummaryRunningText(state),
      done: state.fromCache
        ? getLocalizedText('aiSummaryCached', 'Cached result from a recently asked question. Use Summarize again to refresh.')
        : '',
      error: state.error
    };
    status.textContent = statusText[state.status] ?? '';
    byId('ai-summary-settings-btn').hidden = !state.needsSetup;
    byId('ai-summary-rerun-btn').disabled = !round || state.status === 'collecting' || state.status === 'running';
    byId('ai-summary-copy-btn').disabled = state.status !== 'done';

    const result = byId('ai-summary-result');
    const summary = state.status === 'done' ? state.summary : null;
    result.hidden = !summary;
    const sourcesById = new Map(state.sources.map(source => [source.sourceId, source]));
    const getSourceLabel = sourceId => {
      const source = sourcesById.get(sourceId);
      return source ? getAiSummarySourceLabel(source, round) : '';
    };
    const verdict = byId('ai-summary-verdict');
    verdict.hidden = !summary?.verdict;
    byId('ai-summary-verdict-text').replaceChildren(...(summary?.verdict
      ? [
        document.createTextNode(replaceSourceIds(summary.verdict.text, getSourceLabel)),
        createAiSummarySources(summary.verdict.sources, sourcesById, round, state.sources.length, summary.verdict)
      ]
      : []));
    const overview = byId('ai-summary-overview');
    const overviewText = String(summary?.overview || '').trim();
    overview.hidden = !overviewText;
    renderOverviewBlocks(
      overview,
      overviewText ? parseOverviewBlocks(overviewText) : [],
      text => replaceSourceIds(text, getSourceLabel)
    );
    byId('ai-summary-consensus').replaceChildren(createAiSummaryArticle(summary?.consensus || [], sourcesById, round, state.sources.length));
    byId('ai-summary-consensus-section').hidden = !summary?.consensus.length;
    byId('ai-summary-unique').replaceChildren(...createAiSummaryUniqueGroups(summary?.unique || [], sourcesById, round));
    byId('ai-summary-unique-section').hidden = !summary?.unique?.length;
    byId('ai-summary-disagreements').replaceChildren(...(summary?.disagreements || []).map(item => createAiSummaryDisagreement(item, sourcesById, round, state.sources.length)));
    byId('ai-summary-disagreements-section').hidden = !summary?.disagreements.length;
    // Shown blocks fade in one after another (see .ai-summary-reveal).
    [...result.querySelectorAll('.ai-summary-reveal:not([hidden]), .ai-summary-article-paragraph, .ai-summary-unique-group, .ai-summary-disagreement')]
      .forEach((element, index) => element.style.setProperty('--ai-summary-index', String(index)));

    const missing = byId('ai-summary-missing');
    const showMissing = state.missing.length > 0 && ['running', 'done', 'error'].includes(state.status);
    missing.hidden = !showMissing;
    missing.textContent = showMissing
      ? getLocalizedText('aiSummaryMissing', 'Not included (answer could not be read): $1', [state.missing.map(source => getAiSummarySourceLabel(source, round)).join(', ')])
      : '';
  }

  async function copyAiSummary() {
    const round = getAnswersController().answerRounds.get(aiSummaryState.roundId);
    if (aiSummaryState.status !== 'done' || !aiSummaryState.summary) return;
    const sourcesById = new Map(aiSummaryState.sources.map(source => [source.sourceId, source]));
    const text = formatSummaryText(
      aiSummaryState.summary,
      sourceId => getAiSummarySourceLabel(sourcesById.get(sourceId), round),
      {
        verdictTitle: getLocalizedText('aiSummaryVerdict', 'Verdict'),
        consensusTitle: getLocalizedText('aiSummaryConsensus', 'Agreed'),
        uniqueTitle: getLocalizedText('aiSummaryUnique', 'Unique insights'),
        disagreementsTitle: getLocalizedText('aiSummaryDisagreements', 'Disagreements'),
        sourceOrder: aiSummaryState.sources.map(source => source.sourceId)
      }
    );
    try {
      await navigator.clipboard.writeText(text);
      showToast(getLocalizedText('aiSummaryCopied', 'Summary copied'));
    } catch (error) {
      console.warn('[Multi-Panel] Failed to copy the AI summary:', error);
    }
  }

  function setupAiSummary() {
    document.getElementById('ai-summary-btn')?.addEventListener('click', toggleAiSummaryDrawer);
    document.getElementById('close-ai-summary-drawer')?.addEventListener('click', closeAiSummaryDrawer);
    document.getElementById('ai-summary-expand-btn')?.addEventListener('click', toggleAiSummaryExpanded);
    document.getElementById('ai-summary-profile-select')?.addEventListener('change', (event) => {
      chooseAiSummaryProfile(event.target.value);
    });
    document.getElementById('ai-summary-drawer')?.addEventListener('click', handleAiSummaryDrawerClick);
    document.getElementById('ai-summary-copy-btn')?.addEventListener('click', () => { void copyAiSummary(); });
    document.getElementById('ai-summary-rerun-btn')?.addEventListener('click', () => {
      const roundId = aiSummaryState.roundId || getAnswersController().latestAnswerRoundId;
      if (roundId) void runAiSummary(roundId, { collect: true, forceRefresh: true });
    });
    document.getElementById('ai-summary-settings-btn')?.addEventListener('click', () => chrome.runtime.openOptionsPage());
    document.getElementById('ai-summary-drawer')?.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeAiSummaryDrawer();
        document.getElementById('ai-summary-btn')?.focus();
      }
    });
    // A click anywhere else closes the drawer. The button toggles it itself.
    document.addEventListener('pointerdown', (event) => {
      if (!isAiSummaryDrawerOpen()) return;
      const target = event.target;
      if (target instanceof Node && (document.getElementById('ai-summary-drawer')?.contains(target)
        || document.getElementById('ai-summary-btn')?.contains(target))) {
        return;
      }
      closeAiSummaryDrawer();
    }, true);
    // Clicks inside a panel never reach this page; the page loses focus to the
    // panel's frame instead. The frame must be under the pointer, so a panel
    // that focuses itself does not close the drawer.
    window.addEventListener('blur', () => {
      setTimeout(() => {
        const active = document.activeElement;
        if (isAiSummaryDrawerOpen() && active?.tagName === 'IFRAME' && active.matches(':hover')) {
          closeAiSummaryDrawer();
        }
      }, 0);
    });
    document.getElementById('ai-summary-btn')?.addEventListener('animationend', (event) => {
      if (event.animationName === 'ai-summary-absorb') event.currentTarget.classList.remove('ai-summary-absorb');
    });
  }

  return {
    get aiSummaryConfig() { return aiSummaryConfig; },
    applyAiSummaryConfigChanges,
    handleAnswerTextMessage,
    handleLocateAnswerResult,
    maybeAutoSummarize,
    maybeRemindAiSummary,
    reloadAiSummarySetup,
    renderAiSummary,
    setupAiSummary,
    startAiSummaryRound,
  };
}
