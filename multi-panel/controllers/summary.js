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
  isStronglySupported,
  isSummaryConfigured,
  parseSummaryResponse,
  pickAnchorText,
  requestSummary,
  replaceSourceIds
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
import { getSummaryColumnStart } from '../../modules/panels/summary-placement.js';
import { getLocalizedText, showToast } from './ui.js';
import { PANELIZE_GET_ANSWER_TEXT, PANELIZE_LOCATE_ANSWER_TEXT } from './protocol.js';

export function createSummaryController({
  getAnswersController,
  getLayoutController,
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
    syncAiSummaryCard();
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

  // The card is the trailing answer of the grid while the summary API is
  // configured. Without a configuration it stays hidden unless the toolbar
  // button reveals it temporarily so the setup button is reachable.
  let aiSummaryCardTransient = false;
  let aiSummaryWasConfigured = false;

  // With at least this many summarized AIs, a point all of them back shows one
  // "All N AIs" badge instead of a chip per AI.
  const AI_SUMMARY_ALL_SOURCES_MIN = 3;

  function getAiSummaryCard() {
    return document.getElementById('ai-summary-panel');
  }

  function isAiSummaryCardExpanded() {
    return Boolean(getAiSummaryCard()?.classList.contains('ai-summary-expanded'));
  }

  function isAiSummaryCardVisible() {
    return Boolean(getAiSummaryCard()) && !getAiSummaryCard().hidden;
  }

  // The card follows the columns the panels occupy in the first row, so unused
  // layout columns stay to its right instead of separating it from the last AI.
  function updateAiSummaryGridPlacement() {
    const card = getAiSummaryCard();
    if (!card) return;
    const panelTops = getPanelsController().panels
      .map(panel => document.getElementById(panel.id))
      .filter(element => element && element.offsetParent !== null)
      .map(element => Math.round(element.offsetTop));
    const columnStart = getSummaryColumnStart(panelTops);
    if (columnStart === null) {
      card.style.removeProperty('grid-column-start');
    } else {
      card.style.gridColumnStart = String(columnStart);
    }
  }

  // The card adds a grid column, so handles and edge buttons must be measured
  // again whenever it appears, leaves or changes its footprint.
  function refreshAiSummaryLayout() {
    updateAiSummaryGridPlacement();
    getLayoutController().panelResize?.refresh();
    getPresentationController().updatePanelEdgeButtons?.();
  }

  // The close button belongs to the temporary no-configuration card only; a
  // configured summary stays in the grid and is dismissed through the overlay.
  function setAiSummaryCloseVisible() {
    const close = document.getElementById('close-ai-summary-panel');
    if (close) {
      close.hidden = !(isAiSummaryCardVisible() && aiSummaryCardTransient && !isSummaryConfigured(aiSummaryConfig));
    }
  }

  // The configuration arrives asynchronously and can change while the page is
  // open. Show the card whenever a usable profile exists, and take it away when
  // the last profile is removed.
  function syncAiSummaryCard() {
    const card = getAiSummaryCard();
    if (!card) return;
    const configured = isSummaryConfigured(aiSummaryConfig);
    if (configured) {
      const wasTransient = aiSummaryCardTransient;
      aiSummaryCardTransient = false;
      // Leaving the "set up the API" state once a usable profile arrives.
      if (wasTransient || (aiSummaryWasConfigured === false && aiSummaryState.needsSetup)) {
        aiSummaryState = {
          roundId: aiSummaryState.roundId,
          status: 'idle',
          sources: [],
          missing: [],
          summary: null,
          error: '',
          needsSetup: false,
          fromCache: false,
          cachedAt: null
        };
        updateAiSummaryButtonBusy();
      }
      showAiSummaryCard();
    } else if (aiSummaryWasConfigured) {
      aiSummaryCardTransient = false;
      aiSummaryController?.abort();
      aiSummaryController = null;
      aiSummaryState = {
        roundId: aiSummaryState.roundId,
        status: 'idle',
        sources: [],
        missing: [],
        summary: null,
        error: '',
        needsSetup: false,
        fromCache: false,
        cachedAt: null
      };
      updateAiSummaryButtonBusy();
      hideAiSummaryCard({ restoreFocus: true });
    }
    aiSummaryWasConfigured = configured;
    setAiSummaryCloseVisible();
  }

  function showAiSummaryCard({ exitFocus = false } = {}) {
    const card = getAiSummaryCard();
    if (!card) return;
    // A focused panel hides the card (and its grid column); leave focus first.
    if (exitFocus && getPanelsController().focusedPanelId) {
      getPanelsController().setFocusedPanel(null);
    }
    if (card.hidden) {
      card.hidden = false;
      requestAnimationFrame(refreshAiSummaryLayout);
    }
    renderAiSummary();
    setAiSummaryCloseVisible();
  }

  function hideAiSummaryCard({ restoreFocus = false } = {}) {
    const card = getAiSummaryCard();
    if (!card) return;
    if (isSummaryConfigured(aiSummaryConfig) && !aiSummaryCardTransient) return;
    if (isAiSummaryCardExpanded()) {
      setAiSummaryExpanded(false, { refresh: false });
    }
    if (card.hidden) return;
    card.hidden = true;
    aiSummaryCardTransient = false;
    refreshAiSummaryLayout();
    setAiSummaryCloseVisible();
    if (restoreFocus) document.getElementById('ai-summary-btn')?.focus();
  }

  // The reading overlay floats at the right, below the toolbar and above the
  // shared composer, so the rest of the comparison and the input stay usable.
  function updateAiSummaryOverlayBounds() {
    const card = getAiSummaryCard();
    if (!card) return;
    if (!isAiSummaryCardExpanded()) {
      card.style.removeProperty('--ai-summary-overlay-top');
      card.style.removeProperty('--ai-summary-overlay-bottom');
      return;
    }
    const toolbar = document.getElementById('toolbar');
    const toolbarBottom = toolbar ? Math.ceil(toolbar.getBoundingClientRect().bottom) : 0;
    card.style.setProperty('--ai-summary-overlay-top', `${toolbarBottom + 8}px`);
    const inputBar = document.getElementById('input-bar');
    const height = inputBar ? Math.ceil(inputBar.getBoundingClientRect().height) : 0;
    card.style.setProperty('--ai-summary-overlay-bottom', `${height + 24}px`);
  }

  // Reading mode lifts the card out of the grid; the grid itself never moves.
  function setAiSummaryExpanded(expanded, { refresh = true, focus = false } = {}) {
    const card = getAiSummaryCard();
    if (!card || (expanded && card.hidden)) return;
    card.classList.toggle('ai-summary-expanded', expanded);
    updateAiSummaryOverlayBounds();
    document.getElementById('main-content')?.classList.toggle('ai-summary-expanded', expanded);
    const expandButton = document.getElementById('ai-summary-expand-btn');
    if (expandButton) {
      const label = expanded
        ? getLocalizedText('aiSummaryShrink', 'Shrink')
        : getLocalizedText('aiSummaryExpand', 'Expand');
      expandButton.setAttribute('aria-pressed', String(expanded));
      expandButton.title = label;
      expandButton.setAttribute('aria-label', label);
      expandButton.querySelector('.material-symbols-outlined').textContent = expanded ? 'close_fullscreen' : 'open_in_full';
    }
    // The toolbar button controls the overlay; the card's presence is separate.
    document.getElementById('ai-summary-btn')?.setAttribute('aria-expanded', String(expanded));
    if (expanded && focus) expandButton?.focus();
    if (refresh) requestAnimationFrame(refreshAiSummaryLayout);
  }

  function toggleAiSummaryExpanded() {
    setAiSummaryExpanded(!isAiSummaryCardExpanded());
  }

  function handleAiSummaryCardKeydown(event) {
    if (event.key !== 'Escape' || event.isComposing) return;
    // The profile select owns Escape while its dropdown is open.
    if (event.target instanceof Element && event.target.closest('select')) return;
    if (isAiSummaryCardExpanded()) {
      event.preventDefault();
      setAiSummaryExpanded(false);
      document.getElementById('ai-summary-expand-btn')?.focus();
      return;
    }
    if (aiSummaryCardTransient && !isSummaryConfigured(aiSummaryConfig)) {
      event.preventDefault();
      hideAiSummaryCard({ restoreFocus: true });
    }
  }

  // A click anywhere outside the reading overlay closes it; the card itself
  // stays in the grid. Clicks inside an AI iframe never reach this document,
  // so the window blur handler covers that case.
  function handleAiSummaryOutsidePointerDown(event) {
    if (!isAiSummaryCardExpanded()) return;
    if (event.target instanceof Element && event.target.closest('#ai-summary-btn')) return;
    const card = getAiSummaryCard();
    if (card && event.target instanceof Node && card.contains(event.target)) return;
    setAiSummaryExpanded(false);
  }

  function handleAiSummaryWindowBlur() {
    if (!isAiSummaryCardExpanded()) return;
    // Let focus settle before checking whether it moved into a panel frame.
    window.setTimeout(() => {
      if (isAiSummaryCardExpanded() && document.activeElement?.tagName === 'IFRAME') {
        setAiSummaryExpanded(false);
      }
    }, 0);
  }

  function handleAiSummaryButtonClick() {
    if (isAiSummaryCardExpanded()) {
      setAiSummaryExpanded(false);
      return;
    }
    if (!isSummaryConfigured(aiSummaryConfig)) {
      aiSummaryCardTransient = true;
      aiSummaryState = {
        roundId: aiSummaryState.roundId || getAnswersController().latestAnswerRoundId,
        status: 'error',
        sources: [],
        missing: [],
        summary: null,
        error: getLocalizedText('aiSummaryNotConfigured', 'Set up an OpenAI-compatible API in Settings to summarize answers.'),
        needsSetup: true,
        fromCache: false,
        cachedAt: null
      };
      showAiSummaryCard({ exitFocus: true });
      setAiSummaryExpanded(true, { focus: true });
      updateAiSummaryButtonBusy();
      renderAiSummary();
      return;
    }
    showAiSummaryCard({ exitFocus: true });
    setAiSummaryExpanded(true, { focus: true });
    // Summarize the latest round unless it is already summarized or running.
    const roundId = getAnswersController().latestAnswerRoundId;
    if (roundId && (aiSummaryState.roundId !== roundId || ['idle', 'error'].includes(aiSummaryState.status))) {
      void runAiSummary(roundId, { collect: true });
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
    updateAiSummaryButtonBusy();
    renderAiSummary();
  }

  // A ring spins around the button while answers are read or summarized.
  function updateAiSummaryButtonBusy() {
    const busy = ['collecting', 'running'].includes(aiSummaryState.status);
    const button = document.getElementById('ai-summary-btn');
    button?.classList.toggle('ai-summary-busy', busy);
    button?.setAttribute('aria-busy', String(busy));
  }

  function maybeAutoSummarize(roundId) {
    const round = getAnswersController().answerRounds.get(roundId);
    if (!aiSummaryConfig.autoEnabled || roundId !== getAnswersController().latestAnswerRoundId || autoSummarizedRoundIds.has(roundId)
      || !isSummaryConfigured(aiSummaryConfig) || !isRoundReadyForAutoSummary(round, getRoundAnswerTexts(round))) {
      return;
    }
    autoSummarizedRoundIds.add(roundId);
    // The persistent card shows collecting/running and then the result.
    void runAiSummary(roundId);
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

  async function runAiSummary(roundId, { collect = false, forceRefresh = false } = {}) {
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
        // The persistent card now shows the cached result without an API call.
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
        // A reply that parsed to nothing is no result: keep the card hidden
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
    const card = document.getElementById('ai-summary-panel');
    if (!card || card.hidden) {
      return;
    }
    const byId = id => document.getElementById(id);
    const state = aiSummaryState;
    const round = state.roundId ? getAnswersController().answerRounds.get(state.roundId) : null;

    // The card header names the answerer; the question is its subtitle.
    const title = getLocalizedText('aiSummaryTitle', 'AI summary');
    const question = round?.promptSummary || '';
    byId('ai-summary-title-text').textContent = title;
    byId('ai-summary-question').textContent = question;
    byId('ai-summary-question').hidden = !question;
    byId('ai-summary-title').title = question || title;

    const status = byId('ai-summary-status');
    status.classList.toggle('error', state.status === 'error');
    card.dataset.state = state.status;
    card.dataset.fromCache = String(state.fromCache === true);
    card.querySelector('.ai-summary-skeleton').hidden = !['collecting', 'running'].includes(state.status);
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
    document.getElementById('ai-summary-btn')?.addEventListener('click', handleAiSummaryButtonClick);
    document.getElementById('close-ai-summary-panel')?.addEventListener('click', () => hideAiSummaryCard({ restoreFocus: true }));
    document.getElementById('ai-summary-expand-btn')?.addEventListener('click', toggleAiSummaryExpanded);
    document.getElementById('ai-summary-profile-select')?.addEventListener('change', (event) => {
      chooseAiSummaryProfile(event.target.value);
    });
    document.getElementById('ai-summary-copy-btn')?.addEventListener('click', () => { void copyAiSummary(); });
    document.getElementById('ai-summary-rerun-btn')?.addEventListener('click', () => {
      const roundId = aiSummaryState.roundId || getAnswersController().latestAnswerRoundId;
      if (roundId) void runAiSummary(roundId, { collect: true, forceRefresh: true });
    });
    document.getElementById('ai-summary-settings-btn')?.addEventListener('click', () => chrome.runtime.openOptionsPage());
    const card = document.getElementById('ai-summary-panel');
    card?.addEventListener('keydown', handleAiSummaryCardKeydown);
    document.addEventListener('pointerdown', handleAiSummaryOutsidePointerDown);
    window.addEventListener('blur', handleAiSummaryWindowBlur);
    // A growing draft or a collapsed toolbar changes the free area; keep the
    // overlay between the toolbar and the composer.
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(() => updateAiSummaryOverlayBounds());
      const inputBar = document.getElementById('input-bar');
      const toolbar = document.getElementById('toolbar');
      if (inputBar) observer.observe(inputBar);
      if (toolbar) observer.observe(toolbar);
    }
    // Panels and layouts change the column after the last AI.
    const grid = document.getElementById('panel-grid');
    if (grid && typeof MutationObserver === 'function') {
      const observer = new MutationObserver(() => {
        if (!isAiSummaryCardVisible()) return;
        window.requestAnimationFrame(refreshAiSummaryLayout);
      });
      observer.observe(grid, { childList: true, attributes: true, attributeFilter: ['class'] });
    }
    if (isAiSummaryCardVisible()) {
      window.requestAnimationFrame(refreshAiSummaryLayout);
    }
  }

  return {
    get aiSummaryConfig() { return aiSummaryConfig; },
    applyAiSummaryConfigChanges,
    handleAnswerTextMessage,
    handleLocateAnswerResult,
    maybeAutoSummarize,
    reloadAiSummarySetup,
    renderAiSummary,
    setupAiSummary,
    startAiSummaryRound,
  };
}
