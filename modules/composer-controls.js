import { getSettings, saveSetting, saveSettings } from './settings.js';
import { getProviderById } from './providers.js';
import {
  DEFAULT_KEYBOARD_SHORTCUT_BINDINGS,
  formatKeyForTooltip,
  formatShortcutForTooltip,
  getShortcutBindingFromEvent,
  normalizeShortcutBinding,
  setupKeyboardShortcuts,
  validateShortcutBinding
} from './keyboard-shortcuts.js';
import {
  PROVIDER_TIER_IDS,
  describeTierMapping,
  getEffectiveTierRecipes,
  requestProviderTierState,
  runProviderTierBatch
} from './provider-tiers.js';
import { AUTO_PROMPT_MODE, normalizePromptTriggers, resolvePromptModeForText, selectModePrompts } from './prompt-modes.js';

const DEFAULT_TIER = 'default';
const ACTION_LABELS = {
  send: ['composerSend', 'Send to all'],
  fill: ['composerFill', 'Fill inputs'],
  newConversation: ['composerNewChat', 'New conversation'],
  focusInput: ['composerFocusInput', 'Focus input'],
  tierFast: ['composerTierFast', 'Fast'],
  tierBalanced: ['composerTierBalanced', 'Balanced'],
  tierDeep: ['composerTierDeep', 'Deep'],
  togglePromptLibrary: ['composerPromptLibrary', 'Prompt library'],
  toggleLayout: ['composerLayout', 'Layout'],
  togglePopularSort: ['labelProviderSortMode', 'Provider order'],
  toggleWideContent: ['composerWideContent', 'Wide mode'],
  scrollPanelsStart: ['composerScrollPanelsStart', 'Scroll to first panel'],
  scrollPanelsEnd: ['composerScrollPanelsEnd', 'Scroll to last panel'],
  ...Object.fromEntries(Array.from({ length: 9 }, (_, index) =>
    [`jumpPanel${index + 1}`, ['composerJumpPanel', 'Go to panel $1', [String(index + 1)]]])),
  tierDefault: ['composerTierDefault', 'Default'],
  toggleTemporaryChat: ['composerTemporaryChat', 'Temporary chat'],
  toggleBlindMode: ['composerBlindMode', 'Blind mode'],
  openAnswerStats: ['answerStatsButtonTitle', 'Answer stats'],
  openAnswerLog: ['answerLogButtonTitle', 'Answer log'],
  shareSnapshot: ['composerShareSnapshot', 'Share snapshot'],
  openSettings: ['composerOpenSettings', 'Settings'],
  clearInputs: ['composerClearAll', 'Clear all inputs'],
  attachFiles: ['composerAttachFiles', 'Upload images or files'],
  addPanel: ['composerAddPanel', 'Add panel'],
  toggleToolbar: ['composerToggleToolbar', 'Collapse or expand toolbar'],
  openKeyboardShortcuts: ['composerShortcuts', 'Keyboard shortcuts'],
  openTierMenu: ['composerTierMenu', 'Choose reasoning level'],
  toggleOpenMode: ['composerToggleOpenMode', 'Switch between tab and popup window'],
  openAiSummary: ['aiSummaryButtonTitle', 'AI summary']
};
const PROMPT_MODE_DEFAULT_HINT = ['promptModeDefaultHint', 'Nothing is added; each AI answers in its own way'];
const PROMPT_MODE_HINT_LENGTH = 120;
const PROMPT_MODE_PLACEHOLDER_LENGTH = 40;
const PROMPT_MODE_AUTO_LABEL = ['promptModeAuto', 'Auto'];
const PROMPT_MODE_AUTO_HINT = ['promptModeAutoHint', 'Adds a mode only when the question has its trigger word, such as /study'];
// What a button does, shown on the tooltip's second line.
const ACTION_HINTS = {
  send: ['composerSendHint', 'Fill every panel with the question and send it'],
  fill: ['composerFillHint', 'Fill every panel with the question without sending'],
  newConversation: ['composerNewChatHint', 'Start a new chat in every panel'],
  togglePromptLibrary: ['composerPromptLibraryHint', 'Pick a saved prompt to insert'],
  tierFast: ['composerTierFastHint', 'Switch every AI to its fastest mode'],
  tierBalanced: ['composerTierBalancedHint', 'Switch every AI to a balanced mode'],
  tierDeep: ['composerTierDeepHint', 'Switch every AI to its deepest reasoning mode'],
  tierDefault: ['composerTierDefaultHint', "Keep each AI's current setting"]
};
const BUTTON_ACTIONS = {
  'send-all-btn': 'send', 'fill-input-btn': 'fill',
  'new-chat-btn': 'newConversation', 'composer-new-chat-btn': 'newConversation',
  'prompt-library-btn': 'togglePromptLibrary', 'layout-btn': 'toggleLayout',
  'provider-sort-btn': 'togglePopularSort',
  'wide-content-btn': 'toggleWideContent',
  'scroll-panels-start-btn': 'scrollPanelsStart',
  'scroll-panels-end-btn': 'scrollPanelsEnd',
  'tier-menu-btn': 'openTierMenu'
};
// Buttons whose page title already names them (and may explain them on a
// second line); the shortcut is added to that title's first line.
const TITLED_BUTTON_ACTIONS = {
  'temporary-chat-btn': 'toggleTemporaryChat', 'blind-mode-btn': 'toggleBlindMode',
  'answer-stats-btn': 'openAnswerStats', 'answer-log-btn': 'openAnswerLog',
  'share-snapshot-btn': 'shareSnapshot', 'settings-btn': 'openSettings',
  'clear-all-btn': 'clearInputs', 'image-upload-btn': 'attachFiles',
  'add-panel-btn': 'addPanel', 'toggle-toolbar-btn': 'toggleToolbar',
  'expand-toolbar-btn': 'toggleToolbar', 'keyboard-shortcuts-btn': 'openKeyboardShortcuts',
  'toggle-open-mode-btn': 'toggleOpenMode', 'ai-summary-btn': 'openAiSummary'
};
// Actions a shortcut performs by clicking the page's own button, so the
// handlers in multi-panel.js stay the only implementation.
const CLICK_ACTIONS = Object.entries(TITLED_BUTTON_ACTIONS).reduce((actions, [id, action]) => {
  if (action !== 'openKeyboardShortcuts') (actions[action] ||= []).push(id);
  return actions;
}, {});
const SHORTCUT_BUBBLE_MS = 1600;

