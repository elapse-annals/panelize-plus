/**
 * Owns panels behavior and its page-local state.
 * Deferred controller getters keep composition in the entry point.
 */
import { getProviderById, getEnabledProviders } from '../../modules/providers/providers.js';
import { DEFAULT_PROVIDER_IDS, DEFAULT_PROVIDER_ORDER, DEFAULT_STARTUP_PROVIDER_IDS } from '../../modules/providers/provider-defaults.js';
import { GROK_WEBSOCKET_COOKIE_SYNC_ACTION } from '../../modules/providers/grok-websocket-cookies.js';
import { MIMO_SESSION_COOKIE_SYNC_ACTION, reconcileMimoSessionCookies } from '../../modules/providers/mimo-session-cookies.js';
import { reconcileOptionalProviderAccess } from '../../modules/providers/optional-provider-access.js';
import { clearPerplexityServiceWorker } from '../../modules/providers/perplexity-service-worker.js';
import {
  AUTO_LAYOUT_STARTUP_PANEL_COUNT,
  MAX_PANELS,
  LAYOUT_PANEL_COUNTS,
  getAutoAdjustedLayout,
  getAutoShrunkLayout,
  isAutoLayout
} from '../../modules/panels/layout-auto-adjust.js';
import { createPanelFitState } from '../../modules/panels/panel-fit.js';
import { getStartupLayout, resolveStartupProviderIds } from '../../modules/panels/startup-providers.js';
import { clearStartupSnapshot, readStartupSnapshot, writeStartupSnapshot } from '../../modules/panels/startup-snapshot.js';
import { getRoundSpeedRanks } from '../../modules/answers/answer-stats.js';
import { PANEL_READY_STATE, PANEL_ACTIVITY, getPanelActivity } from '../../modules/panels/panel-readiness.js';
import { normalizePanelPromptMode, PANEL_PROMPT_MODE_INHERIT } from '../../modules/prompts/prompt-modes.js';
import { escapeHtml, getLocalizedText, getThemeAwareProviderIcon, isGoogleProvider, showToast } from './ui.js';

