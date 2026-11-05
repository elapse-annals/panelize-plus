(function(runtime) {
  'use strict';

  /**
   * Owns tier discovery behavior and its page-local state.
   * Deferred controller getters keep composition in the entry point.
   */


  function createTierDiscoveryController({
    getTierConfigController,
    getTierDomController,
    getTierMenuController
  }) {
    function matchesTier(label, tier) {
      return getTierDomController().matchesAny(label, getTierConfigController().config?.preferredTiers?.[tier]) || getTierDomController().matchesAny(label, getTierConfigController().config?.tiers?.[tier]);
    }

    function isEnabled(element) {
      if (!element || element.disabled || element.getAttribute('disabled') !== null) return false;
      if (element.getAttribute('aria-disabled') === 'true') return false;
      if (element.closest('[aria-disabled="true"], :disabled')) return false;
      if (/\b(locked|upgrade|subscribe|unavailable|not available|requires? plan)\b|锁定|升级套餐|暂不可用/i.test(getTierDomController().elementLabel(element))) return false;
      return true;
    }

    function allVisible(selector, root = document) {
      try {
        return Array.from(root.querySelectorAll(selector)).filter(getTierDomController().isVisible);
      } catch {
        return [];
      }
    }

    function isInteractive(element) {
      if (!element) return false;
      if (element.matches('button, input, select, [role="button"], [role="combobox"], [role="switch"], [role="checkbox"], [role="menuitem"], [role="menuitemradio"], [role="option"], [role="radio"], [aria-pressed], [aria-checked]')) return true;
      return element.tabIndex >= 0;
    }

    function getTriggerSelectors() {
      const models = getTierConfigController().config?.selectors || [];
      const efforts = getTierConfigController().config?.effortSelectors || [];
      // ChatGPT may expose a model picker alongside an independent strength
      // menu. Changing strength must keep using that menu after slider probing.
      return getTierConfigController().provider === 'chatgpt' ? [...efforts, ...models] : [...models, ...efforts];
    }

    function getTriggerCandidates() {
      if (!getTierConfigController().config) return [];
      const selectors = getTriggerSelectors();
      const selectorMatches = selectors.flatMap(selector => allVisible(selector));
      const genericMatches = allVisible('button, [role="button"], [role="combobox"], [aria-haspopup], [tabindex]');
      const unique = [...new Set([...selectorMatches, ...genericMatches])];
      return unique
        .map(element => ({ element, label: getTierDomController().elementLabel(element) }))
        .filter(({ element, label }) => label && !getTierDomController().isForbidden(element, label)
          && isInteractive(element)
          && (getTierDomController().matchesAny(label, getTierConfigController().config.triggerLabels) || selectors.some(selector => element.matches(selector))));
    }

    function findTrigger() {
      const candidates = getTriggerCandidates();
      const currentSelected = candidates.find(({ element }) => element.getAttribute('aria-expanded') === 'true');
      if (currentSelected) return currentSelected;
      for (const selector of getTriggerSelectors()) {
        const match = candidates.find(candidate => candidate.element.matches(selector));
        if (match) return match;
      }
      return candidates[0] || null;
    }

    function getOpenMenus() {
      return allVisible(getTierConfigController().MENU_SELECTOR);
    }

    function relatedMenuRoots(trigger, roots = getOpenMenus()) {
      if (!trigger) return [];
      const controls = getTierDomController().normalize(trigger.getAttribute('aria-controls')).split(' ').filter(Boolean);
      const controlled = controls
        .map(id => document.getElementById(id))
        .filter(root => root && getTierDomController().isVisible(root));
      if (controlled.length) return controlled;

      const triggerId = trigger.id;
      const labelled = roots.filter(root => triggerId && (
        root.getAttribute('aria-labelledby')?.split(/\s+/).includes(triggerId)
        || root.getAttribute('data-trigger-id') === triggerId
        || root.getAttribute('aria-owner') === triggerId
      ));
      if (labelled.length) return labelled;
      if (trigger.getAttribute('aria-expanded') === 'true' && roots.length === 1) return roots;
      return [];
    }

    function getMenuOptions(roots = getOpenMenus()) {
      const options = roots.flatMap(root => [
        ...(root.matches(getTierConfigController().OPTION_SELECTOR) ? [root] : []),
        ...Array.from(root.querySelectorAll(getTierConfigController().OPTION_SELECTOR))
      ]);
      return [...new Set(options)]
        .filter(getTierDomController().isVisible)
        .map(element => ({ element, label: getTierDomController().elementLabel(element) }))
        .filter(({ element, label }) => label && !getTierDomController().isForbidden(element, label));
    }

    function isSelected(element) {
      if (element.getAttribute('aria-selected') === 'true'
        || element.getAttribute('aria-checked') === 'true'
        || element.getAttribute('aria-pressed') === 'true'
        || element.getAttribute('data-state') === 'checked') return true;
      if (element instanceof HTMLInputElement && element.checked) return true;
      return false;
    }

    function getToggle() {
      if (!['toggle', 'discover'].includes(getTierConfigController().config?.strategy)) return null;
      const candidateSelectors = [...getTierConfigController().config.selectors, 'button', '[role="button"]', '[role="switch"]', '[role="checkbox"]', 'input[type="checkbox"]', 'label'];
      const candidates = [...new Set(candidateSelectors.flatMap(selector => allVisible(selector)))];
      for (const candidate of candidates) {
        const isLabel = candidate.tagName === 'LABEL';
        const control = isLabel ? candidate.control : candidate;
        const label = getTierDomController().elementLabel(candidate);
        if (!control || !isInteractive(control) || !label || getTierDomController().isForbidden(candidate, label)) continue;
        if (!getTierDomController().matchesAny(label, getTierConfigController().config.toggleLabels || getTierConfigController().config.triggerLabels)) continue;
        return { element: control, label };
      }
      return null;
    }

    function readToggle(toggle = getToggle()) {
      if (!toggle) return null;
      const { element, label } = toggle;
      let enabled = null;
      if (element.getAttribute('aria-pressed') === 'true' || element.getAttribute('aria-checked') === 'true' || element.getAttribute('data-state') === 'checked') enabled = true;
      if (element.getAttribute('aria-pressed') === 'false' || element.getAttribute('aria-checked') === 'false' || element.getAttribute('data-state') === 'unchecked') enabled = false;
      if (element instanceof HTMLInputElement && element.type === 'checkbox') enabled = element.checked;
      if (enabled == null) {
        const state = getTierDomController().normalize(element.getAttribute('aria-label') || element.textContent);
        if (/\b(on|enabled)\b|已开启|开启/i.test(state)) enabled = true;
        if (/\b(off|disabled)\b|未开启|关闭/i.test(state)) enabled = false;
      }
      return enabled == null ? null : {
        enabled,
        label: `${label} ${enabled ? 'on' : 'off'}`,
        tier: enabled ? 'deep' : 'fast',
        supportedTiers: ['fast', 'balanced', 'deep'],
        matchedTiers: enabled ? ['balanced', 'deep'] : ['fast']
      };
    }

    function tierMatchesForLabel(label) {
      const preferred = getTierConfigController().TIER_IDS.filter(tier => getTierDomController().matchesAny(label, getTierConfigController().config?.preferredTiers?.[tier]));
      if (preferred.length) return preferred;
      return getTierConfigController().TIER_IDS.filter(tier => getTierDomController().matchesAny(label, getTierConfigController().config?.tiers?.[tier]));
    }

    function getMenuSupport(options) {
      const support = new Set();
      const mapped = options.filter(({ element, label }) => isEnabled(element) && tierMatchesForLabel(label).length);
      for (const { label } of mapped) tierMatchesForLabel(label).forEach(tier => support.add(tier));
      // Kimi K2.6 offers Standard and Advanced without Extreme. Reuse Advanced
      // for the deep tier only when the account's visible menu has no higher item.
      const lockedDeep = options.some(({ element, label }) => !isEnabled(element) && matchesTier(label, 'deep'));
      if (getTierConfigController().provider === 'kimi' && support.has('balanced') && !support.has('deep') && !lockedDeep) support.add('deep');
      return { supportedTiers: getTierConfigController().TIER_IDS.filter(tier => support.has(tier)), mapped };
    }

    function currentMenuSelection(options) {
      return options.find(({ element }) => isSelected(element)) || null;
    }

    function matchesForCurrentLabel(label, options) {
      const matched = tierMatchesForLabel(label);
      if (getTierConfigController().provider === 'kimi' && options.length && matched.includes('balanced')) {
        const deepVisible = options.some(({ element, label: optionLabel }) => isEnabled(element)
          && getTierDomController().matchesAny(optionLabel, getTierConfigController().config?.preferredTiers?.deep));
        const deepLocked = options.some(({ element, label: optionLabel }) => !isEnabled(element)
          && getTierDomController().matchesAny(optionLabel, getTierConfigController().config?.preferredTiers?.deep));
        if (!deepVisible && !deepLocked) matched.push('deep');
      }
      return getTierConfigController().TIER_IDS.filter(tier => matched.includes(tier));
    }

    function readCurrentState() {
      const toggle = ['toggle', 'discover'].includes(getTierConfigController().config.strategy) ? getToggle() : null;
      if (toggle) {
        const state = readToggle(toggle);
        if (!state) return { status: 'unavailable', reason: 'toggle_state_not_readable', tier: null, actualLabel: toggle.label, supportedTiers: [], matchedTiers: [] };
        if (!isEnabled(toggle.element)) return { status: 'unavailable', reason: 'toggle_disabled', tier: state.tier, actualLabel: state.label, supportedTiers: [], matchedTiers: [] };
        return { status: 'success', reason: null, tier: state.tier, actualLabel: state.label, supportedTiers: state.supportedTiers, matchedTiers: state.matchedTiers };
      }

      const trigger = findTrigger();
      const options = getMenuOptions();
      const selected = currentMenuSelection(options) || null;
      const triggerLabel = trigger?.label || '';
      const effortLabel = getTierMenuController().getCurrentEffortLabel(trigger, options);
      const currentLabel = effortLabel || selected?.label || triggerLabel;
      const currentTiers = effortLabel
        ? getTierConfigController().TIER_IDS.filter(tier => getTierDomController().matchesAny(effortLabel, getTierConfigController().config?.preferredTiers?.[tier]))
        : tierMatchesForLabel(currentLabel);
      // For Claude and Gemini, a model name is not evidence of the active
      // reasoning level. Only a separately readable effort setting can confirm
      // a current tier. The model fallback is available only immediately after
      // this adapter itself selected and verified that model.
      const requiresEffortEvidence = ['claude', 'gemini'].includes(getTierConfigController().provider);
      const modelFallback = requiresEffortEvidence && !effortLabel;
      const menuSupport = getMenuSupport(options).supportedTiers;
      const supportedTiers = menuSupport.length ? menuSupport : currentTiers;
      if (!trigger && !selected) {
        if (getTierDomController().hasLoginGate()) return { status: 'unavailable', reason: 'not_logged_in', tier: null, actualLabel: null, supportedTiers: [], matchedTiers: [] };
        if (getTierConfigController().config.strategy === 'discover') return { status: 'unsupported', reason: 'no_detectable_tier_control', tier: null, actualLabel: null, supportedTiers: [], matchedTiers: [] };
        return { status: 'unavailable', reason: 'selector_not_visible', tier: null, actualLabel: null, supportedTiers: [], matchedTiers: [] };
      }
      if (trigger && !isEnabled(trigger.element)) {
        return { status: 'unavailable', reason: 'selector_disabled', tier: currentTiers[0] || null, actualLabel: currentLabel || null, supportedTiers: [], matchedTiers: [] };
      }
      const remembered = modelFallback && getTierMenuController().lastVerifiedSelection?.mappingPath === 'model'
        && getTierMenuController().lastVerifiedSelection?.provider === getTierConfigController().provider && getTierMenuController().lastVerifiedSelection.rawLabel === currentLabel
        ? getTierMenuController().lastVerifiedSelection
        : null;
      const currentTier = effortLabel
        ? currentTiers[0] || null
        : remembered?.tier || (modelFallback ? null : currentTiers[0] || null);
      if (!currentTier) {
        return {
          status: 'unavailable',
          reason: 'current_tier_unknown',
          tier: null,
          actualLabel: remembered?.actualLabel || (modelFallback ? `Model: ${currentLabel}` : currentLabel) || null,
          supportedTiers: remembered?.supportedTiers || supportedTiers,
          matchedTiers: []
        };
      }
      return {
        status: 'success',
        reason: options.length ? null : 'options_not_visible',
        tier: currentTier,
        actualLabel: remembered?.actualLabel || (modelFallback ? `Model: ${currentLabel}` : currentLabel) || null,
        supportedTiers: remembered?.supportedTiers || supportedTiers,
        matchedTiers: remembered?.matchedTiers || matchesForCurrentLabel(currentLabel, options)
      };
    }

    return {
      allVisible,
      currentMenuSelection,
      findTrigger,
      getMenuOptions,
      getMenuSupport,
      getOpenMenus,
      getToggle,
      isEnabled,
      isInteractive,
      isSelected,
      matchesForCurrentLabel,
      matchesTier,
      readCurrentState,
      readToggle,
      relatedMenuRoots,
      tierMatchesForLabel,
    };
  }

  runtime.factories.createTierDiscoveryController = createTierDiscoveryController;
})(globalThis.PanelizeContent);
