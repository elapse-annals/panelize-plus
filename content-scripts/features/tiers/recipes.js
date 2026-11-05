(function(runtime) {
  'use strict';

  /**
   * Owns tier recipes behavior and its page-local state.
   * Deferred controller getters keep composition in the entry point.
   */


  function createTierRecipesController({
    getTierConfigController,
    getTierDiscoveryController,
    getTierDomController,
    getTierMenuController,
    getTierSliderController
  }) {
    function lower(value) {
      return getTierDomController().normalize(value).toLowerCase();
    }

    function labelAlternatives(label) {
      return String(label || '').split('|').map(lower).filter(Boolean);
    }

    /**
     * 3 = whole label, 2 = label starts the text, 1 = label inside the text.
     * A label must not run into a neighbouring word of the same script, so
     * "Qwen3.7" never matches "Qwen3.7-Max", "hy3" never matches "hy3-preview"
     * and "高" never matches "高级推理", while "极致" still matches "GLM-Flash极致".
     */
    function labelScore(text, label) {
      const value = lower(text);
      let best = 0;
      for (const alternative of labelAlternatives(label)) {
        if (value === alternative) return 3;
        let index = value.indexOf(alternative);
        while (index !== -1) {
          const before = value[index - 1];
          const after = value[index + alternative.length];
          const leftOk = index === 0 || !joins(alternative[0], before);
          const rightOk = after === undefined || !joins(alternative.at(-1), after);
          if (leftOk && rightOk) {
            best = Math.max(best, index === 0 ? 2 : 1);
            break;
          }
          index = value.indexOf(alternative, index + 1);
        }
      }
      return best;
    }

    function joins(edge, neighbour) {
      if (getTierConfigController().ASCII_WORD.test(edge)) return getTierConfigController().LABEL_CHAR.test(neighbour);
      if (getTierConfigController().CJK_CHAR.test(edge)) return getTierConfigController().CJK_CHAR.test(neighbour);
      return false;
    }

    function normalizeRecipes(value) {
      if (!value || typeof value !== 'object') return null;
      const recipes = {};
      for (const tier of getTierConfigController().TIER_IDS) {
        const steps = Array.isArray(value[tier]) ? value[tier] : [];
        recipes[tier] = steps.slice(0, 4).map(item => {
          if (!item || typeof item !== 'object' || !['model', 'thinking', 'toggle'].includes(item.kind)) return null;
          const label = typeof item.label === 'string' ? item.label.trim().slice(0, 120) : '';
          if (!label) return null;
          return item.kind === 'toggle' ? { kind: 'toggle', label, on: item.on === true } : { kind: item.kind, label };
        }).filter(Boolean);
      }
      return recipes;
    }

    function kindLabels(recipes, kind) {
      return [...new Set(getTierConfigController().TIER_IDS.flatMap(tier => (recipes[tier] || [])
        .filter(item => item.kind === kind)
        .map(item => item.label)))];
    }

    /** A step shows in `text` unless a different label of the same kind fits better. */
    function stepShownIn(text, step, recipes) {
      if (!text) return false;
      const score = labelScore(text, step.label);
      if (!score) return false;
      return !kindLabels(recipes, step.kind)
        .some(label => lower(label) !== lower(step.label) && labelScore(text, label) > score);
    }

    function isRecipeForbidden(element, label) {
      if (getTierConfigController().RECIPE_FORBIDDEN_LABEL.test(label)) return true;
      return Boolean(element.closest('form [type="submit"], [data-testid*="send"], [aria-label*="send" i], [aria-label*="发送"]'));
    }

    function isInsideOpenMenu(element) {
      return getTierDiscoveryController().getOpenMenus().some(root => root !== element && root.contains(element));
    }

    function visibleOptionCandidates() {
      return getTierDiscoveryController().allVisible(getTierConfigController().LOOSE_OPTION_SELECTOR).filter(element => getTierDomController().normalize(getTierDomController().elementLabel(element)).length <= 80);
    }

    function outermost(elements) {
      const set = new Set(elements);
      return elements.filter(element => {
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          if (set.has(parent)) return false;
        }
        return true;
      });
    }

    function isChosen(element) {
      if (getTierDiscoveryController().isSelected(element)) return true;
      return Array.from(element.classList || []).some(name => /^(selected|checked|active|is-selected|is-checked|is-active)$|--(selected|checked|active)$/i.test(name));
    }

    function findStepTrigger(kind, recipes) {
      const selectors = kind === 'model' ? getTierConfigController().config.modelSelectors : getTierConfigController().config.thinkingSelectors;
      for (const selector of selectors || []) {
        const element = getTierDiscoveryController().allVisible(selector).find(candidate => !isInsideOpenMenu(candidate));
        if (element) return { element, label: stepTriggerLabel(kind, element) };
      }
      // Without a known selector, only popup buttons showing one of the
      // recipe's labels qualify, so no ordinary page button is ever clicked.
      const labels = kindLabels(recipes, kind);
      if (!labels.length) return null;
      return getTierDiscoveryController().allVisible('button[aria-haspopup], [role="button"][aria-haspopup], [role="combobox"], button[aria-expanded], [role="button"][aria-expanded]')
        .filter(element => !isInsideOpenMenu(element) && getTierDiscoveryController().isInteractive(element))
        .map(element => ({ element, label: getTierDomController().elementLabel(element) }))
        .find(({ element, label }) => label && label.length <= 60 && !isRecipeForbidden(element, label)
          && labels.some(candidate => labelScore(label, candidate) > 0)) || null;
    }

    function stepTriggerLabel(kind, element) {
      const attribute = kind === 'model' ? getTierConfigController().config.modelAttribute : null;
      const value = attribute ? element.getAttribute(attribute.name) || '' : '';
      return attribute?.labels.find(([pattern]) => pattern.test(value))?.[1] || getTierDomController().elementLabel(element);
    }

    function thinkingTrigger(recipes) {
      return findStepTrigger('thinking', recipes) || findStepTrigger('model', recipes);
    }

    function isKnownToggle(element) {
      return (getTierConfigController().config.toggleSelectors || []).some(selector => element.matches(selector));
    }

    function findRecipeToggle(step) {
      const candidates = [...new Set([...(getTierConfigController().config.toggleSelectors || []), 'button', '[role="button"]', '[role="switch"]', '[role="checkbox"]', 'input[type="checkbox"]', 'label']
        .flatMap(selector => getTierDiscoveryController().allVisible(selector)))];
      for (const candidate of candidates) {
        const control = candidate.tagName === 'LABEL' ? candidate.control : candidate;
        const label = getTierDomController().elementLabel(candidate);
        if (!control || !(isKnownToggle(control) || getTierDiscoveryController().isInteractive(control)) || !label || label.length > 40 || isRecipeForbidden(candidate, label)) continue;
        if (labelScore(label, step.label) > 0) return { element: control, label };
      }
      return null;
    }

    function readRecipeToggle(toggle) {
      const state = getTierDiscoveryController().readToggle(toggle);
      if (state) return state.enabled;
      const classes = Array.from(toggle.element.classList || []);
      if (classes.some(name => /--(selected|active|checked|on)$|^(selected|active|checked|is-active|is-selected)$|_(selected|active|checked)__/i.test(name))) return true;
      if (isKnownToggle(toggle.element) || classes.some(name => /toggle|switch/i.test(name))) return false;
      return null;
    }

    function closeOpenedMenus(opened) {
      if (!opened?.openedByUs) return;
      getTierMenuController().closeMenuIfOpened(true);
    }

    function pickOption(options, label, { excludeSubmenus = true } = {}) {
      let best = null;
      let bestScore = 0;
      for (const option of options) {
        if (excludeSubmenus && getTierConfigController().SUBMENU_LABEL.test(option.label)) continue;
        const score = labelScore(option.label, label);
        if (score > bestScore) {
          best = option;
          bestScore = score;
        }
      }
      return best;
    }

    async function openSubmenu(row, previousOptions, previousRoots) {
      const previous = new Map(previousOptions.map(option => [option.element, option.label]));
      const initialRoots = new Set(previousRoots);
      const before = new Set(visibleOptionCandidates());
      row.element.click();

      const roots = await getTierDomController().waitFor(() => {
        const visibleRoots = getTierDiscoveryController().getOpenMenus();
        const controlled = getTierDiscoveryController().relatedMenuRoots(row.element, visibleRoots)
          .filter(root => !previousRoots.includes(root));
        if (controlled.length === 1) return controlled;

        const added = visibleRoots.filter(root => !initialRoots.has(root));
        if (added.length === 1) return added;
        if (added.length > 1 && row.element.id) {
          const labelled = added.filter(root => (root.getAttribute('aria-labelledby') || '')
            .split(/\s+/).includes(row.element.id));
          if (labelled.length === 1) return labelled;
        }
        return null;
      }, 900);

      if (roots?.length === 1) {
        const options = getTierDiscoveryController().getMenuOptions(roots);
        const newlyAdded = options.filter(option => !previous.has(option.element)
          || previous.get(option.element) !== option.label);
        return newlyAdded.length ? newlyAdded : options;
      }

      // A framework may reuse the containing menu node for a nested picker.
      // Read only options newly rendered inside that same associated root.
      const containingRoot = previousRoots.find(root => root.contains(row.element));
      if (containingRoot) {
        const options = getTierDiscoveryController().getMenuOptions([containingRoot]);
        const newlyAdded = options.filter(option => !previous.has(option.element)
          || previous.get(option.element) !== option.label);
        if (newlyAdded.length) return newlyAdded;
      }

      // Roleless nested popovers are accepted only when their new options share
      // one identifiable menu/list container. If unrelated menus appear at the
      // same time, the selection is ambiguous and the step fails closed.
      const addedCandidates = visibleOptionCandidates().filter(element => !before.has(element));
      const addedContainers = [...new Set(addedCandidates.map(element => {
        let current = element.parentElement;
        while (current && current !== document.body) {
          if (current.matches('ul, [data-menu-root], [data-popover], [class*="menu" i], [class*="popover" i], [class*="dropdown" i]')) return current;
          current = current.parentElement;
        }
        return null;
      }).filter(Boolean))];
      if (addedContainers.length !== 1) return null;
      return visibleOptionCandidates()
        .filter(element => addedContainers[0].contains(element))
        .map(element => ({ element, label: getTierDomController().elementLabel(element) }))
        .filter(option => option.label);
    }

    async function readStepFromMenu(step, recipes) {
      const trigger = step.kind === 'model' ? findStepTrigger('model', recipes) : thinkingTrigger(recipes);
      if (!trigger) return null;
      const opened = await getTierMenuController().openMenu(trigger, { optionFallback: true });
      if (!opened || opened.error) return null;
      let label = null;
      const row = opened.options.find(option => getTierConfigController().SUBMENU_LABEL.test(option.label));
      if (step.kind === 'thinking' && row && stepShownIn(row.label.replace(getTierConfigController().SUBMENU_LABEL, ''), step, recipes)) label = row.label;
      if (!label) {
        const chosen = opened.options.find(option => isChosen(option.element) && !getTierConfigController().SUBMENU_LABEL.test(option.label));
        if (chosen && stepShownIn(chosen.label, step, recipes)) label = chosen.label;
      }
      closeOpenedMenus(opened);
      return label;
    }

    function readStepFromTriggers(step, recipes) {
      const trigger = step.kind === 'model' ? findStepTrigger('model', recipes) : thinkingTrigger(recipes);
      return trigger && stepShownIn(trigger.label, step, recipes) ? trigger.label : null;
    }

    async function runToggleStep(step) {
      const toggle = findRecipeToggle(step);
      if (!toggle) return { error: 'toggle_not_visible' };
      if (!getTierDiscoveryController().isEnabled(toggle.element)) return { error: 'toggle_disabled', locked: true };
      const enabled = readRecipeToggle(toggle);
      if (enabled === null) return { error: 'toggle_state_not_readable' };
      if (enabled !== step.on) toggle.element.click();
      const verified = await getTierDomController().waitFor(() => {
        const current = findRecipeToggle(step);
        return current && readRecipeToggle(current) === step.on ? current : null;
      }, 1100);
      return verified ? { label: `${toggle.label} ${step.on ? 'on' : 'off'}` } : { error: 'verification_failed' };
    }

    async function runMenuStep(step, recipes) {
      const shown = readStepFromTriggers(step, recipes);
      if (shown) return { label: shown };
      const trigger = step.kind === 'model' ? findStepTrigger('model', recipes) : thinkingTrigger(recipes);
      if (!trigger) return { error: 'selector_not_visible' };
      if (!getTierDiscoveryController().isEnabled(trigger.element)) return { error: 'selector_disabled', locked: true };
      const opened = await getTierMenuController().openMenu(trigger, { optionFallback: true });
      if (!opened || opened.error) return { error: opened?.error || 'menu_timeout' };
      let option = pickOption(opened.options, step.label);
      const row = step.kind === 'thinking' && !option ? opened.options.find(candidate => getTierConfigController().SUBMENU_LABEL.test(candidate.label)) : null;
      if (row) {
        const submenuOptions = await openSubmenu(row, opened.options, opened.roots || []);
        option = submenuOptions ? pickOption(submenuOptions, step.label, { excludeSubmenus: false }) : null;
      }
      if (!option) {
        closeOpenedMenus(opened);
        return { error: 'option_not_found' };
      }
      if (!getTierDiscoveryController().isEnabled(option.element)) {
        closeOpenedMenus(opened);
        return { error: 'option_locked', locked: true, label: option.label };
      }
      if (!isChosen(option.element)) {
        const target = (getTierConfigController().config.optionClickSelector && option.element.querySelector(getTierConfigController().config.optionClickSelector)) || option.element;
        target.click();
      }
      let label = await getTierDomController().waitFor(() => readStepFromTriggers(step, recipes), 1300, 70);
      if (getTierDiscoveryController().getOpenMenus().length && opened.openedByUs) closeOpenedMenus(opened);
      if (!label) label = await readStepFromMenu(step, recipes);
      return label ? { label } : { error: 'verification_failed' };
    }

    /**
     * A thinking step on a page with a strength slider (ChatGPT) moves the
     * slider to the stop of the tier its label names. Returns null when no
     * slider is shown, so the step falls back to picking a menu option.
     */
    async function runSliderStep(step) {
      if (!getTierSliderController().findThinkingSlider() && !getTierSliderController().findThinkingSliderTrigger()) return null;
      const tier = stepTier(step);
      if (!tier) return null;
      const result = await getTierSliderController().setThinkingSliderTier(tier);
      if (result.reason === 'slider_not_visible') return null;
      if (result.status === 'success') return { label: result.actualLabel };
      return { error: result.reason || 'verification_failed', locked: result.status === 'unavailable', label: result.actualLabel };
    }

    function stepTier(step) {
      return getTierConfigController().TIER_IDS.find(tier => labelAlternatives(step.label).some(label => getTierDiscoveryController().matchesTier(label, tier))) || null;
    }

    function recipeKey(steps) {
      return JSON.stringify((steps || []).map(item => [item.kind, lower(item.label), item.on === true]));
    }

    function tiersSharing(recipes, tier) {
      return getTierConfigController().TIER_IDS.filter(candidate => recipes[candidate]?.length && recipeKey(recipes[candidate]) === recipeKey(recipes[tier]));
    }

    function supportedRecipeTiers(recipes) {
      return getTierConfigController().TIER_IDS.filter(tier => recipes[tier]?.length);
    }

    function currentReadings(recipes) {
      const model = findStepTrigger('model', recipes);
      const thinking = findStepTrigger('thinking', recipes);
      const toggleSteps = getTierConfigController().TIER_IDS.flatMap(tier => recipes[tier] || []).filter(item => item.kind === 'toggle');
      const toggle = toggleSteps.length ? findRecipeToggle(toggleSteps[0]) : null;
      const thinkingLabels = kindLabels(recipes, 'thinking');
      const thinkingLabel = thinking && thinkingLabels.some(label => labelScore(thinking.label, label) > 0)
        ? thinking.label
        : model && thinkingLabels.some(label => labelScore(model.label, label) > 0)
          ? model.label
          : null;
      return {
        model: model?.label || null,
        thinking: thinkingLabel,
        toggle: toggle ? readRecipeToggle(toggle) : null,
        toggleLabel: toggle?.label || null
      };
    }

    function readingsLabel(readings) {
      const parts = [readings.model, readings.thinking !== readings.model ? readings.thinking : null,
        readings.toggleLabel && readings.toggle !== null ? `${readings.toggleLabel} ${readings.toggle ? 'on' : 'off'}` : null];
      return parts.filter(Boolean).join(' · ') || null;
    }

    function stepMatchesReadings(step, readings, recipes) {
      if (step.kind === 'toggle') return readings.toggle === null ? null : readings.toggle === step.on;
      const text = step.kind === 'model' ? readings.model : readings.thinking;
      // A strength slider names its own stops ("Thinking strength Low"), so
      // compare tiers instead of the recipe's labels.
      if (step.kind === 'thinking' && text && getTierDomController().matchesAny(text, getTierConfigController().config.sliderLabels)) {
        const tier = stepTier(step);
        return Boolean(tier) && getTierConfigController().TIER_IDS.every(candidate => getTierDiscoveryController().matchesTier(text, candidate) === (candidate === tier));
      }
      return text ? stepShownIn(text, step, recipes) : null;
    }

    function readRecipeState(recipes) {
      const readings = currentReadings(recipes);
      const actualLabel = readingsLabel(readings);
      const supportedTiers = supportedRecipeTiers(recipes);
      if (!actualLabel) {
        if (getTierDomController().hasLoginGate()) return { status: 'unavailable', reason: 'not_logged_in', tier: null, actualLabel: null, supportedTiers: [], matchedTiers: [] };
        return { status: 'unavailable', reason: 'selector_not_visible', tier: null, actualLabel: null, supportedTiers, matchedTiers: [] };
      }
      const matchedTiers = supportedTiers.filter(tier => {
        const results = recipes[tier].map(item => stepMatchesReadings(item, readings, recipes));
        return results.every(result => result === true);
      });
      const remembered = getTierMenuController().lastVerifiedSelection?.provider === getTierConfigController().provider && getTierMenuController().lastVerifiedSelection.rawLabel === actualLabel
        && matchedTiers.includes(getTierMenuController().lastVerifiedSelection.tier) ? getTierMenuController().lastVerifiedSelection : null;
      const tier = remembered?.tier || matchedTiers[0] || null;
      if (!tier) {
        return { status: 'unavailable', reason: 'current_tier_unknown', tier: null, actualLabel, supportedTiers, matchedTiers: [] };
      }
      return {
        status: 'success',
        reason: null,
        tier,
        actualLabel: remembered?.actualLabel || actualLabel,
        supportedTiers,
        matchedTiers: remembered?.matchedTiers || matchedTiers
      };
    }

    async function setRecipeTier(tier, recipes) {
      const steps = recipes[tier] || [];
      const supportedTiers = supportedRecipeTiers(recipes);
      const failure = (status, reason, actualLabel = null) => ({
        status, reason, tier: null, requestedTier: tier, actualLabel, supportedTiers, matchedTiers: []
      });
      if (!steps.length) return failure('unsupported', 'tier_not_mapped');
      const confirmed = [];
      for (const item of steps) {
        const result = item.kind === 'toggle' ? await runToggleStep(item)
          : (item.kind === 'thinking' && await runSliderStep(item)) || await runMenuStep(item, recipes);
        if (result.error) {
          const partial = [...confirmed, '?'].join(' · ');
          if (result.error === 'selector_not_visible' && getTierDomController().hasLoginGate()) return failure('unavailable', 'not_logged_in');
          if (result.locked) return failure('unavailable', result.error, result.label || partial);
          if (result.error === 'menu_timeout') return failure('timeout', `step_failed:${item.kind}`, partial);
          if (result.error === 'unrelated_menu_visible') return failure('unavailable', result.error, partial);
          return failure('error', `step_failed:${item.kind}`, partial);
        }
        confirmed.push(result.label);
      }
      const finalReadings = currentReadings(recipes);
      const finalResults = steps.map(item => stepMatchesReadings(item, finalReadings, recipes));
      if (finalResults.some(result => result === false)) {
        return failure('error', 'verification_failed', readingsLabel(finalReadings));
      }
      const matchedTiers = tiersSharing(recipes, tier);
      const label = [...new Set(confirmed)].join(' · ');
      const actualLabel = matchedTiers.length > 1 ? `${label} (shared mapping: ${matchedTiers.join('/')})` : label;
      getTierMenuController().lastVerifiedSelection = {
        provider: getTierConfigController().provider,
        rawLabel: readingsLabel(finalReadings),
        tier,
        actualLabel,
        supportedTiers,
        matchedTiers
      };
      return { status: 'success', reason: null, tier, requestedTier: tier, actualLabel, supportedTiers, matchedTiers };
    }

    async function processRecipeRequest(data) {
      const recipes = normalizeRecipes(data.recipes);
      if (!recipes || !supportedRecipeTiers(recipes).length) {
        return { status: 'unsupported', reason: 'missing_recipes', tier: null, requestedTier: data.tier || null, actualLabel: null, supportedTiers: [] };
      }
      if (data.type === 'GET_PROVIDER_TIER_STATE') return readRecipeState(recipes);
      return setRecipeTier(data.tier, recipes);
    }

    return {
      outermost,
      processRecipeRequest,
      visibleOptionCandidates,
    };
  }

  runtime.factories.createTierRecipesController = createTierRecipesController;
})(globalThis.PanelizeContent);
