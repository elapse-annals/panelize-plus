/**
 * Owns answers behavior and its page-local state.
 * Deferred controller getters keep composition in the entry point.
 */
import { getProviderById } from '../../modules/providers/providers.js';
import {
  ENGAGEMENT_KIND,
  MAX_STORED_ROUNDS,
  OLDER_SCORE_WEIGHT,
  aggregateAnswerStats,
  applyEngagementEvent,
  applyTimingEvent,
  clearAnswerRounds,
  createRound,
  getAllAnswerRounds,
  getRoundCategory,
  isFirstRoundCompletion,
  saveAnswerRound,
  summarizeBestByCategory,
  toggleRoundAdoption,
  toggleRoundRejection
} from '../../modules/answers/answer-stats.js';
import { renderAnswerStatsTable, renderBestByCategory } from '../../modules/answers/answer-stats-view.js';
import { classifyTask } from '../../modules/answers/task-category.js';
import { filterAnswerLogRounds, getAnswerLogProviderIds, renderAnswerLog } from '../../modules/answers/answer-log.js';
import { getLocalizedText, showToast } from './ui.js';

export function createAnswersController({
  getPanelsController,
  getPresentationController,
  getQuestionHistoryController,
  getSharingController,
  getSummaryController
}) {
  // Recent answer stats rounds by send request id, for timing reports and the
  // feedback buttons. The latest round is the one the feedback buttons act on.
  const answerRounds = new Map();

  let latestAnswerRoundId = null;

  // The answer whose panel is in focus mode, counted as engagement with it.
  let zoomedAnswer = null;

  // All stored rounds, newest first, for the answer stats and log dialogs.
  // Loaded when one of them opens, kept current while either stays open and
  // dropped once both close; null while not loaded.
  let answerStatsRoundsCache = null;

  let answerViewsRenderTimerId = null;

  // Questions shown in the answer log; reset when it opens or a filter changes.
  let answerLogLimit = 0;

  let isAnswerCompleteNotificationEnabled = true;

  const MAX_IN_MEMORY_ANSWER_ROUNDS = 20;

  const ANSWER_STATS_RECENT_LIMIT = 20;

  // Timing and engagement reports arrive in bursts; open dialogs redraw at most
  // this often.
  const ANSWER_VIEWS_RENDER_DELAY_MS = 250;

  // ===== Answer Stats =====
  function getLatestAnswerRound() {
    return latestAnswerRoundId ? answerRounds.get(latestAnswerRoundId) || null : null;
  }

  // A panel switched to another provider no longer shows the answer it was sent.
  function isPanelInAnswerRound(round, panel) {
    return Boolean(round && panel && panel.clearedAnswerRoundId !== round.id
      && round.answers[panel.id]?.providerId === panel.providerId);
  }

  function persistAnswerRound(round) {
    answerRounds.set(round.id, round);
    if (round.id === latestAnswerRoundId) getPanelsController().renderPanelActivity();
    saveAnswerRound(round).catch(error => {
      console.warn('[Multi-Panel] Failed to save answer stats:', error);
    });
    if (answerStatsRoundsCache) {
      upsertCachedAnswerRound(round);
      scheduleAnswerViewsRender();
    }
  }

  function startAnswerRound(requestId, text, sentAt, roundPanels) {
    if (!requestId || roundPanels.length === 0) {
      return;
    }

    const round = createRound({
      id: requestId,
      createdAt: sentAt,
      text,
      category: classifyTask(text),
      panels: roundPanels.map(panel => ({ id: panel.id, providerId: panel.providerId })),
      blind: getPresentationController().isBlindModeEnabled
    });
    latestAnswerRoundId = round.id;
    persistAnswerRound(round);
    updateZoomedAnswer();
    answerQuestionsByRound.set(round.id, text || '');
    answerTextsByRound.set(round.id, new Map());
    // Every actual send reaches here, including image and global-send flows;
    // fill-only requests do not.
    void getQuestionHistoryController().rememberQuestionForHistory(text);

    // Older rounds stay in storage; their panels have moved on.
    while (answerRounds.size > MAX_IN_MEMORY_ANSWER_ROUNDS) {
      const oldestRoundId = answerRounds.keys().next().value;
      answerRounds.delete(oldestRoundId);
      answerQuestionsByRound.delete(oldestRoundId);
      answerTextsByRound.delete(oldestRoundId);
    }
    updateAnswerFeedbackButtons();
    getSummaryController().startAiSummaryRound(round.id);
  }

  function handleAnswerTimingMessage(panel, data) {
    const round = answerRounds.get(data.requestId);
    if (!isPanelInAnswerRound(round, panel)) {
      return;
    }

    if (typeof data.text === 'string' && data.text.trim()) {
      answerTextsByRound.get(round.id)?.set(panel.id, data.text);
    }
    const nextRound = applyTimingEvent(round, panel.id, data.phase, data.at);
    if (nextRound) {
      persistAnswerRound(nextRound);
      if (isAnswerCompleteNotificationEnabled && isFirstRoundCompletion(round, nextRound, panel.id)) {
        showAnswerCompleteNotification(panel, nextRound);
      }
    }
    getSummaryController().maybeAutoSummarize(round.id);
  }

  // ===== AI Summary =====
  // Answer texts stay in memory only; answer stats never store them.
  const answerTextsByRound = new Map();

  const answerQuestionsByRound = new Map();

  // ===== Answer complete notification =====
  const ANSWER_COMPLETE_NOTIFICATION_PREFIX = 'panelize-answer-complete:';

  // Notifications this page showed; other Panelize pages ignore their clicks.
  const answerCompleteNotificationIds = new Set();

  function showAnswerCompleteNotification(panel, round) {
    if (typeof chrome.notifications?.create !== 'function') {
      return;
    }
    // Only when the user has switched away; focus inside a panel still counts.
    if (document.visibilityState === 'visible' && document.hasFocus()) {
      return;
    }
    const notificationId = `${ANSWER_COMPLETE_NOTIFICATION_PREFIX}${round.id}`;
    answerCompleteNotificationIds.add(notificationId);
    // The round's own blind flag, so turning blind mode off mid-round never
    // names the AI of a blind question.
    const panelName = getPresentationController().getPanelDisplayName(panel, { blind: round.blind === true });
    Promise.resolve(chrome.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title: getLocalizedText('notificationAnswerCompleteTitle', '$1 finished answering', [panelName]),
      message: round.promptSummary || ''
    })).catch(error => {
      console.warn('[Multi-Panel] Failed to show answer notification:', error);
    });
  }

  // Clicking the notification brings this Multi-Panel page to the front. The
  // page handles its own clicks, so its notifications go when it closes.
  function registerAnswerCompleteNotificationClick() {
    if (typeof chrome.notifications?.onClicked?.addListener !== 'function') {
      return;
    }
    window.addEventListener('pagehide', () => {
      answerCompleteNotificationIds.forEach(id => chrome.notifications.clear(id));
      answerCompleteNotificationIds.clear();
    });
    chrome.notifications.onClicked.addListener(async (notificationId) => {
      if (!answerCompleteNotificationIds.delete(notificationId)) {
        return;
      }
      try {
        const tabId = await getSharingController().getCurrentTabId();
        if (tabId !== null) {
          const tab = await chrome.tabs.update(tabId, { active: true });
          if (tab?.windowId !== undefined) {
            await chrome.windows.update(tab.windowId, { focused: true });
          }
        }
      } catch (error) {
        console.warn('[Multi-Panel] Failed to focus Multi-Panel:', error);
      }
      chrome.notifications.clear(notificationId);
    });
  }

  function recordAnswerEngagement(roundId, panelId, kind) {
    const round = answerRounds.get(roundId);
    const nextRound = round ? applyEngagementEvent(round, panelId, kind, Date.now()) : null;
    if (nextRound) {
      persistAnswerRound(nextRound);
    }
  }

  function handleAnswerEngagementMessage(panel, data) {
    const round = answerRounds.get(data.requestId);
    if (!isPanelInAnswerRound(round, panel)
      || (data.kind !== ENGAGEMENT_KIND.CLICK && data.kind !== ENGAGEMENT_KIND.SCROLL)) {
      return;
    }
    recordAnswerEngagement(round.id, panel.id, data.kind);
  }

  // Focus mode on a panel counts as enlarging the latest answer it shows.
  function updateZoomedAnswer() {
    const round = getLatestAnswerRound();
    const panel = getPanelsController().panels.find(candidate => candidate.id === getPanelsController().focusedPanelId);
    const next = isPanelInAnswerRound(round, panel) ? { roundId: round.id, panelId: panel.id } : null;
    if (next?.roundId === zoomedAnswer?.roundId && next?.panelId === zoomedAnswer?.panelId) {
      return;
    }

    if (zoomedAnswer) {
      recordAnswerEngagement(zoomedAnswer.roundId, zoomedAnswer.panelId, ENGAGEMENT_KIND.ZOOM_OUT);
    }
    zoomedAnswer = next;
    if (next) {
      recordAnswerEngagement(next.roundId, next.panelId, ENGAGEMENT_KIND.ZOOM_IN);
    }
  }

  function adoptPanelAnswer(panelId) {
    const round = getLatestAnswerRound();
    const panel = getPanelsController().panels.find(candidate => candidate.id === panelId);
    if (!isPanelInAnswerRound(round, panel)) {
      return;
    }

    persistAnswerRound(toggleRoundAdoption(round, panelId));
    updateAnswerFeedbackButtons();
  }

  function rejectPanelAnswer(panelId) {
    const round = getLatestAnswerRound();
    const panel = getPanelsController().panels.find(candidate => candidate.id === panelId);
    if (!isPanelInAnswerRound(round, panel)) {
      return;
    }

    persistAnswerRound(toggleRoundRejection(round, panelId));
    updateAnswerFeedbackButtons();
  }

  function updateAnswerFeedbackButtons() {
    const round = getLatestAnswerRound();
    getPanelsController().panels.forEach(panel => {
      const button = document.getElementById(panel.id)?.querySelector('.adopt-answer-btn');
      if (!button) {
        return;
      }

      const canAdopt = isPanelInAnswerRound(round, panel);
      const isAdopted = canAdopt && round.adoptedPanelId === panel.id;
      button.disabled = !canAdopt;
      button.classList.toggle('adopted', isAdopted);
      button.title = isAdopted
        ? getLocalizedText('adoptedAnswerTitle', 'Adopted (click to undo)')
        : getLocalizedText('adoptAnswerTitle', 'Adopt this answer');
      button.setAttribute('aria-label', button.title);
      button.setAttribute('aria-pressed', String(isAdopted));

      const rejectButton = document.getElementById(panel.id)?.querySelector('.reject-answer-btn');
      if (rejectButton) {
        const isRejected = canAdopt && Boolean(round.answers[panel.id].rejected);
        rejectButton.disabled = !canAdopt;
        rejectButton.classList.toggle('rejected', isRejected);
        rejectButton.title = isRejected
          ? getLocalizedText('rejectedAnswerTitle', '5 points deducted (click to undo)')
          : getLocalizedText('rejectAnswerTitle', 'Deduct 5 points');
        rejectButton.setAttribute('aria-label', rejectButton.title);
        rejectButton.setAttribute('aria-pressed', String(isRejected));
      }
    });
  }

  function upsertCachedAnswerRound(round) {
    const index = answerStatsRoundsCache.findIndex(candidate => candidate.id === round.id);
    if (index >= 0) {
      answerStatsRoundsCache[index] = round;
      return;
    }
    const insertAt = answerStatsRoundsCache.findIndex(candidate => candidate.createdAt < round.createdAt);
    answerStatsRoundsCache.splice(insertAt < 0 ? answerStatsRoundsCache.length : insertAt, 0, round);
    // Storage keeps the newest MAX_STORED_ROUNDS as well.
    if (answerStatsRoundsCache.length > MAX_STORED_ROUNDS) {
      answerStatsRoundsCache.length = MAX_STORED_ROUNDS;
    }
  }

  async function loadAnswerStatsRounds() {
    if (answerStatsRoundsCache) {
      return;
    }
    let rounds = [];
    try {
      rounds = await getAllAnswerRounds();
    } catch (error) {
      console.warn('[Multi-Panel] Failed to load answer stats:', error);
    }
    if (!isAnswerStatsModalOpen() && !isAnswerLogModalOpen()) {
      return;
    }
    answerStatsRoundsCache = rounds;
    // Rounds changed while the read ran may be newer than what it returned.
    answerRounds.forEach(upsertCachedAnswerRound);
  }

  function scheduleAnswerViewsRender() {
    if (answerViewsRenderTimerId !== null) {
      return;
    }
    answerViewsRenderTimerId = setTimeout(() => {
      answerViewsRenderTimerId = null;
      renderAnswerViews();
    }, ANSWER_VIEWS_RENDER_DELAY_MS);
  }

  function renderAnswerViews() {
    if (isAnswerStatsModalOpen()) {
      renderAnswerStats();
    }
    if (isAnswerLogModalOpen()) {
      renderAnswerLogView();
    }
  }

  // Other tabs may add rounds while both dialogs are closed, so the next open reads storage again.
  function releaseAnswerStatsRoundsIfClosed() {
    if (isAnswerStatsModalOpen() || isAnswerLogModalOpen()) {
      return;
    }
    answerStatsRoundsCache = null;
    clearTimeout(answerViewsRenderTimerId);
    answerViewsRenderTimerId = null;
  }

  function getAnswerViewOptions() {
    return { getText: getLocalizedText, getProviderName: getProviderDisplayName };
  }

  function getProviderDisplayName(providerId) {
    return getProviderById(providerId)?.name || providerId;
  }

  function isAnswerStatsModalOpen() {
    const modal = document.getElementById('answer-stats-modal');
    return Boolean(modal && modal.style.display !== 'none');
  }

  async function openAnswerStatsModal() {
    if (getPresentationController().isBlindModeEnabled) {
      showToast(getLocalizedText('blindModeStatsHidden', 'Turn off blind mode to see answer stats'));
      return;
    }
    document.getElementById('answer-stats-modal').style.display = 'flex';
    await loadAnswerStatsRounds();
    if (isAnswerStatsModalOpen()) {
      renderAnswerStats();
    }
  }

  function closeAnswerStatsModal() {
    document.getElementById('answer-stats-modal').style.display = 'none';
    releaseAnswerStatsRoundsIfClosed();
  }

  function renderAnswerStats() {
    const rounds = answerStatsRoundsCache || [];
    const hasRounds = rounds.length > 0;
    document.getElementById('answer-stats-empty').hidden = hasRounds;
    document.getElementById('answer-stats-content').hidden = !hasRounds;
    document.getElementById('answer-stats-export-btn').disabled = !hasRounds;
    document.getElementById('answer-stats-clear-btn').disabled = !hasRounds;
    const now = Date.now();
    const category = document.getElementById('answer-stats-category').value;
    document.getElementById('answer-stats-older-score-header').textContent = getLocalizedText(
      'answerStatsColumnOlderScore', 'Older ($1)', [`${Math.round(OLDER_SCORE_WEIGHT * 100)}%`]
    );
    renderAnswerStatsTable(
      document.querySelector('#answer-stats-table tbody'),
      aggregateAnswerStats(rounds, now, { category }),
      getAnswerViewOptions()
    );
    renderBestByCategory(
      document.getElementById('answer-stats-best'),
      summarizeBestByCategory(rounds, now),
      getAnswerViewOptions()
    );
  }

  async function exportAnswerStats() {
    try {
      const rounds = await getAllAnswerRounds();
      const exportedRounds = rounds.map(round => ({ ...round, category: getRoundCategory(round) }));
      const blob = new Blob([JSON.stringify({ exportedAt: Date.now(), rounds: exportedRounds }, null, 2)], {
        type: 'application/json'
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `panelize-answer-stats-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      console.error('[Multi-Panel] Failed to export answer stats:', error);
    }
  }

  async function clearAnswerStats() {
    if (!window.confirm(getLocalizedText('answerStatsClearConfirm', 'Delete all answer stats?'))) {
      return;
    }

    try {
      await clearAnswerRounds();
    } catch (error) {
      console.error('[Multi-Panel] Failed to clear answer stats:', error);
      return;
    }
    answerRounds.clear();
    latestAnswerRoundId = null;
    zoomedAnswer = null;
    if (answerStatsRoundsCache) {
      answerStatsRoundsCache = [];
    }
    updateAnswerFeedbackButtons();
    renderAnswerViews();
  }

  function setupAnswerStats() {
    document.getElementById('answer-stats-category')?.addEventListener('change', renderAnswerStats);
    document.getElementById('answer-stats-btn')?.addEventListener('click', openAnswerStatsModal);
    document.getElementById('close-answer-stats-modal')?.addEventListener('click', closeAnswerStatsModal);
    document.getElementById('answer-stats-export-btn')?.addEventListener('click', exportAnswerStats);
    document.getElementById('answer-stats-clear-btn')?.addEventListener('click', clearAnswerStats);
    document.getElementById('answer-stats-modal')?.addEventListener('click', (event) => {
      if (event.target.id === 'answer-stats-modal') {
        closeAnswerStatsModal();
      }
    });
  }

  // ===== Answer Log =====
  function isAnswerLogModalOpen() {
    const modal = document.getElementById('answer-log-modal');
    return Boolean(modal && modal.style.display !== 'none');
  }

  async function openAnswerLogModal() {
    if (getPresentationController().isBlindModeEnabled) {
      showToast(getLocalizedText('blindModeStatsHidden', 'Turn off blind mode to see answer stats'));
      return;
    }
    document.getElementById('answer-log-modal').style.display = 'flex';
    answerLogLimit = ANSWER_STATS_RECENT_LIMIT;
    await loadAnswerStatsRounds();
    if (isAnswerLogModalOpen()) {
      renderAnswerLogView();
    }
  }

  function closeAnswerLogModal() {
    document.getElementById('answer-log-modal').style.display = 'none';
    releaseAnswerStatsRoundsIfClosed();
  }

  // Lists the providers of the shown questions; a selected provider stays listed.
  function updateAnswerLogProviderOptions(select, providerIds) {
    const ids = select.value && !providerIds.includes(select.value)
      ? [...providerIds, select.value]
      : providerIds;
    const current = [...select.options].slice(1).map(option => option.value);
    if (current.join('\n') === ids.join('\n')) {
      return;
    }

    const selected = select.value;
    [...select.options].slice(1).forEach(option => option.remove());
    ids.forEach(providerId => {
      select.add(new Option(getProviderDisplayName(providerId), providerId));
    });
    select.value = selected;
  }

  function renderAnswerLogView() {
    const rounds = answerStatsRoundsCache || [];
    const hasRounds = rounds.length > 0;
    document.getElementById('answer-log-empty').hidden = hasRounds;
    document.getElementById('answer-log-content').hidden = !hasRounds;
    if (!hasRounds) {
      return;
    }

    const now = Date.now();
    const providerSelect = document.getElementById('answer-log-provider');
    updateAnswerLogProviderOptions(providerSelect, getAnswerLogProviderIds(filterAnswerLogRounds(rounds, { now })));
    const filteredRounds = filterAnswerLogRounds(rounds, {
      now,
      query: document.getElementById('answer-log-search').value,
      providerId: providerSelect.value,
      feedback: document.getElementById('answer-log-feedback').value
    });
    const { total, shown } = renderAnswerLog(document.getElementById('answer-log-list'), filteredRounds, {
      limit: answerLogLimit,
      locale: getSharingController().getSnapshotLocale(),
      ...getAnswerViewOptions()
    });

    document.getElementById('answer-log-count').textContent = String(total);
    document.getElementById('answer-log-no-matches').hidden = total > 0;
    const moreButton = document.getElementById('answer-log-more');
    const remaining = total - shown;
    moreButton.hidden = remaining <= 0;
    moreButton.textContent = getLocalizedText('answerStatsShowMore', 'Show more ($1)', [String(remaining)]);
  }

  function showMoreAnswerLog() {
    answerLogLimit += ANSWER_STATS_RECENT_LIMIT;
    renderAnswerLogView();
  }

  function handleAnswerLogFilterChange() {
    answerLogLimit = ANSWER_STATS_RECENT_LIMIT;
    renderAnswerLogView();
  }

  function setupAnswerLog() {
    document.getElementById('answer-log-btn')?.addEventListener('click', openAnswerLogModal);
    document.getElementById('close-answer-log-modal')?.addEventListener('click', closeAnswerLogModal);
    document.getElementById('answer-log-more')?.addEventListener('click', showMoreAnswerLog);
    document.getElementById('answer-log-search')?.addEventListener('input', handleAnswerLogFilterChange);
    document.getElementById('answer-log-provider')?.addEventListener('change', handleAnswerLogFilterChange);
    document.getElementById('answer-log-feedback')?.addEventListener('change', handleAnswerLogFilterChange);
    document.getElementById('answer-log-modal')?.addEventListener('click', (event) => {
      if (event.target.id === 'answer-log-modal') {
        closeAnswerLogModal();
      }
    });
  }

  return {
    adoptPanelAnswer,
    get answerQuestionsByRound() { return answerQuestionsByRound; },
    get answerRounds() { return answerRounds; },
    get answerTextsByRound() { return answerTextsByRound; },
    closeAnswerLogModal,
    closeAnswerStatsModal,
    getLatestAnswerRound,
    handleAnswerEngagementMessage,
    handleAnswerTimingMessage,
    get isAnswerCompleteNotificationEnabled() { return isAnswerCompleteNotificationEnabled; },
    set isAnswerCompleteNotificationEnabled(value) { isAnswerCompleteNotificationEnabled = value; },
    isPanelInAnswerRound,
    get latestAnswerRoundId() { return latestAnswerRoundId; },
    registerAnswerCompleteNotificationClick,
    rejectPanelAnswer,
    setupAnswerLog,
    setupAnswerStats,
    startAnswerRound,
    updateAnswerFeedbackButtons,
    updateZoomedAnswer,
  };
}
