/**
 * Owns provider controls behavior and its page-local state.
 * Deferred controller getters keep composition in the entry point.
 */
import { getProviderById } from '../../modules/providers/providers.js';
import { clearPerplexityServiceWorker } from '../../modules/providers/perplexity-service-worker.js';
import {
  DEFAULT_GOOGLE_PROVIDER_MODE,
  GOOGLE_PROVIDER_MODE_AI,
  GOOGLE_PROVIDER_MODE_SEARCH,
  getGoogleProviderUrl,
  normalizeGoogleProviderMode
} from '../../modules/providers/google-mode.js';
import { getProviderOpenUrl } from '../../modules/providers/provider-open-url.js';
import { saveSetting } from '../../modules/platform/settings.js';
import { fitPanelSelectWidth, getLocalizedText, getThemeAwareProviderIcon, isGoogleProvider } from './ui.js';

export function createProviderControlsController({
  getAnswersController,
  getConversationsController,
  getPanelsController,
  getProviderMenusController,
  getSendingController
}) {
  let currentGoogleProviderMode = DEFAULT_GOOGLE_PROVIDER_MODE;

  function getPanelProviderMode(panel) {
    return isGoogleProvider(panel.providerId) ? currentGoogleProviderMode : null;
  }

  function getProviderFrameUrl(providerId) {
    const provider = getProviderById(providerId);
    if (!provider) {
      return '';
    }

    if (getConversationsController().isTemporaryChatModeEnabled && getConversationsController().isUrlDrivenTemporaryChatProvider(providerId)) {
      return getConversationsController().getTemporaryChatUrl(providerId);
    }

    return isGoogleProvider(providerId)
      ? getGoogleProviderUrl(currentGoogleProviderMode)
      : provider.url;
  }

  function getGoogleModeSelectHtml(mode = currentGoogleProviderMode) {
    const normalizedMode = normalizeGoogleProviderMode(mode);
    return `
    <select class="panel-google-mode-select" title="Google mode">
      <option value="${GOOGLE_PROVIDER_MODE_AI}" ${normalizedMode === GOOGLE_PROVIDER_MODE_AI ? 'selected' : ''}>AI Mode</option>
      <option value="${GOOGLE_PROVIDER_MODE_SEARCH}" ${normalizedMode === GOOGLE_PROVIDER_MODE_SEARCH ? 'selected' : ''}>Search</option>
    </select>
  `;
  }

  function getPanelHeaderRightHtml(providerId) {
    const googleModeSelect = isGoogleProvider(providerId)
      ? getGoogleModeSelectHtml()
      : '';

    const openTopLevelBtn = `<button class="open-provider-top-level-btn" title="${getLocalizedText('openProviderTopLevelTitle', 'Open in new tab')}">
      <span class="material-symbols-outlined">open_in_new</span>
    </button>`;

    return `
    ${googleModeSelect}
    <button class="adopt-answer-btn" title="${getLocalizedText('adoptAnswerTitle', 'Adopt this answer')}" aria-pressed="false" disabled>
      <span class="material-symbols-outlined">thumb_up</span>
    </button>
    <button class="reject-answer-btn" title="${getLocalizedText('rejectAnswerTitle', 'Deduct 5 points')}" aria-pressed="false" disabled>
      <span class="material-symbols-outlined" aria-hidden="true">thumb_up</span>
    </button>
    ${openTopLevelBtn}
    <button class="refresh-panel-btn" title="Refresh">
      <span class="material-symbols-outlined">refresh</span>
    </button>
    <button class="focus-panel-btn" title="${getLocalizedText('focusPanelTitle', 'Focus this panel')}" aria-pressed="false">
      <span class="material-symbols-outlined">open_in_full</span>
    </button>
    <button class="switch-provider-btn" title="Switch Provider">
      <span class="material-symbols-outlined">swap_horiz</span>
    </button>
  `;
  }

  function syncGoogleModeControls() {
    document.querySelectorAll('.panel-google-mode-select').forEach((select) => {
      if (select.value !== currentGoogleProviderMode) {
        select.value = currentGoogleProviderMode;
      }
      fitPanelSelectWidth(select);
    });
  }

  function showPanelLoadingState(panelEl, provider) {
    const loadingEl = panelEl.querySelector('.panel-loading');
    if (!loadingEl || !provider) {
      return;
    }

    loadingEl.classList.remove('hidden');
    loadingEl.innerHTML = `<img src="${getThemeAwareProviderIcon(provider)}" alt="${provider.name}" class="loading-icon" data-provider-id="${provider.id}"><span class="loading-text">Loading ${provider.name}...</span>`;
  }

  async function reloadPanelIframe(panel, overrideUrl = null) {
    if (panel.providerId === 'mimo') {
      await getPanelsController().requestMimoSessionCookieSync();
    }
    if (panel.providerId === 'perplexity') {
      await clearPerplexityServiceWorker();
    }
    const panelEl = document.getElementById(panel.id);
    const provider = getProviderById(panel.providerId);
    if (!panelEl || !provider) {
      return;
    }

    const iframe = panelEl.querySelector('iframe');
    if (!iframe) {
      return;
    }

    showPanelLoadingState(panelEl, provider);
    getPanelsController().loadingPanelIds.add(panel.id);
    panel.currentUrl = null;
    iframe.src = overrideUrl || getProviderFrameUrl(panel.providerId);
    panel.iframe = iframe;
    getSendingController().startPanelReadiness(panel);
  }

  async function openProviderTopLevel(panel) {
    const provider = getProviderById(panel?.providerId);
    if (!provider) {
      return;
    }

    const url = getProviderOpenUrl(provider, panel.currentUrl, getPanelProviderMode(panel));

    try {
      if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
        await chrome.tabs.create({ url });
        return;
      }

      window.open(url, '_blank', 'noopener');
    } catch (error) {
      console.error('Failed to open provider tab:', error);
    }
  }

  function bindPanelHeaderActions(panelId) {
    const panel = getPanelsController().panels.find(p => p.id === panelId);
    const panelEl = document.getElementById(panelId);
    if (!panel || !panelEl) {
      return;
    }

    const adoptBtn = panelEl.querySelector('.adopt-answer-btn');
    if (adoptBtn) {
      adoptBtn.addEventListener('click', () => {
        getAnswersController().adoptPanelAnswer(panelId);
      });
    }
    panelEl.querySelector('.reject-answer-btn')?.addEventListener('click', () => {
      getAnswersController().rejectPanelAnswer(panelId);
    });
    getAnswersController().updateAnswerFeedbackButtons();

    const openTopLevelBtn = panelEl.querySelector('.open-provider-top-level-btn');
    if (openTopLevelBtn) {
      openTopLevelBtn.addEventListener('click', () => {
        openProviderTopLevel(panel);
      });
    }

    const refreshBtn = panelEl.querySelector('.refresh-panel-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        reloadPanelIframe(panel);
      });
    }

    const focusBtn = panelEl.querySelector('.focus-panel-btn');
    if (focusBtn) {
      focusBtn.addEventListener('click', () => {
        getPanelsController().setFocusedPanel(getPanelsController().focusedPanelId === panelId ? null : panelId);
      });
    }
    // Provider switches replace the header, including the focus button.
    getPanelsController().setFocusedPanel(getPanelsController().focusedPanelId);

    const switchBtn = panelEl.querySelector('.switch-provider-btn');
    if (switchBtn) {
      switchBtn.addEventListener('click', () => {
        getProviderMenusController().showProviderSwitcher(panelId);
      });
    }

    const googleModeSelect = panelEl.querySelector('.panel-google-mode-select');
    if (googleModeSelect) {
      fitPanelSelectWidth(googleModeSelect);
      googleModeSelect.addEventListener('click', (event) => {
        event.stopPropagation();
      });
      googleModeSelect.addEventListener('mousedown', (event) => {
        event.stopPropagation();
      });
      googleModeSelect.addEventListener('change', async (event) => {
        fitPanelSelectWidth(event.target);
        await updateGoogleProviderMode(event.target.value, { persist: true, reloadPanels: true });
      });
    }
  }

  async function updateGoogleProviderMode(mode, { persist = false, reloadPanels = false } = {}) {
    const normalizedMode = normalizeGoogleProviderMode(mode);
    const modeChanged = currentGoogleProviderMode !== normalizedMode;
    currentGoogleProviderMode = normalizedMode;
    getPanelsController().saveStartupSnapshot();
    syncGoogleModeControls();

    if (reloadPanels && modeChanged) {
      getPanelsController().panels
        .filter(panel => isGoogleProvider(panel.providerId))
        .forEach(panel => reloadPanelIframe(panel));
    }

    if (persist) {
      await saveSetting('googleProviderMode', normalizedMode);
    }
  }

  return {
    bindPanelHeaderActions,
    get currentGoogleProviderMode() { return currentGoogleProviderMode; },
    set currentGoogleProviderMode(value) { currentGoogleProviderMode = value; },
    getPanelHeaderRightHtml,
    getPanelProviderMode,
    getProviderFrameUrl,
    reloadPanelIframe,
    syncGoogleModeControls,
    updateGoogleProviderMode,
  };
}
