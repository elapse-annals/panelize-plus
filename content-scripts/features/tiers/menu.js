(function(runtime) {
  'use strict';

  /**
   * Owns tier menu behavior and its page-local state.
   * Deferred controller getters keep composition in the entry point.
   */


  function createTierMenuController({
    getTierConfigController,
    getTierDiscoveryController,
    getTierDomController,
    getTierRecipesController
  }) {
    let lastVerifiedSelection = null;

    function getCurrentEffortLabel(modelTrigger, menuOptions) {
      if (!['claude', 'gemini'].includes(getTierConfigController().provider)) return null;

      for (const selector of getTierConfigController().config?.effortSelectors || []) {
        const indicator = getTierDiscoveryController().allVisible(selector).find(element => !getTierDomController().isForbidden(element, getTierDomController().elementLabel(element)));
        const accessible = getTierDomController().normalize(indicator?.getAttribute('aria-label') || indicator?.getAttribute('title'));
        const label = accessible && /(effort|thinking level|reasoning level|思考强度|推理强度)/i.test(accessible)
          ? accessible
          : getTierDomController().elementLabel(indicator);
        if (label && getTierConfigController().TIER_IDS.some(tier => getTierDomController().matchesAny(label, getTierConfigController().config?.preferredTiers?.[tier]))) {
          return label;
        }
      }

      // A checked Low/Medium/High item counts only inside a menu rooted at the
      // visible Effort/Thinking control. A checked model option with a similar
      // label never stands in for reasoning strength.
      const roots = getTierDiscoveryController().getOpenMenus();
      const effortControls = menuOptions.filter(({ label }) => getTierDomController().matchesAny(label, getTierConfigController().config?.submenuLabels));
      const selectedEffort = menuOptions.find(({ element, label }) => getTierDiscoveryController().isSelected(element)
        && getTierConfigController().TIER_IDS.some(tier => getTierDomController().matchesAny(label, getTierConfigController().config?.preferredTiers?.[tier])));
      if (selectedEffort) {
        const selectedRoot = roots.find(root => root === selectedEffort.element || root.contains(selectedEffort.element));
        if (selectedRoot && effortControls.some(({ element }) => getTierDiscoveryController().relatedMenuRoots(element, roots).includes(selectedRoot))) {
          return selectedEffort.label;
        }

        const labelledBy = (selectedRoot?.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
        if (labelledBy.some(id => {
          const labelElement = document.getElementById(id);
          return labelElement && getTierDomController().matchesAny(getTierDomController().elementLabel(labelElement), getTierConfigController().config?.submenuLabels);
        })) {
          return selectedEffort.label;
        }
      }

      // Some pages expose the active model and effort in one accessible picker
      // label. Require an explicit effort word along with the selected level.
      const triggerLabel = modelTrigger?.label || '';
      if (/(effort|thinking level|reasoning level|思考强度|推理强度)/i.test(triggerLabel)
        && getTierConfigController().TIER_IDS.some(tier => getTierDomController().matchesAny(triggerLabel, getTierConfigController().config?.preferredTiers?.[tier]))) {
        return triggerLabel;
      }
      return null;
    }

    // A model-only fallback is verified by this script, but it cannot observe
    // an external effort change on the same model. Drop that cache as soon as
    // the user interacts with the provider page.
    function invalidateModelFallback() {
      if (lastVerifiedSelection?.mappingPath === 'model') lastVerifiedSelection = null;
    }

    async function openMenu(trigger = getTierDiscoveryController().findTrigger(), { optionFallback = false } = {}) {
      if (!trigger) return { error: 'selector_not_visible' };
      if (!getTierDiscoveryController().isEnabled(trigger.element)) return { error: 'selector_disabled' };
      const currentRoots = getTierDiscoveryController().getOpenMenus();
      const associatedRoots = getTierDiscoveryController().relatedMenuRoots(trigger.element, currentRoots);
      if (associatedRoots.length) {
        const options = getTierDiscoveryController().getMenuOptions(associatedRoots);
        return options.length ? { roots: associatedRoots, options, openedByUs: false } : { error: 'menu_empty' };
      }
      if (currentRoots.length) return { error: 'unrelated_menu_visible' };

      const rootsBefore = new Set(currentRoots);
      const optionsBefore = optionFallback ? new Set(getTierRecipesController().visibleOptionCandidates()) : null;
      trigger.element.click();
      const roots = await getTierDomController().waitFor(() => {
        const currentRootsAfterClick = getTierDiscoveryController().getOpenMenus();
        const controlled = getTierDiscoveryController().relatedMenuRoots(trigger.element, currentRootsAfterClick);
        if (controlled.length) return controlled;
        const added = currentRootsAfterClick.filter(root => !rootsBefore.has(root));
        if (added.length === 1) return added;
        if (trigger.element.getAttribute('aria-expanded') === 'true' && currentRootsAfterClick.length === 1) return currentRootsAfterClick;
        return null;
      }, optionFallback ? 700 : 1400);
      if (!roots && optionsBefore) {
        // Popovers without a menu role: the options are what the click revealed.
        const options = await getTierDomController().waitFor(() => {
          const added = getTierRecipesController().outermost(getTierRecipesController().visibleOptionCandidates().filter(element => !optionsBefore.has(element)));
          return added.length ? added : null;
        }, 700);
        return options
          ? { roots: [], options: options.map(element => ({ element, label: getTierDomController().elementLabel(element) })).filter(({ label }) => label), openedByUs: true }
          : { error: 'menu_timeout' };
      }
      if (!roots) return { error: 'menu_timeout' };
      const options = getTierDiscoveryController().getMenuOptions(roots);
      return options.length ? { roots, options, openedByUs: true } : { error: 'menu_empty' };
    }

    function closeMenuIfOpened(openedByUs) {
      if (!openedByUs) return;
      const active = document.activeElement || document.body;
      active.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }

    function optionForTier(options, tier) {
      const enabled = options.filter(({ element }) => getTierDiscoveryController().isEnabled(element));
      const lockedPreferred = options.find(({ element, label }) => !getTierDiscoveryController().isEnabled(element)
        && getTierDomController().matchesAny(label, getTierConfigController().config?.preferredTiers?.[tier]));
      if (lockedPreferred) return { ...lockedPreferred, locked: true };
      const locked = options.find(({ element, label }) => !getTierDiscoveryController().isEnabled(element) && getTierDiscoveryController().matchesTier(label, tier));
      if (locked) return { ...locked, locked: true };
      let selected = enabled.find(({ label }) => getTierDomController().matchesAny(label, getTierConfigController().config?.preferredTiers?.[tier]));
      const usedPreferred = Boolean(selected);
      if (!selected) selected = enabled.find(({ label }) => getTierDiscoveryController().matchesTier(label, tier));
      if (!selected && getTierConfigController().provider === 'kimi' && tier === 'deep') {
        selected = enabled.find(({ label }) => getTierDiscoveryController().matchesTier(label, 'balanced'));
      }
      if (!selected) return null;
      const matchedTiers = getTierDiscoveryController().matchesForCurrentLabel(selected.label, options);
      const mappingPath = ['claude', 'gemini'].includes(getTierConfigController().provider)
        ? (usedPreferred ? 'effort' : 'model')
        : getTierConfigController().config?.preferredTiers ? 'effort' : 'mode';
      return { ...selected, matchedTiers, shared: matchedTiers.length > 1, mappingPath };
    }

    function findSubmenuTrigger(options) {
      if (!getTierConfigController().config?.submenuLabels?.length) return null;
      return options.find(({ element, label }) => getTierDiscoveryController().isEnabled(element) && getTierDomController().matchesAny(label, getTierConfigController().config.submenuLabels)) || null;
    }

    async function openTierMenu(tier) {
      const opened = await openMenu();
      if (!opened || opened.error) return opened;
      const preferredVisible = options => options.some(({ element, label }) => getTierDiscoveryController().isEnabled(element)
        && getTierDomController().matchesAny(label, getTierConfigController().config?.preferredTiers?.[tier]));
      const directOption = optionForTier(opened.options, tier);
      const submenu = findSubmenuTrigger(opened.options);
      const shouldOpenSubmenu = submenu && !preferredVisible(opened.options)
        && (getTierConfigController().config?.preferredTiers || !directOption);
      if (!shouldOpenSubmenu) return opened;

      const previousRoots = new Set(getTierDiscoveryController().getOpenMenus());
      const previousLabels = new Map(opened.options.map(option => [option.element, option.label]));
      submenu.element.click();
      const submenuRoots = await getTierDomController().waitFor(() => {
        const roots = getTierDiscoveryController().getOpenMenus();
        const controlled = getTierDiscoveryController().relatedMenuRoots(submenu.element, roots);
        if (controlled.length) return controlled;
        const added = roots.filter(root => !previousRoots.has(root));
        if (added.length === 1) return added;
        if (added.length > 1) {
          const labelled = added.filter(root => root.getAttribute('aria-labelledby') === submenu.element.id);
          if (labelled.length === 1) return labelled;
        }
        return null;
      }, 900);
      if (!submenuRoots) return { error: 'submenu_not_detected' };
      const newOptions = getTierDiscoveryController().getMenuOptions(submenuRoots).filter(option => !previousLabels.has(option.element)
        || previousLabels.get(option.element) !== option.label);
      const scopedOptions = newOptions.length ? newOptions : getTierDiscoveryController().getMenuOptions(submenuRoots);
      return {
        roots: submenuRoots,
        options: scopedOptions,
        openedByUs: true
      };
    }

    function labelMatchesTierPath(label, tier, mappingPath = 'mode') {
      if (mappingPath === 'effort') return getTierDomController().matchesAny(label, getTierConfigController().config?.preferredTiers?.[tier]);
      if (mappingPath === 'model') {
        const preferred = getTierConfigController().TIER_IDS.some(candidate => getTierDomController().matchesAny(label, getTierConfigController().config?.preferredTiers?.[candidate]));
        return !preferred && getTierDomController().matchesAny(label, getTierConfigController().config?.tiers?.[tier]);
      }
      return getTierDiscoveryController().tierMatchesForLabel(label).includes(tier);
    }

    function selectionLabelForTier(tier, mappingPath = 'mode') {
      const toggle = getTierDiscoveryController().readToggle();
      if (toggle) return toggle.matchedTiers.includes(tier) ? toggle.label : null;
      const options = getTierDiscoveryController().getMenuOptions();
      const selected = getTierDiscoveryController().currentMenuSelection(options);
      const trigger = getTierDiscoveryController().findTrigger();
      const label = selected?.label || trigger?.label || '';
      if (labelMatchesTierPath(label, tier, mappingPath)) return label;
      if (getTierConfigController().provider === 'kimi' && tier === 'deep' && getTierDiscoveryController().matchesTier(label, 'balanced') && mappingPath !== 'model') return label;
      return null;
    }

    async function verifyTier(tier, openedMenuByUs, mappingPath = 'mode') {
      let actualLabel = selectionLabelForTier(tier, mappingPath);
      if (actualLabel) return actualLabel;
      closeMenuIfOpened(openedMenuByUs);

      const opened = await openTierMenu(tier);
      if (!opened || opened.error) return null;
      const selected = getTierDiscoveryController().currentMenuSelection(opened.options);
      const selectedLabel = selected?.label || selectionLabelForTier(tier, mappingPath);
      const actualMatches = selectedLabel && (
        labelMatchesTierPath(selectedLabel, tier, mappingPath)
        || (getTierConfigController().provider === 'kimi' && tier === 'deep' && getTierDiscoveryController().matchesTier(selectedLabel, 'balanced') && !getTierDiscoveryController().getMenuSupport(opened.options).supportedTiers.includes('deep'))
      );
      closeMenuIfOpened(opened.openedByUs);
      return actualMatches ? selectedLabel : null;
    }

    async function setToggleTier(tier) {
      const toggle = getTierDiscoveryController().getToggle();
      if (!toggle) {
        const loginGate = getTierDomController().hasLoginGate();
        return { status: loginGate ? 'unavailable' : 'unsupported', reason: loginGate ? 'not_logged_in' : 'toggle_not_visible', tier: null, requestedTier: tier, actualLabel: null, supportedTiers: [] };
      }
      if (!getTierDiscoveryController().isEnabled(toggle.element)) return { status: 'unavailable', reason: 'toggle_disabled', tier: null, requestedTier: tier, actualLabel: toggle.label, supportedTiers: [] };
      const shouldEnable = tier !== 'fast';
      const state = getTierDiscoveryController().readToggle(toggle);
      if (!state) return { status: 'unavailable', reason: 'toggle_state_not_readable', tier: null, requestedTier: tier, actualLabel: toggle.label, supportedTiers: [] };
      if (state.enabled !== shouldEnable) toggle.element.click();
      const verified = await getTierDomController().waitFor(() => {
        const current = getTierDiscoveryController().readToggle(getTierDiscoveryController().getToggle());
        return current && current.enabled === shouldEnable ? current : null;
      }, 1100);
      if (!verified) return { status: 'error', reason: 'verification_failed', tier: null, requestedTier: tier, actualLabel: null, supportedTiers: ['fast', 'balanced', 'deep'] };
      const label = `${verified.label}${verified.matchedTiers.length > 1 ? ' (balanced/deep share this toggle)' : ''}`;
      return {
        status: 'success',
        reason: null,
        tier: verified.tier,
        requestedTier: tier,
        actualLabel: label,
        supportedTiers: verified.supportedTiers,
        matchedTiers: verified.matchedTiers
      };
    }

    async function setMenuTier(tier) {
      const opened = await openTierMenu(tier);
      if (!opened || opened.error) {
        if (getTierDomController().hasLoginGate()) return { status: 'unavailable', reason: 'not_logged_in', tier: null, requestedTier: tier, actualLabel: null, supportedTiers: [], matchedTiers: [] };
        if (opened?.error === 'selector_disabled') return { status: 'unavailable', reason: opened.error, tier: null, requestedTier: tier, actualLabel: getTierDiscoveryController().findTrigger()?.label || null, supportedTiers: [], matchedTiers: [] };
        if (opened?.error === 'selector_not_visible' && getTierConfigController().config.strategy === 'discover') return { status: 'unsupported', reason: 'no_detectable_tier_control', tier: null, requestedTier: tier, actualLabel: null, supportedTiers: [], matchedTiers: [] };
        if (opened?.error === 'selector_not_visible') return { status: 'unavailable', reason: opened.error, tier: null, requestedTier: tier, actualLabel: null, supportedTiers: [], matchedTiers: [] };
        if (opened?.error === 'unrelated_menu_visible') return { status: 'unavailable', reason: opened.error, tier: null, requestedTier: tier, actualLabel: null, supportedTiers: [], matchedTiers: [] };
        return { status: 'timeout', reason: 'menu_timeout', tier: null, requestedTier: tier, actualLabel: null, supportedTiers: [], matchedTiers: [] };
      }

      const support = getTierDiscoveryController().getMenuSupport(opened.options).supportedTiers;
      const option = optionForTier(opened.options, tier);
      if (!option || option.locked || !getTierDiscoveryController().isEnabled(option.element)) {
        closeMenuIfOpened(opened.openedByUs);
        const matching = opened.options.find(({ label }) => getTierDiscoveryController().matchesTier(label, tier));
        return {
          status: matching ? 'unavailable' : 'unsupported',
          reason: matching ? 'option_locked' : 'tier_unavailable',
          tier: null,
          requestedTier: tier,
          actualLabel: matching?.label || null,
          supportedTiers: support,
          matchedTiers: []
        };
      }

      const alreadySelected = getTierDiscoveryController().isSelected(option.element) && getTierDiscoveryController().matchesTier(option.label, tier);
      if (!alreadySelected) option.element.click();
      let actualLabel = await getTierDomController().waitFor(() => selectionLabelForTier(tier, option.mappingPath), 1300, 70);
      if (!actualLabel) actualLabel = await verifyTier(tier, opened.openedByUs, option.mappingPath);
      if (!actualLabel) {
        closeMenuIfOpened(opened.openedByUs);
        return { status: 'error', reason: 'verification_failed', tier: null, requestedTier: tier, actualLabel: null, supportedTiers: support, matchedTiers: [] };
      }
      closeMenuIfOpened(opened.openedByUs);
      const matchedTiers = option.matchedTiers || getTierDiscoveryController().matchesForCurrentLabel(option.label, opened.options);
      const actualTier = matchedTiers[0] || tier;
      const shared = matchedTiers.length > 1;
      const pathLabel = option.mappingPath === 'model' ? `Model: ${actualLabel} (tier fallback)` : actualLabel;
      const actualLabelWithMapping = shared ? `${pathLabel} (shared mapping: ${matchedTiers.join('/')})` : pathLabel;
      lastVerifiedSelection = {
        provider: getTierConfigController().provider,
        rawLabel: option.label,
        mappingPath: option.mappingPath,
        tier: actualTier,
        actualLabel: actualLabelWithMapping,
        supportedTiers: support,
        matchedTiers
      };
      return {
        status: 'success',
        reason: null,
        tier: actualTier,
        requestedTier: tier,
        actualLabel: actualLabelWithMapping,
        supportedTiers: support,
        matchedTiers
      };
    }

    return {
      closeMenuIfOpened,
      getCurrentEffortLabel,
      invalidateModelFallback,
      get lastVerifiedSelection() { return lastVerifiedSelection; },
      set lastVerifiedSelection(value) { lastVerifiedSelection = value; },
      openMenu,
      setMenuTier,
      setToggleTier,
    };
  }

  runtime.factories.createTierMenuController = createTierMenuController;
})(globalThis.PanelizeContent);
