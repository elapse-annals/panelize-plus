/**
 * Owns presentation behavior and its page-local state.
 * Deferred controller getters keep composition in the entry point.
 */
import { getProviderById, getProviderShortName } from '../../modules/providers/providers.js';
import { saveSetting } from '../../modules/platform/settings.js';
import { formatShortcutForTooltip, matchesShortcut } from '../../modules/composer/keyboard-shortcuts.js';
import { shuffleOrder, syncDisplayOrder } from '../../modules/panels/blind-shuffle.js';
import { getLocalizedText, isAnyModalOpen, showToast } from './ui.js';
import { PANELIZE_PAGE_STYLE } from './protocol.js';

export function createPresentationController({
  getAnswersController,
  getComposerController,
  getLayoutController,
  getPanelsController,
  getSendingController,
  getSharingController,
  getSummaryController
}) {
  let isBlindModeEnabled = false;

  let isWideContentEnabled = false;

  // Panel ids in display order once blind mode has shuffled them; null keeps
  // the saved order. Only CSS order changes, so frames never reload.
  let panelDisplayOrder = null;

  let providerNotes = {};

  // ===== Blind mode & wide content =====

  function getPanelDisplayName(panel, { blind = isBlindModeEnabled, short = false } = {}) {
    if (blind) {
      const position = getDisplayedPanels().findIndex(candidate => candidate.id === panel.id) + 1;
      return `${getLocalizedText('blindPanelLabel', 'Anonymous model')} ${position > 0 ? position : 1}`;
    }
    const provider = getProviderById(panel.providerId);
    const baseName = short ? getProviderShortName(provider) : (provider?.name || panel.providerId);
    // A fixed mode names the panel even when its AI is open once.
    const modeTitle = getComposerController().composerControls?.getPromptModeTitle?.(panel.promptMode);
    if (modeTitle) return `${baseName} · ${modeTitle}`;
    const sameProvider = getPanelsController().panels
      .filter(candidate => candidate.providerId === panel.providerId);
    if (sameProvider.length > 1) {
      const index = sameProvider.findIndex(candidate => candidate.id === panel.id) + 1;
      if (index > 0) return `${baseName} #${index}`;
    }
    return baseName;
  }

  // Panel headers and tab chips share the same per-panel label; the chips use
  // the short provider name to fit the toolbar.
  function renderPanelNames() {
    const panels = getPanelsController().panels;
    panels.forEach(panel => {
      const headerName = document.getElementById(panel.id)?.querySelector('.panel-header-left .provider-name');
      if (headerName) headerName.textContent = getPanelDisplayName(panel);
    });
    document.querySelectorAll('#panel-selectors .panel-selector').forEach(selector => {
      const panel = panels.find(candidate => candidate.id === selector.dataset.panelId);
      const nameEl = selector.querySelector('.provider-name');
      if (panel && nameEl) nameEl.textContent = getPanelDisplayName(panel, { short: true });
    });
    getPanelsController().renderPanelActivity();
    getSendingController().renderReadinessStatus();
    getComposerController().composerControls?.panelsChanged();
  }

  // ===== Panel Notes =====
  // A one-line, per-provider note shown after the name (e.g. "good for brainstorming").
  const PANEL_NOTE_MAX_LENGTH = 80;

  function getProviderNote(providerId) {
    const note = providerNotes?.[providerId];
    return typeof note === 'string' ? note : '';
  }

  function renderPanelNote(panelEl, providerId) {
    const noteEl = panelEl?.querySelector('.provider-note');
    if (!noteEl) return;
    const note = getProviderNote(providerId);
    noteEl.textContent = note || getLocalizedText('panelNotePlaceholder', 'Add note');
    noteEl.classList.toggle('is-empty', !note);
    noteEl.title = note || getLocalizedText('panelNoteEditTitle', 'Add a one-line note about this AI');
    noteEl.setAttribute('aria-label', noteEl.title);
  }

  function renderAllPanelNotes() {
    getPanelsController().panels.forEach(panel => renderPanelNote(document.getElementById(panel.id), panel.providerId));
  }

  async function saveProviderNote(providerId, note) {
    const next = { ...providerNotes };
    if (note) next[providerId] = note.slice(0, PANEL_NOTE_MAX_LENGTH);
    else delete next[providerId];
    providerNotes = next;
    await saveSetting('providerNotes', Object.keys(next).length ? next : null);
  }

  function startPanelNoteEdit(panelId) {
    const panel = getPanelsController().panels.find(candidate => candidate.id === panelId);
    const panelEl = document.getElementById(panelId);
    const noteEl = panelEl?.querySelector('.provider-note');
    if (!panel || !noteEl || isBlindModeEnabled || panelEl.querySelector('.provider-note-input')) return;

    const { providerId } = panel;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'provider-note-input';
    input.maxLength = PANEL_NOTE_MAX_LENGTH;
    input.value = getProviderNote(providerId);
    input.placeholder = getLocalizedText('panelNoteEditTitle', 'Add a one-line note about this AI');
    input.setAttribute('aria-label', input.placeholder);
    noteEl.hidden = true;
    noteEl.after(input);
    input.focus();
    input.select();

    let finished = false;
    const finish = async (save) => {
      if (finished) return;
      finished = true;
      const value = input.value.trim();
      input.remove();
      noteEl.hidden = false;
      if (save && value !== getProviderNote(providerId)) await saveProviderNote(providerId, value);
      renderPanelNote(panelEl, getPanelsController().panels.find(candidate => candidate.id === panelId)?.providerId || providerId);
    };
    input.addEventListener('keydown', (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        void finish(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        void finish(false);
      }
    });
    input.addEventListener('blur', () => { void finish(true); });
  }

  function bindPanelNote(panelEl, panelId) {
    const noteEl = panelEl.querySelector('.provider-note');
    noteEl?.addEventListener('click', () => startPanelNoteEdit(panelId));
    noteEl?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      startPanelNoteEdit(panelId);
    });
  }

  function getDisplayedPanels() {
    if (!panelDisplayOrder) return getPanelsController().panels;
    return [...getPanelsController().panels].sort((a, b) => panelDisplayOrder.indexOf(a.id) - panelDisplayOrder.indexOf(b.id));
  }

  function scrollPanels(edge) {
    const grid = document.getElementById('panel-grid');
    if (!grid) return;
    grid.scrollTo({ left: edge === 'end' ? grid.scrollWidth : 0, behavior: 'smooth' });
  }

  // Fixed so they never collide with the configurable shortcuts.
  const PANEL_EDGE_SHORTCUTS = Object.freeze({ start: 'Alt+ArrowLeft', end: 'Alt+ArrowRight' });

  function updatePanelEdgeButtons() {
    const grid = document.getElementById('panel-grid');
    if (!grid) return;
    const maxScroll = grid.scrollWidth - grid.clientWidth;
    // A 1px tolerance absorbs fractional scroll positions on zoomed pages.
    document.getElementById('panel-edge-start-btn').hidden = maxScroll <= 1 || grid.scrollLeft <= 1;
    document.getElementById('panel-edge-end-btn').hidden = maxScroll <= 1 || grid.scrollLeft >= maxScroll - 1;
  }

  // Flashes the edge a horizontal swipe keeps pushing against once the panel
  // row is already scrolled all the way there, once per gesture: wheel events
  // closer together than the gap (including momentum) count as one push.
  const PANEL_EDGE_FLASH_MIN_DELTA = 4;

  const PANEL_EDGE_FLASH_GESTURE_GAP_MS = 300;

  let panelEdgeOverscrollAt = 0;

  function flashPanelEdgeOnOverscroll(grid, deltaX) {
    if (Math.abs(deltaX) < PANEL_EDGE_FLASH_MIN_DELTA) return;
    const maxScroll = grid.scrollWidth - grid.clientWidth;
    if (maxScroll <= 1) return;
    const edge = deltaX < 0
      ? (grid.scrollLeft <= 1 ? 'start' : null)
      : (grid.scrollLeft >= maxScroll - 1 ? 'end' : null);
    if (!edge) return;
    const now = performance.now();
    const continuesPush = now - panelEdgeOverscrollAt < PANEL_EDGE_FLASH_GESTURE_GAP_MS;
    panelEdgeOverscrollAt = now;
    const flash = document.getElementById(`panel-edge-flash-${edge}`);
    if (continuesPush || !flash || flash.classList.contains('flashing')) return;
    flash.classList.add('flashing');
    flash.addEventListener('animationend', () => flash.classList.remove('flashing'), { once: true });
  }

  function setupPanelEdgeNavigation() {
    const grid = document.getElementById('panel-grid');
    if (!grid) return;
    [['start', 'composerScrollPanelsStart', 'Scroll to first panel'], ['end', 'composerScrollPanelsEnd', 'Scroll to last panel']]
      .forEach(([edge, key, fallback]) => {
        const button = document.getElementById(`panel-edge-${edge}-btn`);
        button.title = `${getLocalizedText(key, fallback)} (${formatShortcutForTooltip(PANEL_EDGE_SHORTCUTS[edge])})`;
        button.setAttribute('aria-label', button.title);
        button.addEventListener('click', () => scrollPanels(edge));
      });

    let frameId = 0;
    const scheduleUpdate = () => {
      if (frameId) return;
      frameId = requestAnimationFrame(() => {
        frameId = 0;
        updatePanelEdgeButtons();
      });
    };
    grid.addEventListener('scroll', scheduleUpdate, { passive: true });
    // Panels keep horizontal swipes from navigating their page and hand them
    // here (see page-style.js) so the panel row still scrolls under a swipe.
    window.addEventListener('message', (event) => {
      const data = event.data;
      if (data?.type !== 'PANELIZE_PANEL_WHEEL' || data.context !== 'multi-panel' || !Number.isFinite(data.deltaX)) return;
      if (!getPanelsController().panels.some(panel => panel.iframe?.contentWindow === event.source)) return;
      if (document.getElementById('main-content')?.classList.contains('panel-focus-active')) return;
      flashPanelEdgeOnOverscroll(grid, data.deltaX);
      grid.scrollLeft += data.deltaX;
    });
    // Swipes over the grid itself (headers, gaps) scroll it natively.
    grid.addEventListener('wheel', (event) => {
      if (event.ctrlKey || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      if (document.getElementById('main-content')?.classList.contains('panel-focus-active')) return;
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? grid.clientWidth : 1;
      flashPanelEdgeOnOverscroll(grid, event.deltaX * scale);
    }, { passive: true });
    new ResizeObserver(scheduleUpdate).observe(grid);
    // Panel count, layout and wide mode change the scroll width without resizing the grid.
    new MutationObserver(scheduleUpdate).observe(grid, { childList: true, attributes: true, attributeFilter: ['class', 'style'] });
    window.addEventListener('resize', scheduleUpdate);
    scheduleUpdate();

    document.addEventListener('keydown', (event) => {
      const edge = Object.keys(PANEL_EDGE_SHORTCUTS).find(name => matchesShortcut(event, PANEL_EDGE_SHORTCUTS[name]));
      if (!edge) return;
      // Option+Arrow moves by word in text fields. Focus usually returns to the
      // composer, so it still scrolls while the composer is empty.
      const editable = event.target?.closest?.('input, textarea, select, [contenteditable="true"], [role="textbox"]');
      if (editable && !(editable.id === 'unified-input' && !editable.value)) return;
      if (getSharingController().isShareModalOpen() || isAnyModalOpen()) return;
      event.preventDefault();
      scrollPanels(edge);
    });
  }

  // `index` is 1-based and follows the on-screen order, including blind shuffles.
  function jumpToPanel(index) {
    const panel = getDisplayedPanels()[index - 1];
    if (panel) jumpToPanelElement(panel.id);
  }

  // Scrolls the panel into view and flashes it so the eye lands on it.
  function jumpToPanelElement(panelId) {
    const element = document.getElementById(panelId);
    if (!element) return;
    element.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
    element.classList.remove('panel-jump-highlight');
    // Restart the highlight animation when the same panel is targeted again.
    void element.offsetWidth;
    element.classList.add('panel-jump-highlight');
    element.addEventListener('animationend', () => element.classList.remove('panel-jump-highlight'), { once: true });
  }

  function applyPanelDisplayOrder() {
    const panelIds = getPanelsController().panels.map(panel => panel.id);
    if (isBlindModeEnabled) {
      panelDisplayOrder = syncDisplayOrder(panelDisplayOrder, panelIds);
    } else if (panelDisplayOrder) {
      // Revealed in place: panels added after blind mode go to the end.
      panelDisplayOrder = syncDisplayOrder(panelDisplayOrder, panelIds, () => 1);
    }
    getPanelsController().panels.forEach(panel => {
      const order = panelDisplayOrder ? String(panelDisplayOrder.indexOf(panel.id)) : '';
      document.querySelectorAll(`#${CSS.escape(panel.id)}, .panel-selector[data-panel-id="${panel.id}"]`)
        .forEach(element => { element.style.order = order; });
    });
  }

  // FLIP animation: every panel and selector chip gathers toward the middle,
  // tilts like a card in a deck, then is dealt out to its new place.
  function playShuffleAnimation(applyOrder) {
    const elements = [...document.querySelectorAll('#panel-grid > .panel-item, #panel-selectors > .panel-selector')];
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion || getPanelsController().focusedPanelId || elements.length < 2 || typeof Element.prototype.animate !== 'function') {
      applyOrder();
      return;
    }
    const firstRects = new Map(elements.map(element => [element, element.getBoundingClientRect()]));
    applyOrder();
    document.body.classList.add('panel-shuffling');
    const animations = elements.map((element, index) => {
      const from = firstRects.get(element);
      const to = element.getBoundingClientRect();
      const box = element.parentElement.getBoundingClientRect();
      const stackX = (box.left + box.width / 2 - (to.left + to.width / 2)) * 0.6;
      const stackY = (box.top + box.height / 2 - (to.top + to.height / 2)) * 0.6;
      const tilt = (Math.random() * 6 - 3).toFixed(2);
      return element.animate([
        { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` },
        { transform: `translate(${stackX}px, ${stackY}px) rotate(${tilt}deg) scale(0.92)`, offset: 0.45 },
        { transform: 'none' }
      ], { duration: 650, delay: index * 45, easing: 'cubic-bezier(.2, .8, .2, 1)', fill: 'backwards' });
    });
    // Hidden or throttled pages may not advance the animation clock; end the
    // shuffle on a timer so panels never stay offset or unclickable.
    setTimeout(() => {
      animations.forEach(animation => animation.finish());
      document.body.classList.remove('panel-shuffling');
    }, 650 + elements.length * 45 + 100);
  }

  function renderBlindLabels() {
    applyPanelDisplayOrder();
    getPanelsController().panels.forEach(panel => {
      const text = isBlindModeEnabled ? getPanelDisplayName(panel) : '';
      document.querySelectorAll(`#${CSS.escape(panel.id)} .blind-label, .panel-selector[data-panel-id="${panel.id}"] .blind-label`)
        .forEach(label => { label.textContent = text; });
    });
    renderPanelNames();
  }

  function postPageStyleToPanel(panel) {
    panel?.iframe?.contentWindow?.postMessage({
      type: PANELIZE_PAGE_STYLE,
      blind: isBlindModeEnabled,
      context: 'multi-panel'
    }, '*');
  }

  function updatePageStyleButtons() {
    [['blind-mode-btn', isBlindModeEnabled], ['wide-content-btn', isWideContentEnabled]].forEach(([id, enabled]) => {
      const button = document.getElementById(id);
      if (!button) return;
      button.classList.toggle('active', enabled);
      button.setAttribute('aria-pressed', String(enabled));
    });
  }

  async function setPageStyleModes({ blind = isBlindModeEnabled, wide = isWideContentEnabled } = {}, { persist = true } = {}) {
    const blindChanged = blind !== isBlindModeEnabled;
    const wideChanged = wide !== isWideContentEnabled;
    if (!blindChanged && !wideChanged) return;
    isBlindModeEnabled = blind;
    isWideContentEnabled = wide;
    document.body.classList.toggle('blind-mode', isBlindModeEnabled);
    document.body.classList.toggle('wide-content', isWideContentEnabled);
    if (wideChanged) getLayoutController().panelResize?.refresh();
    updatePageStyleButtons();
    if (blindChanged) {
      getSendingController().renderReadinessStatus();
      if (isBlindModeEnabled) {
        // Each time blind mode turns on, deal the panels into a new order.
        const shuffled = shuffleOrder(getDisplayedPanels().map(panel => panel.id));
        playShuffleAnimation(() => {
          panelDisplayOrder = shuffled;
          renderBlindLabels();
        });
      } else {
        renderBlindLabels();
      }
      // Answer stats and the log name providers, so they stay closed while identities are hidden.
      if (isBlindModeEnabled) {
        getAnswersController().closeAnswerStatsModal();
        getAnswersController().closeAnswerLogModal();
      }
      getSummaryController().renderAiSummary();
      showToast(isBlindModeEnabled
        ? getLocalizedText('blindModeOn', 'Blind mode on: AI names are hidden')
        : getLocalizedText('blindModeOff', 'Blind mode off: AI names are shown'));
    }
    getPanelsController().panels.forEach(postPageStyleToPanel);
    if (persist) {
      await chrome.storage.sync.set({ blindModeEnabled: isBlindModeEnabled, wideContentEnabled: isWideContentEnabled });
    }
  }

  async function saveProviderConfiguration() {
    getPanelsController().saveStartupSnapshot();
    const providerIds = getPanelsController().panels.map(p => p.providerId);
    try {
      await chrome.storage.sync.set({
        multiPanelProviders: providerIds,
        multiPanelLayout: getLayoutController().currentLayout
      });
    } catch (error) {
      console.error('Error saving provider configuration:', error);
    }
  }

  return {
    bindPanelNote,
    getDisplayedPanels,
    getPanelDisplayName,
    get isBlindModeEnabled() { return isBlindModeEnabled; },
    set isBlindModeEnabled(value) { isBlindModeEnabled = value; },
    get isWideContentEnabled() { return isWideContentEnabled; },
    set isWideContentEnabled(value) { isWideContentEnabled = value; },
    jumpToPanel,
    jumpToPanelElement,
    postPageStyleToPanel,
    get providerNotes() { return providerNotes; },
    set providerNotes(value) { providerNotes = value; },
    renderAllPanelNotes,
    renderBlindLabels,
    renderPanelNames,
    renderPanelNote,
    saveProviderConfiguration,
    scrollPanels,
    setPageStyleModes,
    setupPanelEdgeNavigation,
    updatePanelEdgeButtons,
    updatePageStyleButtons,
  };
}
