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
import { PANEL_PROMPT_MODE_INHERIT, normalizePanelPromptMode } from '../../modules/prompts/prompt-modes.js';
import { saveSetting } from '../../modules/platform/settings.js';
import { fitPanelSelectWidth, getLocalizedText, getThemeAwareProviderIcon, isGoogleProvider } from './ui.js';

export function createProviderControlsController({
  getAnswersController,
  getComposerController,
  getConversationsController,
  getPanelsController,
  getPresentationController,
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

  function getPromptModeSelectHtml(promptMode = PANEL_PROMPT_MODE_INHERIT) {
    const title = getLocalizedText('composerPromptModeLabel', 'Prompt mode');
    const inheritLabel = getLocalizedText('panelPromptModeInherit', 'Follow global');
    const selected = normalizePanelPromptMode(promptMode) === PANEL_PROMPT_MODE_INHERIT ? ' selected' : '';
    return `
    <select class="panel-prompt-mode-select" title="${title}" aria-label="${title}">
      <option value="${PANEL_PROMPT_MODE_INHERIT}"${selected}>${inheritLabel}</option>
    </select>
  `;
  }

  function getPanelHeaderRightHtml(providerId, { promptMode = PANEL_PROMPT_MODE_INHERIT } = {}) {
    const googleModeSelect = isGoogleProvider(providerId)
      ? getGoogleModeSelectHtml()
      : '';
    const promptModeSelect = getPromptModeSelectHtml(promptMode);
    const cloneTitle = getLocalizedText('panelCloneTitle', 'Duplicate this AI panel');

    const openTopLevelBtn = `<button class="open-provider-top-level-btn" title="${getLocalizedText('openProviderTopLevelTitle', 'Open in new tab')}">
      <span class="material-symbols-outlined">open_in_new</span>
    </button>`;

    return `
    ${googleModeSelect}
    ${promptModeSelect}
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
    <button class="clone-panel-btn" title="${cloneTitle}" aria-label="${cloneTitle}">
      <span class="material-symbols-outlined">content_copy</span>
    </button>
    <button class="switch-provider-btn" title="Switch Provider">
      <span class="material-symbols-outlined">swap_horiz</span>
    </button>
  `;
  }

  function populatePanelPromptModeSelect(select, panel, options) {
    const title = getLocalizedText('composerPromptModeLabel', 'Prompt mode');
    select.title = title;
    select.setAttribute('aria-label', title);
    const signature = options.map(option => `${option.value}\u0000${option.title}`).join('\n');
    if (select.dataset.optionsSignature !== signature) {
      select.replaceChildren(...options.map(({ value, title }) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = title;
        return option;
      }));
      select.dataset.optionsSignature = signature;
    }
    const mode = normalizePanelPromptMode(panel.promptMode);
    select.value = options.some(option => option.value === mode) ? mode : PANEL_PROMPT_MODE_INHERIT;
  }

  function getPanelPromptModeOptions(controls) {
    return [
      { value: PANEL_PROMPT_MODE_INHERIT, title: getLocalizedText('panelPromptModeInherit', 'Follow global') },
      ...(controls?.getPromptModeOptions?.() || [])
    ];
  }

  // Rebuilds every panel's mode choices from the library. A fixed mode deleted
  // from the library falls back to inherit; only a successful load may reset.
  function syncPanelPromptModeControls() {
    const controls = getComposerController().composerControls;
    if (!controls?.hasLoadedPromptModes) return;

    const modeOptions = controls.getPromptModeOptions();
    const options = getPanelPromptModeOptions(controls);
    let resetMode = false;
    getPanelsController().panels.forEach(panel => {
      if (panel.promptMode !== PANEL_PROMPT_MODE_INHERIT
          && !modeOptions.some(option => option.value === panel.promptMode)) {
        panel.promptMode = PANEL_PROMPT_MODE_INHERIT;
        resetMode = true;
      }
      const select = document.getElementById(panel.id)?.querySelector('.panel-prompt-mode-select');
      if (!select) return;
      populatePanelPromptModeSelect(select, panel, options);
      fitPanelSelectWidth(select);
    });
    if (resetMode) getPanelsController().saveStartupSnapshot();
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

    const promptModeSelect = panelEl.querySelector('.panel-prompt-mode-select');
    if (promptModeSelect) {
      const controls = getComposerController().composerControls;
      if (controls?.hasLoadedPromptModes) {
        populatePanelPromptModeSelect(promptModeSelect, panel, getPanelPromptModeOptions(controls));
      }
      fitPanelSelectWidth(promptModeSelect);
      promptModeSelect.addEventListener('click', (event) => {
        event.stopPropagation();
      });
      promptModeSelect.addEventListener('mousedown', (event) => {
        event.stopPropagation();
      });
      promptModeSelect.addEventListener('change', (event) => {
        panel.promptMode = normalizePanelPromptMode(event.target.value);
        fitPanelSelectWidth(event.target);
        getPanelsController().saveStartupSnapshot();
        getPresentationController().renderPanelNames();
      });
    }

    panelEl.querySelector('.clone-panel-btn')?.addEventListener('click', () => {
      getPanelsController().clonePanel(panelId);
    });
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
    syncPanelPromptModeControls,
    updateGoogleProviderMode,
  };
}