/** UI orchestration stays here; provider operations retain their own verified
 * request/result contracts and do not have access to the unified draft. */
export async function setupComposerControls({
  getPanels, send, fill, newConversation, focusInput, openPromptLibrary,
  openLayout, text, notify = () => {}, isOperationBusy = () => false,
  getPanelName = panel => getProviderById(panel.providerId)?.name || panel.providerId,
  isBlindMode = () => false,
  toggleWideContent = () => {},
  scrollPanels = () => {},
  jumpToPanel = () => {},
  loadModePrompts = async () => []
}) {
  const byId = id => document.getElementById(id);
  if (!byId('composer-shell')) return null;
  const tr = (key, fallback, values = null) => text(key, fallback, values);
  const label = action => tr(...ACTION_LABELS[action]);
  const settings = await getSettings();
  let selectedTier = PROVIDER_TIER_IDS.includes(settings.selectedProviderTier) ? settings.selectedProviderTier : null;
  let tierRecipeOverrides = settings.providerTierRecipes || null;
  let sortMode = settings.providerSortMode;
  // The saved modeKey; it may name a mode this device's library lacks, which
  // then reads as Default without overwriting the synced choice.
  let promptMode = toModeKey(settings.selectedPromptMode);
  let modePrompts = [];
  let bindings = settings.keyboardShortcutBindings || {};
  let shortcutsEnabled = settings.pageShortcutsEnabled !== false;
  let draftBindings = {};
  let tierBusy = false;
  let tierGeneration = 0;
  const states = new Map();
  const panelEpochs = new Map();
  const restoreTimers = new Map();
  const pendingPanelChecks = new Set();
  let restoreFlushTimer;
  let pendingDesiredTier;
  let pendingTierPersist = false;
  let desiredTierTimer;
  let pulseTimer;
  let returnFocus = null;
  let promptGlobalShortcut = '';

  function pulse() {
    const shell = byId('composer-shell');
    if (!shell || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    if (shell.classList.contains('composer-pulse')) return;
    shell.classList.add('composer-pulse');
    clearTimeout(pulseTimer);
    pulseTimer = setTimeout(() => shell.classList.remove('composer-pulse'), 900);
  }

  function panelDescriptor(panel) {
    let origin;
    try { origin = new URL(panel.currentUrl || panel.iframe.src).origin; } catch { return null; }
    return {
      panelId: panel.id,
      provider: panel.providerId,
      window: panel.iframe?.contentWindow,
      origin,
      recipes: getEffectiveTierRecipes(panel.providerId, tierRecipeOverrides)
    };
  }

  // Tiers whose recipes are identical (Meta AI fast/balanced, DeepSeek
  // balanced/deep) are reported together; either one counts as applied.
  function isOnTier(result, tier) {
    return result?.status === 'success'
      && (result.tier === tier || (Array.isArray(result.matchedTiers) && result.matchedTiers.includes(tier)));
  }

  function currentResult(panel) {
    const state = states.get(panel.id);
    return state?.provider === panel.providerId ? state : null;
  }

  function resultText(result) {
    if (!result) return tr('composerNotChecked', 'Not checked');
    const statuses = {
      success: ['composerSwitched', 'Confirmed'], unsupported: ['composerUnsupported', 'Not supported'],
      unavailable: ['composerUnavailable', 'Unavailable for this account or page'],
      timeout: ['composerTimeout', 'Not confirmed'], error: ['composerNotConfirmed', 'Not confirmed']
    };
    return tr(...(statuses[result.status] || statuses.error));
  }

  const tierName = tier => label(`tier${tier[0].toUpperCase()}${tier.slice(1)}`);

  // The configured target for the requested tier, so the dialog shows what
  // each AI should switch to next to what it actually reports.
  function mappingText(panel, tier) {
    if (!tier) return '—';
    const mapping = describeTierMapping(panel.providerId, tier, tierRecipeOverrides);
    if (!mapping || mapping.type === 'unsupported') return tr('composerTierMapUnsupported', 'Not supported');
    if (mapping.type === 'skipped') return tr('composerTierMapSkipped', 'Not switched');
    if (mapping.type === 'detect') return tr('composerTierMapDetect', 'Auto-detect');
    if (mapping.type === 'effort') return tr('composerTierMapEffort', 'Reasoning effort $1', [mapping.level]);
    const steps = mapping.steps.map(item => {
      if (item.kind !== 'toggle') return item.label.split('|').map(part => part.trim()).join(' / ');
      // Toggle alternatives are synonyms for matching; the first one names it.
      const name = item.label.split('|')[0].trim();
      return item.on ? tr('composerTierMapToggleOn', '$1 on', [name]) : tr('composerTierMapToggleOff', '$1 off', [name]);
    }).join(' + ');
    return mapping.sharedWith.length
      ? `${steps} · ${tr('composerTierMapShared', 'shared with $1', [mapping.sharedWith.map(tierName).join(' / ')])}`
      : steps;
  }

  function renderTierState() {
    const currentPanels = getPanels();
    const displayedTier = pendingDesiredTier !== undefined ? pendingDesiredTier : selectedTier;
    const switching = tierBusy || pendingDesiredTier !== undefined;
    const results = currentPanels.map(currentResult);
    const allMatched = Boolean(!switching && displayedTier && currentPanels.length > 0
      && results.every(result => isOnTier(result, displayedTier)));
    const confirmed = results.filter(result => isOnTier(result, displayedTier)).length;
    const shell = byId('composer-shell');
    shell.dataset.tier = displayedTier || DEFAULT_TIER;
    shell.dataset.tierState = switching ? 'switching' : !displayedTier ? 'default'
      : allMatched ? 'confirmed' : 'mixed';
    byId('provider-tier-controls').setAttribute('aria-busy', String(switching));
    const menuLabel = byId('tier-menu-label');
    if (menuLabel) menuLabel.textContent = displayedTier ? tierName(displayedTier) : label('tierDefault');
    const active = keyboard.getBindings();
    document.querySelectorAll('.tier-option').forEach(button => {
      // Default leaves every AI on its own setting, so it needs no confirmation.
      const isDefault = button.dataset.tier === DEFAULT_TIER;
      const requested = isDefault ? !displayedTier : button.dataset.tier === displayedTier;
      button.setAttribute('aria-checked', String(isDefault ? requested && !switching : allMatched && requested));
      // Keep the controls available while a batch runs. A later choice replaces
      // the queued one and is applied as soon as the current operation settles.
      button.disabled = false;
      button.dataset.requested = String(requested);
      const key = button.querySelector('.tier-option-key');
      if (key) key.textContent = shortcutsEnabled ? formatShortcutForTooltip(active[button.dataset.shortcutAction]) : '';
    });
    const status = byId('tier-status');
    if (switching) status.textContent = tr('composerSwitching', 'Switching…');
    else if (!displayedTier) status.textContent = '';
    else {
      status.textContent = confirmed === currentPanels.length && confirmed > 0
        ? tr('composerTierApplied', '$1 AIs switched', [String(confirmed)])
        : tr('composerTierMixed', '$1/$2 switched · mixed', [String(confirmed), String(currentPanels.length)]);
    }
    const body = byId('tier-details-body');
    body.replaceChildren();
    currentPanels.forEach(panel => {
      const result = currentResult(panel);
      const row = document.createElement('tr');
      // Blind mode hides the target and actual model labels too: they name the provider.
      [getPanelName(panel),
        isBlindMode() ? '—' : mappingText(panel, displayedTier),
        isBlindMode() ? '—' : result?.actualLabel || '—', resultText(result)].forEach(value => {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      });
      body.append(row);
    });
    byId('retry-tier-btn').disabled = switching || !selectedTier
      || !currentPanels.some(panel => {
        const result = currentResult(panel);
        return !isOnTier(result, selectedTier);
      });
    byId('refresh-tier-state-btn').disabled = switching;
  }

  function requestEpochs(targets) {
    return new Map(targets.map(panel => [panel.id, panelEpochs.get(panel.id) || 0]));
  }

  function acceptResult(result, generation, epochs) {
    const panel = getPanels().find(candidate => candidate.id === result.panelId);
    if (generation !== tierGeneration || !panel || result.provider !== panel.providerId) return;
    if (epochs.get(panel.id) !== (panelEpochs.get(panel.id) || 0)) return;
    states.set(panel.id, result);
  }

  async function refreshStates(targets = getPanels()) {
    if (tierBusy) return;
    const generation = tierGeneration;
    const epochs = requestEpochs(targets);
    const descriptors = targets.map(panelDescriptor).filter(Boolean);
    const results = await Promise.all(descriptors.map(panel => requestProviderTierState(panel)));
    results.forEach(result => acceptResult(result, generation, epochs));
    renderTierState();
  }

  async function applyTier(tier, { targets = getPanels(), persist = true, ignoreBusy = false } = {}) {
    if (tierBusy || !PROVIDER_TIER_IDS.includes(tier) || !targets.length) return;
    if (!ignoreBusy && isOperationBusy()) return;
    tierBusy = true;
    const generation = ++tierGeneration;
    const epochs = requestEpochs(targets);
    selectedTier = tier;
    renderTierState();
    pulse();
    try {
      if (persist) await saveSetting('selectedProviderTier', tier);
      const results = await runProviderTierBatch({
        panels: targets.map(panelDescriptor).filter(Boolean), tier, timeoutMs: 6500
      });
      results.forEach(result => acceptResult(result, generation, epochs));
    } catch {
      notify(tr('composerNotConfirmed', 'Not confirmed'));
    } finally {
      tierBusy = false;
      renderTierState();
      if (pendingDesiredTier !== undefined) scheduleDesiredTier();
    }
  }

  /** Stops applying a tier; open AIs keep whatever mode they are on. */
  async function selectDefaultTier({ persist = true } = {}) {
    if (tierBusy) return;
    pendingDesiredTier = undefined;
    clearTimeout(desiredTierTimer);
    tierGeneration += 1;
    selectedTier = null;
    renderTierState();
    pulse();
    if (persist) await saveSetting('selectedProviderTier', null);
  }

  function requestTier(tier) {
    if (tier !== null && !PROVIDER_TIER_IDS.includes(tier)) return;
    if (tierBusy || isOperationBusy()) {
      pendingDesiredTier = tier;
      pendingTierPersist = true;
      renderTierState();
      pulse();
      scheduleDesiredTier();
      return;
    }
    pendingDesiredTier = undefined;
    clearTimeout(desiredTierTimer);
    return tier === null ? selectDefaultTier() : applyTier(tier);
  }

  function scheduleDesiredTier() {
    clearTimeout(desiredTierTimer);
    desiredTierTimer = setTimeout(() => {
      if (pendingDesiredTier === undefined) return;
      if (tierBusy || isOperationBusy()) { scheduleDesiredTier(); return; }
      const tier = pendingDesiredTier;
      const persist = pendingTierPersist;
      pendingDesiredTier = undefined;
      pendingTierPersist = false;
      void (tier === null ? selectDefaultTier({ persist }) : applyTier(tier, { persist }));
    }, 300);
  }

  function retryTier() {
    if (!selectedTier) return;
    const targets = getPanels().filter(panel => {
      const result = currentResult(panel);
      return !isOnTier(result, selectedTier);
    });
    return applyTier(selectedTier, { targets });
  }

  function clearPanelTimers(id) {
    (restoreTimers.get(id) || []).forEach(clearTimeout);
    restoreTimers.delete(id);
    pendingPanelChecks.delete(id);
  }

  function queuePanelCheck(id) {
    pendingPanelChecks.add(id);
    clearTimeout(restoreFlushTimer);
    restoreFlushTimer = setTimeout(flushPanelChecks, 80);
  }

  async function flushPanelChecks() {
    if (!pendingPanelChecks.size) return;
    if (tierBusy || isOperationBusy() || pendingDesiredTier !== undefined) {
      restoreFlushTimer = setTimeout(flushPanelChecks, 300);
      return;
    }
    const targets = getPanels().filter(panel => pendingPanelChecks.has(panel.id));
    pendingPanelChecks.clear();
    const unfinished = targets.filter(panel => {
      const result = currentResult(panel);
      return selectedTier
        ? !isOnTier(result, selectedTier)
        : !result || ['timeout', 'error', 'unavailable'].includes(result.status);
    });
    // Panels commonly finish loading together. Restore them in one batch so
    // a slow provider cannot consume every retry window of its neighbours.
    if (unfinished.length) {
      if (selectedTier) await applyTier(selectedTier, { targets: unfinished, persist: false });
      else await refreshStates(unfinished);
    }
    if (pendingPanelChecks.size) restoreFlushTimer = setTimeout(flushPanelChecks, 80);
  }

  function panelLoaded(panel) {
    panelEpochs.set(panel.id, (panelEpochs.get(panel.id) || 0) + 1);
    clearPanelTimers(panel.id);
    states.delete(panel.id);
    renderTierState();
    const generationProvider = panel.providerId;
    const timers = [300, 1800, 4500, 8500].map(delay => setTimeout(() => {
      const current = getPanels().find(candidate => candidate.id === panel.id);
      if (current && current.providerId === generationProvider) queuePanelCheck(current.id);
    }, delay));
    restoreTimers.set(panel.id, timers);
  }

  function renderSortMode() {
    const frequent = sortMode === 'frequent';
    byId('provider-sort-label').textContent = tr(frequent ? 'optionProviderSortFrequent' : 'optionProviderSortManual', frequent ? 'Most used' : 'Manual');
    byId('provider-sort-btn').setAttribute('aria-pressed', String(frequent));
    updateTooltips();
  }

  async function toggleSort() {
    sortMode = sortMode === 'frequent' ? 'manual' : 'frequent';
    await saveSetting('providerSortMode', sortMode);
    renderSortMode();
    notify(tr('composerSortUpdated', 'Order applies to AI menus and the next startup.'));
  }

  function currentModePrompt() {
    return modePrompts.find(prompt => prompt.modeKey === promptMode) || null;
  }

  function isAutoMode() {
    return promptMode === AUTO_PROMPT_MODE;
  }

  // "/study Learning · /brief Concise" for the modes that have triggers.
  function describeTriggers() {
    return modePrompts
      .map(prompt => {
        const triggers = normalizePromptTriggers(prompt.triggers);
        return triggers.length ? `${triggers.join(' ')} ${prompt.title}` : '';
      })
      .filter(Boolean)
      .join(' · ');
  }

  // The options mirror the library's mode prompts after the page's own
  // Default and Auto options.
  function renderPromptModeOptions(select) {
    const keys = modePrompts.map(prompt => prompt.modeKey);
    const fixedCount = [...select.options].filter(option => option.value === '' || option.value === AUTO_PROMPT_MODE).length;
    const current = [...select.options].slice(fixedCount);
    const unchanged = current.length === keys.length && current.every((option, index) =>
      option.value === keys[index] && option.textContent === modePrompts[index].title);
    if (unchanged) return;
    current.forEach(option => option.remove());
    select.append(...modePrompts.map(prompt => {
      const option = document.createElement('option');
      option.value = prompt.modeKey;
      option.textContent = prompt.title;
      return option;
    }));
  }

  // The select stays quiet until a mode is picked; then it takes the same soft
  // accent as pressed composer buttons so the appended instruction is visible.
  function renderPromptMode() {
    const select = byId('prompt-mode-select');
    if (!select) return;
    renderPromptModeOptions(select);
    const mode = currentModePrompt();
    const auto = isAutoMode();
    select.value = auto ? AUTO_PROMPT_MODE : (mode ? mode.modeKey : '');
    const label = tr('composerPromptModeLabel', 'Prompt mode');
    const heading = auto ? `${label}: ${tr(...PROMPT_MODE_AUTO_LABEL)}` : (mode ? `${label}: ${mode.title}` : label);
    const triggers = auto ? describeTriggers() : '';
    const hint = auto
      ? [tr(...PROMPT_MODE_AUTO_HINT), triggers].filter(Boolean).join('\n')
      : (mode ? truncate(mode.content, PROMPT_MODE_HINT_LENGTH) : tr(...PROMPT_MODE_DEFAULT_HINT));
    select.title = `${heading}\n${hint}`;
    select.setAttribute('aria-label', heading);
    select.closest('.prompt-mode-control')?.setAttribute('data-active', String(Boolean(mode || auto)));
    updateInputPlaceholder(keyboard.getBindings());
  }

  // Re-reads the library; edits there (in this page or another) show up here.
  async function refreshPromptModes() {
    try {
      modePrompts = selectModePrompts(await loadModePrompts());
    } catch (error) {
      console.warn('Prompt modes unavailable', error);
    }
    renderPromptMode();
  }

  function isAnyModalOpen() {
    return [...document.querySelectorAll('.modal')].some(modal => getComputedStyle(modal).display !== 'none');
  }

  function runAction(action) {
    if (isAnyModalOpen()) return;
    const actions = {
      send, fill, newConversation, focusInput, togglePromptLibrary: openPromptLibrary,
      toggleLayout: openLayout, togglePopularSort: toggleSort, toggleWideContent,
      tierFast: () => requestTier('fast'), tierBalanced: () => requestTier('balanced'), tierDeep: () => requestTier('deep'),
      scrollPanelsStart: () => scrollPanels('start'), scrollPanelsEnd: () => scrollPanels('end'),
      tierDefault: () => requestTier(null), openTierMenu: () => toggleTierMenu(),
      openKeyboardShortcuts: openShortcutsDialog
    };
    if (CLICK_ACTIONS[action]) {
      actions[action] = () => CLICK_ACTIONS[action].map(byId).find(isUsableButton)?.click();
    }
    const jump = /^jumpPanel([1-9])$/.exec(action);
    if (jump) actions[action] = () => jumpToPanel(Number(jump[1]));
    Promise.resolve(actions[action]?.()).catch(() => notify(tr('composerNotConfirmed', 'Not confirmed')));
  }

  const keyboard = setupKeyboardShortcuts({
    bindings, enabled: shortcutsEnabled, onAction: runAction,
    editableActionIds: Object.keys(DEFAULT_KEYBOARD_SHORTCUT_BINDINGS)
  });

  function updateTooltips() {
    const active = keyboard.getBindings();
    Object.entries(BUTTON_ACTIONS).forEach(([id, action]) => {
      if (byId(id)) byId(id).dataset.shortcutAction = action;
    });
    document.querySelectorAll('[data-shortcut-action]').forEach(button => {
      const action = button.dataset.shortcutAction;
      if (!ACTION_LABELS[action]) return;
      const shortcut = shortcutsEnabled ? formatShortcutForTooltip(active[action]) : '';
      const globalShortcut = action === 'togglePromptLibrary' ? promptGlobalShortcut : '';
      const base = action === 'togglePopularSort'
        ? `${label(action)}: ${byId('provider-sort-label').textContent}`
        : action === 'fill' && button.dataset.retryFailed === 'true'
          ? tr('composerRetryFailed', 'Retry unsuccessful')
          : action === 'toggleWideContent'
            ? tr('wideContentTitle', 'Wide mode: each panel is 1.5× wider; scroll horizontally to view.') : label(action);
      const heading = `${base}${shortcut || globalShortcut ? ` (${shortcut || globalShortcut})` : ''}`;
      const hint = ACTION_HINTS[action] && button.dataset.retryFailed !== 'true' ? tr(...ACTION_HINTS[action]) : '';
      button.title = hint ? `${heading}\n${hint}` : heading;
      button.setAttribute('aria-label', heading);
    });
    Object.entries(TITLED_BUTTON_ACTIONS).forEach(([id, action]) => {
      const button = byId(id);
      if (!button) return;
      button.dataset.shortcutAction = action;
      button.dataset.baseTitle ??= button.title || label(action);
      const [name, ...rest] = button.dataset.baseTitle.split('\n');
      const shortcut = shortcutsEnabled ? formatShortcutForTooltip(active[action]) : '';
      const heading = shortcut ? `${name} (${shortcut})` : name;
      button.title = [heading, ...rest].join('\n');
      button.setAttribute('aria-label', heading);
    });
    if (byId('tier-menu-btn')) renderTierState();
    updateInputPlaceholder(active);
  }

  // Plain Enter always sends and Shift+Enter adds a line (multi-panel.js);
  // focus and fill follow the configurable page shortcuts.
  function updateInputPlaceholder(active) {
    const input = byId('unified-input');
    if (!input) return;
    const keys = [
      tr('composerPlaceholderSend', '$1 send', [formatKeyForTooltip('Enter')]),
      tr('composerPlaceholderNewLine', '$1 new line', [formatShortcutForTooltip('Shift+Enter')])
    ];
    const fillShortcut = shortcutsEnabled ? formatShortcutForTooltip(active.fill) : '';
    if (fillShortcut) keys.push(tr('composerPlaceholderFill', '$1 fill only', [fillShortcut]));
    const focusShortcut = shortcutsEnabled ? formatShortcutForTooltip(active.focusInput) : '';
    const prefix = focusShortcut ? `${focusShortcut}  ` : '';
    const mode = currentModePrompt();
    const triggers = isAutoMode() ? describeTriggers() : '';
    const appended = mode
      ? `  ${tr('composerPlaceholderAppend', 'Appends: $1', [truncate(mode.content, PROMPT_MODE_PLACEHOLDER_LENGTH)])}`
      : (triggers ? `  ${tr('composerPlaceholderTriggers', 'Auto: $1', [truncate(triggers, PROMPT_MODE_PLACEHOLDER_LENGTH * 2)])}` : '');
    input.placeholder = `${prefix}${tr('composerInputPlaceholder', 'Enter your question to send to all AI providers...')}${appended}  ${keys.join(' · ')}`;
  }

  function openDialog(id) {
    returnFocus = document.activeElement;
    byId(id).style.display = 'flex';
    keyboard.setEnabled(false);
    byId(id).querySelector('button, input')?.focus();
  }

  function closeDialog(id) {
    byId(id).style.display = 'none';
    keyboard.setEnabled(shortcutsEnabled);
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  }

  function isUsableButton(button) {
    return Boolean(button) && !button.disabled && !button.hidden && !button.closest('[hidden], .hidden');
  }

  function isTierMenuOpen() {
    return byId('provider-tier-controls')?.hidden === false;
  }

  function openTierMenu() {
    const menu = byId('provider-tier-controls');
    if (!menu) return;
    renderTierState();
    menu.hidden = false;
    byId('tier-menu-btn').setAttribute('aria-expanded', 'true');
    const options = [...menu.querySelectorAll('.tier-option')];
    (options.find(option => option.dataset.requested === 'true') || options[0])?.focus({ preventScroll: true });
  }

  function closeTierMenu({ restoreFocus = false } = {}) {
    const menu = byId('provider-tier-controls');
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    byId('tier-menu-btn').setAttribute('aria-expanded', 'false');
    if (restoreFocus) byId('tier-menu-btn').focus({ preventScroll: true });
  }

  function toggleTierMenu() {
    if (isTierMenuOpen()) closeTierMenu({ restoreFocus: true });
    else openTierMenu();
  }

  let bubbleTimer;
  let hintedButton = null;
  // A mouse click on a button with a shortcut shows that shortcut next to it.
  // Keyboard activation (detail 0) and the clicks shortcuts make themselves
  // (untrusted) do not, since the user already used the keyboard.
  function showShortcutBubble(event) {
    if (!event.isTrusted || event.detail === 0 || !shortcutsEnabled) return;
    const button = event.target.closest?.('[data-shortcut-action]');
    if (!button || button.disabled) return;
    const shortcut = formatShortcutForTooltip(keyboard.getBindings()[button.dataset.shortcutAction]);
    if (!shortcut) return;
    const anchor = button.classList.contains('tier-option') ? byId('tier-menu-btn') : button;
    let bubble = byId('shortcut-bubble');
    if (!bubble) {
      bubble = document.createElement('div');
      bubble.id = 'shortcut-bubble';
      bubble.className = 'shortcut-bubble';
      bubble.setAttribute('aria-hidden', 'true');
      document.body.append(bubble);
    }
    const key = document.createElement('kbd');
    key.textContent = shortcut;
    bubble.replaceChildren(key);
    bubble.dataset.visible = 'false';
    // Measure after the menu or toolbar has settled from this click.
    requestAnimationFrame(() => {
      if (!anchor.isConnected) return;
      const rect = anchor.getBoundingClientRect();
      const width = bubble.offsetWidth;
      const height = bubble.offsetHeight;
      const left = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 8);
      const top = rect.top - height - 8 >= 8 ? rect.top - height - 8 : rect.bottom + 8;
      bubble.style.left = `${Math.max(8, left)}px`;
      bubble.style.top = `${top}px`;
      bubble.dataset.visible = 'true';
      hintedButton?.classList.remove('shortcut-hinted');
      hintedButton = anchor;
      anchor.classList.add('shortcut-hinted');
    });
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => {
      bubble.dataset.visible = 'false';
      hintedButton?.classList.remove('shortcut-hinted');
      hintedButton = null;
    }, SHORTCUT_BUBBLE_MS);
  }

  function openShortcutsDialog() {
    draftBindings = keyboard.getBindings();
    byId('page-shortcuts-enabled').checked = shortcutsEnabled;
    byId('keyboard-shortcuts-error').textContent = '';
    renderShortcutFields();
    openDialog('keyboard-shortcuts-modal');
  }

  function renderShortcutFields() {
    const container = byId('keyboard-shortcuts-fields');
    container.replaceChildren();
    // Nine panel-jump rows would dominate the dialog; show them as a compact grid.
    const jumpGroup = document.createElement('div');
    jumpGroup.className = 'composer-shortcut-group';
    const jumpTitle = document.createElement('span');
    jumpTitle.className = 'composer-shortcut-group-title';
    jumpTitle.textContent = tr('composerJumpPanelGroup', 'Go to panel (in display order)');
    const jumpGrid = document.createElement('div');
    jumpGrid.className = 'composer-shortcut-grid';
    jumpGroup.append(jumpTitle, jumpGrid);
    Object.keys(DEFAULT_KEYBOARD_SHORTCUT_BINDINGS).forEach(action => {
      const jumpIndex = /^jumpPanel([1-9])$/.exec(action)?.[1];
      const row = document.createElement('label');
      row.className = jumpIndex ? 'composer-shortcut-field composer-shortcut-field-compact' : 'composer-shortcut-field';
      const caption = document.createElement('span');
      caption.textContent = jumpIndex || label(action);
      const input = document.createElement('input');
      input.readOnly = true;
      input.dataset.action = action;
      input.setAttribute('aria-label', label(action));
      input.value = formatShortcutForTooltip(draftBindings[action]);
      input.placeholder = tr('composerUnassigned', 'Unassigned');
      input.addEventListener('keydown', event => {
        if (event.key === 'Tab' || event.key === 'Escape' || event.isComposing || event.keyCode === 229) return;
        const captured = getShortcutBindingFromEvent(event);
        event.preventDefault();
        event.stopPropagation();
        if (['Control', 'Meta', 'Alt', 'Shift'].includes(event.key)) return;
        const value = ['Backspace', 'Delete'].includes(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey
          ? null : captured;
        const conflict = value && Object.entries(draftBindings).some(([other, binding]) =>
          other !== action && binding && formatShortcutForTooltip(binding) === formatShortcutForTooltip(value));
        if ((!value && event.key !== 'Backspace' && event.key !== 'Delete') || !validateShortcutBinding(value) || conflict) {
          byId('keyboard-shortcuts-error').textContent = tr('composerShortcutInvalid', 'This combination is reserved or already used.');
          return;
        }
        byId('keyboard-shortcuts-error').textContent = '';
        draftBindings[action] = normalizeShortcutBinding(value);
        input.value = formatShortcutForTooltip(value);
      });
      row.append(caption, input);
      (jumpIndex ? jumpGrid : container).append(row);
    });
    container.append(jumpGroup);
  }

  document.querySelectorAll('.tier-option').forEach(button => {
    button.addEventListener('click', event => {
      requestTier(button.dataset.tier === DEFAULT_TIER ? null : button.dataset.tier);
      closeTierMenu({ restoreFocus: event.detail === 0 });
    });
    button.addEventListener('keydown', event => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        if (event.key === 'Escape') event.preventDefault();
        closeTierMenu({ restoreFocus: event.key === 'Escape' });
        return;
      }
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const options = [...document.querySelectorAll('.tier-option')];
      const index = options.indexOf(button);
      const count = options.length;
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1
        : (index + (event.key === 'ArrowDown' ? 1 : count - 1)) % count;
      options[next]?.focus();
    });
  });
  byId('tier-menu-btn')?.addEventListener('click', toggleTierMenu);
  byId('tier-menu-btn')?.addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    openTierMenu();
  });
  document.addEventListener('pointerdown', event => {
    if (isTierMenuOpen() && !event.target.closest?.('.tier-menu')) closeTierMenu();
  }, true);
  document.addEventListener('click', showShortcutBubble, true);
  byId('unified-input').addEventListener('focus', pulse);
  byId('provider-sort-btn').addEventListener('click', toggleSort);
  // Only Default is in the page; the mode options come from the library.
  byId('prompt-mode-select').addEventListener('change', async event => {
    promptMode = toModeKey(event.target.value);
    renderPromptMode();
    await saveSetting('selectedPromptMode', promptMode);
  });
  window.addEventListener('focus', () => { void refreshPromptModes(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refreshPromptModes();
  });
  byId('tier-details-btn').addEventListener('click', () => { renderTierState(); openDialog('tier-details-modal'); });
  byId('retry-tier-btn').addEventListener('click', retryTier);
  byId('refresh-tier-state-btn').addEventListener('click', () => refreshStates());
  byId('keyboard-shortcuts-btn').addEventListener('click', openShortcutsDialog);
  byId('reset-keyboard-shortcuts').addEventListener('click', () => {
    draftBindings = { ...DEFAULT_KEYBOARD_SHORTCUT_BINDINGS };
    byId('page-shortcuts-enabled').checked = true;
    byId('keyboard-shortcuts-error').textContent = '';
    renderShortcutFields();
  });
  byId('save-keyboard-shortcuts').addEventListener('click', async () => {
    bindings = { ...draftBindings };
    shortcutsEnabled = byId('page-shortcuts-enabled').checked;
    await saveSettings({ keyboardShortcutBindings: bindings, pageShortcutsEnabled: shortcutsEnabled });
    keyboard.update({ bindings, enabled: shortcutsEnabled });
    updateTooltips();
    closeDialog('keyboard-shortcuts-modal');
  });
  ['tier-details-modal', 'keyboard-shortcuts-modal'].forEach(id => {
    byId(id).addEventListener('click', event => { if (event.target === byId(id)) closeDialog(id); });
  });
  byId('close-tier-details').addEventListener('click', () => closeDialog('tier-details-modal'));
  byId('close-keyboard-shortcuts').addEventListener('click', () => closeDialog('keyboard-shortcuts-modal'));
  document.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229) return;
    const activeDialog = ['tier-details-modal', 'keyboard-shortcuts-modal']
      .map(byId).find(modal => modal.style.display !== 'none');
    if (event.key === 'Tab' && activeDialog) {
      const focusable = [...activeDialog.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]')];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    if (event.key !== 'Escape') return;
    ['tier-details-modal', 'keyboard-shortcuts-modal'].forEach(id => {
      if (byId(id).style.display !== 'none') { event.preventDefault(); closeDialog(id); }
    });
  });

  window.addEventListener('message', event => {
    const data = event.data;
    if (!data || data.type !== 'PANELIZE_SHORTCUT' || data.context !== 'multi-panel' || !shortcutsEnabled) return;
    const panel = getPanels().find(candidate => candidate.iframe?.contentWindow === event.source);
    if (!panel || data.provider !== panel.providerId || !isAllowedPanelOrigin(panel, event.origin)) return;
    if (!Object.hasOwn(keyboard.getBindings(), data.actionId) || !keyboard.getBindings()[data.actionId]) return;
    runAction(data.actionId);
  });

  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (!['sync', 'local'].includes(area)) return;
    if (!['keyboardShortcutBindings', 'pageShortcutsEnabled', 'providerSortMode', 'selectedProviderTier', 'providerTierRecipes', 'selectedPromptMode'].some(key => changes[key])) return;
    if (changes.keyboardShortcutBindings) bindings = changes.keyboardShortcutBindings.newValue || {};
    if (changes.pageShortcutsEnabled) shortcutsEnabled = changes.pageShortcutsEnabled.newValue !== false;
    keyboard.update({ bindings, enabled: shortcutsEnabled && !isAnyModalOpen() });
    if (changes.providerSortMode) { sortMode = changes.providerSortMode.newValue; renderSortMode(); }
    if (changes.selectedPromptMode) {
      promptMode = toModeKey(changes.selectedPromptMode.newValue);
      renderPromptMode();
    }
    if (changes.providerTierRecipes) {
      tierRecipeOverrides = changes.providerTierRecipes.newValue || null;
      // Re-apply with the edited labels when no other tier change is pending.
      if (selectedTier && !changes.selectedProviderTier && pendingDesiredTier === undefined) {
        pendingDesiredTier = selectedTier;
        pendingTierPersist = false;
        renderTierState();
        scheduleDesiredTier();
      }
    }
    if (changes.selectedProviderTier) {
      const next = changes.selectedProviderTier.newValue;
      if (!PROVIDER_TIER_IDS.includes(next)) {
        pendingDesiredTier = undefined;
        pendingTierPersist = false;
        clearTimeout(desiredTierTimer);
        selectedTier = null;
        tierGeneration += 1;
        renderTierState();
      } else if (next !== selectedTier) {
        pendingDesiredTier = next;
        pendingTierPersist = false;
        renderTierState();
        scheduleDesiredTier();
      }
    }
    updateTooltips();
  });

  // Browser-level prompt-library bindings remain available independently of
  // page shortcuts; show the actual user-configured Chrome command.
  chrome.commands?.getAll?.().then(commands => {
    const binding = commands.find(command => command.name === 'open-prompt-library')?.shortcut;
    promptGlobalShortcut = binding ? formatShortcutForTooltip(binding) : '';
    updateTooltips();
  }).catch(() => {});
  renderSortMode();
  await refreshPromptModes();
  renderTierState();
  void refreshStates();
  getPanels().forEach(panelLoaded);

  return {
    panelLoaded,
    panelsChanged() {
      const ids = new Set(getPanels().map(panel => panel.id));
      for (const id of panelEpochs.keys()) if (!ids.has(id)) { states.delete(id); panelEpochs.delete(id); clearPanelTimers(id); }
      renderTierState();
    },
    restoreTier(targets = getPanels()) {
      if (selectedTier && pendingDesiredTier === undefined) {
        return applyTier(selectedTier, { targets, persist: false, ignoreBusy: true });
      }
    },
    refreshStates,
    refreshTooltips: updateTooltips,
    isTierBusy: () => tierBusy || pendingDesiredTier !== undefined,
    // The selected mode's instruction, or null for Default and Auto.
    getPromptMode: () => currentModePrompt()?.content ?? null,
    // The text and instruction for one send: Auto removes the trigger words
    // it finds and uses their modes; other modes keep the text as typed.
    resolvePromptMode: text => resolvePromptModeForText(text, {
      auto: isAutoMode(),
      instruction: currentModePrompt()?.content ?? null,
      modePrompts
    }),
    refreshPromptModes
  };
}

function toModeKey(value) {
  return typeof value === 'string' && value ? value : null;
}

function truncate(value, length) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function isAllowedPanelOrigin(panel, origin) {
  try {
    return new URL(panel.currentUrl || panel.iframe.src).origin === origin;
  } catch { return false; }
}
