import { getSettings, saveSetting, saveSettings } from './settings.js';
import { getProviderById } from './providers.js';
import {
  DEFAULT_KEYBOARD_SHORTCUT_BINDINGS,
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
  toggleWideContent: ['composerWideContent', 'Wide mode']
};
const BUTTON_ACTIONS = {
  'send-all-btn': 'send', 'fill-input-btn': 'fill',
  'new-chat-btn': 'newConversation', 'composer-new-chat-btn': 'newConversation',
  'prompt-library-btn': 'togglePromptLibrary', 'layout-btn': 'toggleLayout',
  'provider-sort-btn': 'togglePopularSort',
  'wide-content-btn': 'toggleWideContent'
};

/** UI orchestration stays here; provider operations retain their own verified
 * request/result contracts and do not have access to the unified draft. */
export async function setupComposerControls({
  getPanels, send, fill, newConversation, focusInput, openPromptLibrary,
  openLayout, text, notify = () => {}, isOperationBusy = () => false,
  getPanelName = panel => getProviderById(panel.providerId)?.name || panel.providerId,
  isBlindMode = () => false,
  toggleWideContent = () => {}
}) {
  const byId = id => document.getElementById(id);
  if (!byId('composer-shell')) return null;
  const tr = (key, fallback, values = null) => text(key, fallback, values);
  const label = action => tr(...ACTION_LABELS[action]);
  const settings = await getSettings();
  let selectedTier = PROVIDER_TIER_IDS.includes(settings.selectedProviderTier) ? settings.selectedProviderTier : null;
  let tierRecipeOverrides = settings.providerTierRecipes || null;
  let sortMode = settings.providerSortMode;
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
    document.querySelectorAll('.tier-option').forEach(button => {
      // Default leaves every AI on its own setting, so it needs no confirmation.
      const isDefault = button.dataset.tier === DEFAULT_TIER;
      const requested = isDefault ? !displayedTier : button.dataset.tier === displayedTier;
      button.setAttribute('aria-checked', String(isDefault ? requested && !switching : allMatched && requested));
      // Keep the controls available while a batch runs. A later choice replaces
      // the queued one and is applied as soon as the current operation settles.
      button.disabled = false;
      button.dataset.requested = String(requested);
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

  function isAnyModalOpen() {
    return [...document.querySelectorAll('.modal')].some(modal => getComputedStyle(modal).display !== 'none');
  }

  function runAction(action) {
    if (isAnyModalOpen()) return;
    const actions = {
      send, fill, newConversation, focusInput, togglePromptLibrary: openPromptLibrary,
      toggleLayout: openLayout, togglePopularSort: toggleSort, toggleWideContent,
      tierFast: () => requestTier('fast'), tierBalanced: () => requestTier('balanced'), tierDeep: () => requestTier('deep')
    };
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
      button.title = `${base}${shortcut || globalShortcut ? ` (${shortcut || globalShortcut})` : ''}`;
      button.setAttribute('aria-label', button.title);
    });
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

  function renderShortcutFields() {
    const container = byId('keyboard-shortcuts-fields');
    container.replaceChildren();
    Object.keys(DEFAULT_KEYBOARD_SHORTCUT_BINDINGS).forEach(action => {
      const row = document.createElement('label');
      row.className = 'composer-shortcut-field';
      const caption = document.createElement('span');
      caption.textContent = label(action);
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
      container.append(row);
    });
  }

  document.querySelectorAll('.tier-option').forEach(button => {
    button.addEventListener('click', () => requestTier(button.dataset.tier === DEFAULT_TIER ? null : button.dataset.tier));
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const options = [...document.querySelectorAll('.tier-option')];
      const index = options.indexOf(button);
      const count = options.length;
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1
        : (index + (event.key === 'ArrowRight' ? 1 : count - 1)) % count;
      options[next]?.focus();
    });
  });
  byId('unified-input').addEventListener('focus', pulse);
  byId('provider-sort-btn').addEventListener('click', toggleSort);
  byId('tier-details-btn').addEventListener('click', () => { renderTierState(); openDialog('tier-details-modal'); });
  byId('retry-tier-btn').addEventListener('click', retryTier);
  byId('refresh-tier-state-btn').addEventListener('click', () => refreshStates());
  byId('keyboard-shortcuts-btn').addEventListener('click', () => {
    draftBindings = keyboard.getBindings();
    byId('page-shortcuts-enabled').checked = shortcutsEnabled;
    byId('keyboard-shortcuts-error').textContent = '';
    renderShortcutFields();
    openDialog('keyboard-shortcuts-modal');
  });
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
    if (!['keyboardShortcutBindings', 'pageShortcutsEnabled', 'providerSortMode', 'selectedProviderTier', 'providerTierRecipes'].some(key => changes[key])) return;
    if (changes.keyboardShortcutBindings) bindings = changes.keyboardShortcutBindings.newValue || {};
    if (changes.pageShortcutsEnabled) shortcutsEnabled = changes.pageShortcutsEnabled.newValue !== false;
    keyboard.update({ bindings, enabled: shortcutsEnabled && !isAnyModalOpen() });
    if (changes.providerSortMode) { sortMode = changes.providerSortMode.newValue; renderSortMode(); }
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
    isTierBusy: () => tierBusy || pendingDesiredTier !== undefined
  };
}

function isAllowedPanelOrigin(panel, origin) {
  try {
    return new URL(panel.currentUrl || panel.iframe.src).origin === origin;
  } catch { return false; }
}