export function createPanelsController({
  getAnswersController,
  getComposerController,
  getConversationsController,
  getFocusController,
  getLayoutController,
  getPresentationController,
  getProviderControlsController,
  getSendingController
}) {
  let panels = [];

  // Array of { id, providerId, promptMode, iframe, state }
  let focusedPanelId = null;

  let loadingPanelIds = new Set();

  // 当前窗口是否为弹出窗口

  // Default panel configuration
  const DEFAULT_PROVIDERS = DEFAULT_PROVIDER_IDS;

  let hasAuthoritativePanels = false;

  // Panels restored by a tab/popup switch, kept until the next initialization.
  let restoredStartupPanels = null;

  // The providers settings resolved during the last initialization, written
  // into the snapshot so a later startup can tell whether the selection changed.
  let startupSettingsProviderIds = null;

  // The service worker owns the forwarding rule and serializes updates to it;
  // a failed sync must not block the panel from loading.
  async function requestGrokWebSocketCookieSync() {
    try {
      const response = await chrome.runtime.sendMessage({ action: GROK_WEBSOCKET_COOKIE_SYNC_ACTION });
      if (!response?.success) {
        console.warn('[Multi-Panel] Grok WebSocket cookie sync failed:', response?.error);
      }
    } catch (error) {
      console.warn('[Multi-Panel] Grok WebSocket cookie sync failed:', error);
    }
  }

  async function requestMimoSessionCookieSync() {
    try {
      const response = await chrome.runtime.sendMessage({ action: MIMO_SESSION_COOKIE_SYNC_ACTION });
      if (!response?.success) {
        console.warn('[Multi-Panel] MiMo session synchronization failed');
      }
    } catch {
      console.warn('[Multi-Panel] MiMo session synchronization failed');
    }
    // Repeat with this page's current code (see initializePanels); when the
    // service worker is up to date this finds nothing left to change.
    const result = await reconcileMimoSessionCookies();
    if (!result?.success) {
      console.warn('[Multi-Panel] MiMo session synchronization failed');
    }
  }

  const PROVIDER_SESSION_SYNC = {
    grok: requestGrokWebSocketCookieSync,
    mimo: requestMimoSessionCookieSync,
    perplexity: clearPerplexityServiceWorker
  };

  function createPanelsFromStartupSnapshot() {
    const snapshot = readStartupSnapshot();
    if (!snapshot) return;

    getLayoutController().currentLayout = snapshot.layout;
    getLayoutController().applyLayoutToGrid();
    for (const entry of snapshot.panels) {
      // Session work and optional host grants must be checked before navigation.
      // A cached grant cannot prove permission is still present on this device.
      if (Object.hasOwn(PROVIDER_SESSION_SYNC, entry.providerId) || getProviderById(entry.providerId).optionalOrigins) continue;
      createPanel(entry.providerId, { frameUrl: entry.frameUrl, promptMode: entry.promptMode });
    }
  }

  function saveStartupSnapshot() {
    if (!hasAuthoritativePanels) return;
    writeStartupSnapshot({
      layout: getLayoutController().currentLayout,
      settingsStartupProviderIds: startupSettingsProviderIds,
      panels: panels.map(panel => ({
        providerId: panel.providerId,
        frameUrl: getProviderControlsController().getProviderFrameUrl(panel.providerId),
        promptMode: normalizePanelPromptMode(panel.promptMode)
      }))
    });
  }

  function sameProviderSet(left, right) {
    const rightIds = new Set(right);
    return left.length === rightIds.size && left.every(id => rightIds.has(id));
  }

  // The panels this page starts with: a restored tab/popup switch first, then
  // the snapshot's panel list when the startup provider selection is unchanged,
  // then the providers settings resolve to.
  function resolveStartupEntries(providerIds, resolvedProviderIds) {
    const restored = restoredStartupPanels
      ?.filter(entry => providerIds.includes(entry.providerId))
      .slice(0, MAX_PANELS);
    if (restored?.length) {
      return restored.map(entry => ({
        providerId: entry.providerId,
        promptMode: normalizePanelPromptMode(entry.promptMode)
      }));
    }

    const snapshot = readStartupSnapshot();
    if (snapshot) {
      const fingerprint = snapshot.settingsStartupProviderIds
        || [...new Set(snapshot.panels.map(panel => panel.providerId))];
      if (sameProviderSet(fingerprint, resolvedProviderIds)) {
        const entries = snapshot.panels
          .filter(entry => providerIds.includes(entry.providerId))
          .slice(0, MAX_PANELS)
          .map(entry => ({ providerId: entry.providerId, promptMode: entry.promptMode }));
        if (entries.length) return entries;
      }
    }

    return resolvedProviderIds.map(providerId => ({
      providerId,
      promptMode: PANEL_PROMPT_MODE_INHERIT
    }));
  }

  async function syncProviderSession(providerId) {
    await PROVIDER_SESSION_SYNC[providerId]?.();
  }

  async function initializePanels() {
    try {
      // The provider service applies permission checks and the selected manual or
      // local-statistics order consistently with the add/switch menus.
      const [settings, enabledProviders] = await Promise.all([
        chrome.storage.sync.get({
          providerOrder: DEFAULT_PROVIDER_ORDER,
          enabledProviders: DEFAULT_PROVIDERS,
          multiPanelProviders: DEFAULT_PROVIDERS,
          startupProviders: DEFAULT_STARTUP_PROVIDER_IDS
        }),
        getEnabledProviders(),
        // This page always runs the extension's current code, while the service
        // worker can keep running an older copy after an update and then never
        // registers scripts for providers it does not know yet.
        reconcileOptionalProviderAccess()
      ]);
      const providerIds = enabledProviders.map(({ id }) => id);

      const currentLayout = getLayoutController().currentLayout;
      const panelCount = isAutoLayout(currentLayout)
        ? AUTO_LAYOUT_STARTUP_PANEL_COUNT
        : (LAYOUT_PANEL_COUNTS[currentLayout] || 4);
      const resolvedProviderIds = resolveStartupProviderIds(
        providerIds,
        settings.startupProviders,
        panelCount,
        MAX_PANELS
      );
      startupSettingsProviderIds = resolvedProviderIds;
      const startupEntries = resolveStartupEntries(providerIds, resolvedProviderIds);

      let startupLayout = getStartupLayout(getLayoutController().currentLayout, startupEntries.length);
      // Apply the same growth steps even when all frames came from the snapshot.
      for (let count = 1; count <= startupEntries.length; count += 1) {
        startupLayout = getAutoAdjustedLayout(startupLayout, count) || startupLayout;
      }
      if (startupLayout !== getLayoutController().currentLayout) {
        getLayoutController().currentLayout = startupLayout;
        getLayoutController().applyLayoutToGrid({ panelCount: startupEntries.length });
      }

      // Keep matching early frames in their existing relative order. Moving an
      // iframe's DOM ancestor would reload it, so reordered entries are recreated
      // instead, and new panels are inserted around the retained nodes.
      let previousIndex = -1;
      const reusablePanels = startupEntries.map(entry => {
        const expectedUrl = new URL(getProviderControlsController().getProviderFrameUrl(entry.providerId)).href;
        const index = panels.findIndex((panel, position) => position > previousIndex &&
          panel.providerId === entry.providerId && panel.iframe.src === expectedUrl);
        if (index !== -1) {
          previousIndex = index;
          return panels[index];
        }
        return null;
      });
      const retainedPanels = new Set(reusablePanels.filter(Boolean));
      for (const panel of [...panels]) {
        if (!retainedPanels.has(panel)) {
          removePanel(panel.id, { persist: false });
        }
      }

      // Session synchronization stays ahead of any new Grok/MiMo navigation.
      await Promise.all([...new Set(startupEntries.map(entry => entry.providerId))].map(syncProviderSession));
      const orderedPanels = startupEntries.map((entry, index) => {
        const reusable = reusablePanels[index];
        if (reusable) {
          reusable.promptMode = normalizePanelPromptMode(entry.promptMode);
          return reusable;
        }
        const nextPanel = reusablePanels.slice(index + 1).find(Boolean);
        return createPanel(entry.providerId, {
          beforePanelId: nextPanel?.id,
          promptMode: entry.promptMode
        });
      }).filter(Boolean);
      panels = orderedPanels;
      hasAuthoritativePanels = true;
      panels.forEach(panel => {
        getProviderControlsController().bindPanelHeaderActions(panel.id);
        // Early frames may have finished loading before their style settings.
        getPresentationController().postPageStyleToPanel(panel);
      });
      getProviderControlsController().syncGoogleModeControls();
      getProviderControlsController().syncPanelPromptModeControls();

      // The auto layout's columns track the reconciled panel count.
      getLayoutController().syncAutoLayoutColumns();

      // Not awaited: storage calls are slow while the frames load, and nothing
      // during startup reads it back.
      getPresentationController().saveProviderConfiguration();

      // Update panel selectors in toolbar
      updatePanelSelectors();
    } catch (error) {
      clearStartupSnapshot();
      for (const panel of [...panels]) removePanel(panel.id, { persist: false });
      console.error('Error initializing panels:', error);
    }
  }

  // ===== Panel Management =====

  function setFocusedPanel(panelId) {
    const wasFocusActive = focusedPanelId !== null;
    focusedPanelId = panels.some(panel => panel.id === panelId) ? panelId : null;
    document.getElementById('main-content').classList.toggle('panel-focus-active', focusedPanelId !== null);

    // An absolutely positioned panel no longer occupies a grid cell. Keep the
    // other panels in their original columns so their hidden frames keep their
    // viewport sizes, including when columns have custom widths. Cells are only
    // assigned on entering focus, so removing a panel does not shift the rest.
    const grid = document.getElementById('panel-grid');
    const columnCount = focusedPanelId && !wasFocusActive
      ? window.getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length
      : 0;
    getPresentationController().getDisplayedPanels().forEach((panel, index) => {
      const panelEl = document.getElementById(panel.id);
      const isFocused = panel.id === focusedPanelId;
      panelEl.classList.toggle('panel-focused', isFocused);
      if (!focusedPanelId) {
        panelEl.style.gridColumnStart = '';
        panelEl.style.gridRowStart = '';
      } else if (columnCount) {
        panelEl.style.gridColumnStart = String(index % columnCount + 1);
        panelEl.style.gridRowStart = String(Math.floor(index / columnCount) + 1);
      }
      const button = panelEl.querySelector('.focus-panel-btn');
      if (button) {
        button.title = isFocused
          ? getLocalizedText('exitFocusPanelTitle', 'Exit focus mode')
          : getLocalizedText('focusPanelTitle', 'Focus this panel');
        button.setAttribute('aria-label', button.title);
        button.setAttribute('aria-pressed', String(isFocused));
        button.querySelector('.material-symbols-outlined').textContent = isFocused ? 'close_fullscreen' : 'open_in_full';
      }
    });
    document.querySelectorAll('.panel-selector').forEach(selector => {
      selector.classList.toggle('panel-focused', selector.dataset.panelId === focusedPanelId);
    });
    getAnswersController().updateZoomedAnswer();
    // Focus hides the summary card, so its grid column and handles change too.
    getLayoutController().panelResize?.refresh();
    getPresentationController().updatePanelEdgeButtons?.();
  }

  async function addPanel(providerId, options = {}) {
    if (panels.length >= MAX_PANELS) {
      showToast(`Maximum number of panels reached (${MAX_PANELS})`);
      return null;
    }

    // The early check avoids a needless session sync; createPanel repeats it
    // synchronously after the await so concurrent callers cannot both pass.
    await syncProviderSession(providerId);

    const panel = createPanel(providerId, options);
    if (!panel) {
      return null;
    }

    // Save provider configuration
    await getPresentationController().saveProviderConfiguration();

    // Update panel selectors to show logo and name
    updatePanelSelectors();
    return panel;
  }

  // Duplicates the panel's provider right after it. The provider is already
  // loaded in this page, so no session sync is needed before the new frame.
  function clonePanel(panelId) {
    const panel = panels.find(candidate => candidate.id === panelId);
    if (!panel) return null;

    const clone = createPanel(panel.providerId, {
      afterPanelId: panelId,
      promptMode: panel.promptMode
    });
    if (!clone) return null;

    void getPresentationController().saveProviderConfiguration();
    updatePanelSelectors();
    return clone;
  }

  // Synchronous so concurrent callers cannot both pass the capacity check.
  // Callers sync the provider session first.
  function createPanel(providerId, {
    frameUrl = getProviderControlsController().getProviderFrameUrl(providerId),
    beforePanelId,
    afterPanelId,
    promptMode
  } = {}) {
    if (panels.length >= MAX_PANELS) {
      showToast(`Maximum number of panels reached (${MAX_PANELS})`);
      return null;
    }

    const provider = getProviderById(providerId);
    if (!provider) {
      console.error('Provider not found:', providerId);
      return null;
    }

    const panelPromptMode = normalizePanelPromptMode(promptMode);

    // Everything from the capacity check to panels.push() below runs without
    // awaiting, so concurrent calls cannot both pass the check.
    // Auto layout adjustment: upgrade from 1xN to 1x(N+1) when adding panel exceeds capacity
    const newPanelCount = panels.length + 1;
    const adjustedLayout = getAutoAdjustedLayout(getLayoutController().currentLayout, newPanelCount);

    if (adjustedLayout) {
      setFocusedPanel(null);
      // Apply layout directly without calling setLayout (to avoid recursion from adjustPanelCount)
      getLayoutController().currentLayout = adjustedLayout;
      const panelGrid = document.getElementById('panel-grid');
      panelGrid.className = `layout-${adjustedLayout}`;

      // Update layout button states (if layout modal is open)
      document.querySelectorAll('.layout-option').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.layout === adjustedLayout);
      });
      // The adjusted layout is saved together with the new panel below.
    }

    const panelId = `panel-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const panelGrid = document.getElementById('panel-grid');

    // Create panel element
    const panelEl = document.createElement('div');
    panelEl.className = 'panel-item';
    panelEl.id = panelId;
    panelEl.innerHTML = `
    <div class="panel-header">
      <div class="panel-header-left">
        <img src="${getThemeAwareProviderIcon(provider)}" alt="${provider.name}" class="provider-icon" data-provider-id="${provider.id}">
        <span class="provider-name">${provider.name}</span>
        <span class="provider-note" role="button" tabindex="0"></span>
        <span class="blind-label" aria-hidden="true"></span>
      </div>
      <div class="panel-header-right">${getProviderControlsController().getPanelHeaderRightHtml(providerId, { promptMode: panelPromptMode })}</div>
    </div>
    <div class="panel-iframe-container">
      <div class="panel-loading">
        <img src="${getThemeAwareProviderIcon(provider)}" alt="${provider.name}" class="loading-icon" data-provider-id="${provider.id}">
        <span class="loading-text">Loading ${provider.name}...</span>
      </div>
      <iframe
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
        allow="clipboard-read; clipboard-write"
      ></iframe>
    </div>
  `;

    getPresentationController().bindPanelNote(panelEl, panelId);
    getPresentationController().renderPanelNote(panelEl, providerId);

    // Get iframe reference
    const iframe = panelEl.querySelector('iframe');
    iframe.src = frameUrl;
    const loadingEl = panelEl.querySelector('.panel-loading');

    // Handle iframe load
    // Grace period after load to catch AI pages that auto-focus after JS init
    const LOAD_GRACE_PERIOD = 5000;
    let initialStateHandled = false;
    loadingPanelIds.add(panelId);
    iframe.addEventListener('load', () => {
      loadingEl.classList.add('hidden');
      const panel = panels.find(p => p.id === panelId);
      if (panel) {
        getFocusController().startPanelFocusGuard(panel);
        getPresentationController().postPageStyleToPanel(panel);
        getComposerController().composerControls?.panelLoaded(panel);
        // Only the panel's own first document is checked: later loads are
        // navigation the user or a provider flow asked for.
        if (!initialStateHandled) {
          initialStateHandled = true;
          void getConversationsController().ensureFreshChat(panel);
        }
      }
      if (getConversationsController().isTemporaryChatModeEnabled && panel && getConversationsController().requiresTemporaryChatActivationRetry(panel.providerId)) {
        getConversationsController().startTemporaryChatActivationForPanel(panel);
      }
      setTimeout(() => {
        loadingPanelIds.delete(panelId);
      }, LOAD_GRACE_PERIOD);
    });

    iframe.addEventListener('error', () => {
      loadingEl.innerHTML = `<img src="${getThemeAwareProviderIcon(provider)}" alt="${provider.name}" class="loading-icon" data-provider-id="${provider.id}"><span class="loading-text">Failed to load ${provider.name}</span>`;
      loadingPanelIds.delete(panelId);
      const panel = panels.find(p => p.id === panelId);
      if (panel) getSendingController().setPanelReadyState(panel, PANEL_READY_STATE.TIMEOUT);
    });

    // Add to panels array
    const panel = {
      id: panelId,
      providerId,
      promptMode: panelPromptMode,
      iframe,
      currentUrl: null,
      state: 'loading',
      pageNeededWidth: 0,
      fit: createPanelFitState()
    };
    // The summary answer card is the grid's last child; new panels go before it.
    const anchorEl = afterPanelId ? document.getElementById(afterPanelId) : null;
    const insertionPoint = anchorEl
      ? anchorEl.nextElementSibling
      : (beforePanelId
        ? document.getElementById(beforePanelId)
        : document.getElementById('ai-summary-panel'));
    panelGrid.insertBefore(panelEl, insertionPoint?.parentElement === panelGrid ? insertionPoint : null);
    const anchorIndex = afterPanelId || beforePanelId
      ? panels.findIndex(candidate => candidate.id === (afterPanelId || beforePanelId))
      : -1;
    if (afterPanelId && anchorIndex !== -1) panels.splice(anchorIndex + 1, 0, panel);
    else if (beforePanelId && anchorIndex !== -1) panels.splice(anchorIndex, 0, panel);
    else panels.push(panel);
    getLayoutController().syncAutoLayoutColumns();
    getSendingController().startPanelReadiness(panel);
    getLayoutController().panelFitObserver?.observe(iframe.parentElement);
    getSendingController().resetFillRetryState();

    if (hasAuthoritativePanels) getProviderControlsController().bindPanelHeaderActions(panelId);

    return panel;
  }

  function removePanel(panelId, { persist = true } = {}) {
    const panelIndex = panels.findIndex(p => p.id === panelId);
    if (panelIndex === -1) return;
    getConversationsController().failedNewChatPanelIds.delete(panelId);
    getConversationsController().newChatResults.delete(panelId);

    if (focusedPanelId === panelId || getAutoShrunkLayout(getLayoutController().currentLayout, panels.length - 1)) {
      setFocusedPanel(null);
    }

    const fitContainer = panels[panelIndex].iframe?.parentElement;
    if (fitContainer) {
      getLayoutController().panelFitObserver?.unobserve(fitContainer);
    }

    // Remove from DOM
    const panelEl = document.getElementById(panelId);
    if (panelEl) {
      panelEl.remove();
    }

    // Remove from arrays and sets
    clearTimeout(panels[panelIndex].readyTimerId);
    panels.splice(panelIndex, 1);
    getComposerController().composerControls?.panelsChanged();
    loadingPanelIds.delete(panelId);
    getSendingController().renderReadinessStatus();
    getSendingController().resetFillRetryState();

    // Auto-shrink layout if applicable
    const shrunkLayout = persist && getAutoShrunkLayout(getLayoutController().currentLayout, panels.length);
    if (shrunkLayout) {
      getLayoutController().currentLayout = shrunkLayout;
      const panelGrid = document.getElementById('panel-grid');
      panelGrid.className = `layout-${shrunkLayout}`;

      // Update layout button states
      document.querySelectorAll('.layout-option').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.layout === shrunkLayout);
      });

      // Save configuration with the new layout
      getPresentationController().saveProviderConfiguration();
    }

    // Update selectors
    updatePanelSelectors();

    // Auto layout columns follow the remaining panel count.
    getLayoutController().syncAutoLayoutColumns();

    // Save configuration
    if (persist) getPresentationController().saveProviderConfiguration();
  }

  async function switchPanelProvider(panelId, newProviderId) {
    const panel = panels.find(p => p.id === panelId);
    if (!panel) return;

    const provider = getProviderById(newProviderId);
    if (!provider) return;

    const panelEl = document.getElementById(panelId);
    if (!panelEl) return;

    getSendingController().resetFillRetryState();

    if (isGoogleProvider(newProviderId)) {
      getProviderControlsController().syncGoogleModeControls();
    }

    await syncProviderSession(newProviderId);

    // Update panel header
    const headerIcon = panelEl.querySelector('.panel-header-left img');
    const headerName = panelEl.querySelector('.panel-header-left .provider-name');
    const headerRight = panelEl.querySelector('.panel-header-right');
    headerIcon.src = getThemeAwareProviderIcon(provider);
    headerIcon.dataset.providerId = provider.id;
    headerIcon.alt = provider.name;
    headerName.textContent = provider.name;
    getPresentationController().renderPanelNote(panelEl, newProviderId);
    headerRight.innerHTML = getProviderControlsController().getPanelHeaderRightHtml(newProviderId, {
      promptMode: panel.promptMode
    });

    // Update iframe
    const iframe = panelEl.querySelector('iframe');

    // Update panel data
    getConversationsController().failedNewChatPanelIds.delete(panelId);
    getConversationsController().newChatResults.delete(panelId);
    // Reloading a provider leaves this round's answer, even if it is selected again.
    panel.clearedAnswerRoundId = getAnswersController().latestAnswerRoundId;
    panel.providerId = newProviderId;
    getComposerController().composerControls?.panelsChanged();
    panel.iframe = iframe;
    panel.currentUrl = null;
    panel.pageNeededWidth = 0;
    getLayoutController().updatePanelFit(panel);
    getProviderControlsController().bindPanelHeaderActions(panelId);
    getProviderControlsController().reloadPanelIframe(panel);

    // Update selectors and save
    updatePanelSelectors();
    await getPresentationController().saveProviderConfiguration();
  }

  function updatePanelSelectors() {
    const selectorsContainer = document.getElementById('panel-selectors');
    selectorsContainer.innerHTML = '';

    panels.forEach(panel => {
      const provider = getProviderById(panel.providerId);
      if (!provider) return;

      const selector = document.createElement('div');
      selector.className = 'panel-selector';
      selector.dataset.panelId = panel.id;
      selector.innerHTML = `
      <span class="provider-icon-wrap">
        <img src="${getThemeAwareProviderIcon(provider)}" alt="${provider.name}" class="provider-icon" data-provider-id="${provider.id}">
        <span class="panel-activity" aria-hidden="true"></span>
        <span class="panel-speed-crown" aria-hidden="true">
          <svg viewBox="0 0 24 16" width="13" height="9" fill="currentColor"><path d="M2 14 0.5 3.5l6 4.5L12 0l5.5 8 6-4.5L22 14z"/><rect x="2" y="14" width="20" height="2" rx="1"/></svg>
        </span>
      </span>
      <span class="provider-name">${escapeHtml(getPresentationController().getPanelDisplayName(panel, { short: true }))}</span>
      <span class="blind-label" aria-hidden="true"></span>
      <button class="remove-panel" title="Remove panel">
        <span class="material-symbols-outlined">close</span>
      </button>
    `;

      selector.addEventListener('click', () => {
        if (focusedPanelId) {
          setFocusedPanel(panel.id);
        } else {
          getPresentationController().jumpToPanelElement(panel.id);
        }
      });

      // Remove button handler
      const removeBtn = selector.querySelector('.remove-panel');
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (panels.length > 1) {
          removePanel(panel.id);
        } else {
          showToast('At least one panel is required');
        }
      });

      selectorsContainer.appendChild(selector);
    });
    setFocusedPanel(focusedPanelId);
    getPresentationController().renderBlindLabels();
  }

  const PANEL_ACTIVITY_LABELS = {
    [PANEL_ACTIVITY.PREPARING]: ['panelActivityPreparing', 'Preparing'],
    [PANEL_ACTIVITY.NOT_READY]: ['panelActivityNotReady', 'Not ready; check sign-in or reload'],
    [PANEL_ACTIVITY.RUNNING]: ['panelActivityRunning', 'Answering'],
    [PANEL_ACTIVITY.DONE]: ['panelActivityDone', 'Answer complete'],
    [PANEL_ACTIVITY.STALLED]: ['panelActivityStalled', "Couldn't confirm the answer finished"]
  };

  // Marks each tab chip with its panel's loading or answering state and, for the
  // three fastest answers of the latest round, a gold, silver or bronze crown; the
  // chip's tooltip names the panel (anonymously in blind mode) and adds both.
  function renderPanelActivity() {
    const round = getAnswersController().getLatestAnswerRound();
    const speedRanks = getRoundSpeedRanks(round);
    document.querySelectorAll('#panel-selectors .panel-selector').forEach(selector => {
      const panel = panels.find(candidate => candidate.id === selector.dataset.panelId);
      if (!panel) return;
      const answer = getAnswersController().isPanelInAnswerRound(round, panel) ? round.answers[panel.id] : null;
      const activity = getPanelActivity(panel, answer);
      selector.dataset.activity = activity;
      const speedRank = answer ? speedRanks[panel.id] : undefined;
      if (speedRank) {
        selector.dataset.speedRank = String(speedRank);
      } else {
        delete selector.dataset.speedRank;
      }
      const label = PANEL_ACTIVITY_LABELS[activity];
      const parts = [getPresentationController().getPanelDisplayName(panel)];
      if (label) parts.push(getLocalizedText(...label));
      if (speedRank) parts.push(getLocalizedText('panelSpeedRank', 'Fastest answer #$1', [String(speedRank)]));
      selector.title = parts.join(' · ');
    });
  }

  // Create new chat for all panels
  // Matches a snapshot taken before an await against the live panel list, so a
  // panel removed or switched to another provider meanwhile is ignored.
  function findCurrentPanel(target) {
    return panels.find(panel => panel.id === target.id && panel.providerId === target.providerId);
  }

  return {
    get DEFAULT_PROVIDERS() { return DEFAULT_PROVIDERS; },
    addPanel,
    clonePanel,
    createPanelsFromStartupSnapshot,
    findCurrentPanel,
    get focusedPanelId() { return focusedPanelId; },
    initializePanels,
    get loadingPanelIds() { return loadingPanelIds; },
    get panels() { return panels; },
    removePanel,
    renderPanelActivity,
    requestMimoSessionCookieSync,
    get restoredStartupPanels() { return restoredStartupPanels; },
    set restoredStartupPanels(value) { restoredStartupPanels = value; },
    saveStartupSnapshot,
    setFocusedPanel,
    switchPanelProvider,
  };
}
