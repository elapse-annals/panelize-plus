(function(runtime) {
  'use strict';

  /**
   * Owns tier slider behavior and its page-local state.
   * Deferred controller getters keep composition in the entry point.
   */


  function createTierSliderController({
    getTierConfigController,
    getTierDiscoveryController,
    getTierDomController,
    getTierMenuController
  }) {
    function isThinkingSlider(element) {
      if (!element || !(element.matches('input[type="range"], [role="slider"]'))) return false;
      const labelledBy = getTierDomController().normalize(element.getAttribute('aria-labelledby')).split(' ').filter(Boolean)
        .map(id => getTierDomController().elementLabel(document.getElementById(id)))
        .join(' ');
      const directLabel = getTierDomController().normalize(element.getAttribute('aria-label') || element.getAttribute('title') || labelledBy);
      if (getTierDomController().matchesAny(directLabel, getTierConfigController().config?.sliderLabels)) return true;
      for (let ancestor = element.parentElement, depth = 0; ancestor && ancestor !== document.body && depth < 6; ancestor = ancestor.parentElement, depth++) {
        const label = getTierDomController().normalize(ancestor.innerText || ancestor.textContent);
        if (label.length <= 180 && getTierDomController().matchesAny(label, getTierConfigController().config?.sliderLabels)) return true;
      }
      return false;
    }

    function findThinkingSlider() {
      if (!getTierConfigController().config?.sliderLabels?.length) return null;
      const visibleSliders = getTierDiscoveryController().allVisible('input[type="range"], [role="slider"]');
      return visibleSliders.find(isThinkingSlider) || null;
    }

    function findThinkingSliderTrigger() {
      if (!getTierConfigController().config?.sliderLabels?.length) return null;
      const selectors = getTierConfigController().config.effortSelectors || [];
      const elements = [...new Set([
        ...selectors.flatMap(selector => getTierDiscoveryController().allVisible(selector)),
        ...getTierDiscoveryController().allVisible('button, [role="button"], [aria-haspopup], [aria-expanded]')
      ])];
      return elements.map(element => ({ element, label: getTierDomController().elementLabel(element) }))
        .find(({ element, label }) => label && !getTierDomController().isForbidden(element, label)
          && getTierDiscoveryController().isInteractive(element) && getTierDomController().matchesAny(label, getTierConfigController().config.sliderLabels)) || null;
    }

    function sliderBounds(slider) {
      if (!slider) return null;
      const nativeRange = slider instanceof HTMLInputElement && slider.type === 'range';
      const parse = (attribute, fallback) => {
        const value = slider.getAttribute(attribute);
        return value !== null && value.trim() ? Number(value) : fallback;
      };
      const min = parse('aria-valuemin', parse('min', nativeRange ? 0 : null));
      const max = parse('aria-valuemax', parse('max', nativeRange ? 100 : null));
      const value = parse('aria-valuenow', nativeRange ? Number(slider.value) : null);
      const step = parse('aria-valuestep', parse('step', 1));
      if (![min, max, value, step].every(Number.isFinite) || max <= min || step <= 0) return null;
      const intervals = Math.round((max - min) / step);
      if (intervals < 1) return null;
      const levels = intervals + 1;
      if (levels < 3) {
        return { min, max, value, step, levels, stops: [{ tier: 'fast', value: min }, { tier: 'deep', value: max }] };
      }
      const middleIndex = Math.round(intervals / 2);
      const stops = [
        { tier: 'fast', value: min },
        { tier: 'balanced', value: min + middleIndex * step },
        { tier: 'deep', value: min + intervals * step }
      ];
      return { min, max, value, step, levels, stops };
    }

    function sliderTier(slider) {
      if (!slider) return null;
      const labelledTier = sliderLabelTier(slider);
      const bounds = sliderBounds(slider);
      const tolerance = bounds ? Math.max(bounds.step / 2, (bounds.max - bounds.min) * 0.01) : 0;
      const numericTier = bounds
        ? bounds.stops.find(stop => Math.abs(stop.value - bounds.value) <= tolerance)?.tier || null
        : null;
      if (labelledTier && numericTier && labelledTier !== numericTier) return null;
      return labelledTier || numericTier;
    }

    function sliderLabelTier(slider) {
      if (!slider) return null;
      const valueText = getTierDomController().normalize(slider.getAttribute('aria-valuetext') || slider.getAttribute('data-value-label'));
      const valueTier = getTierConfigController().TIER_IDS.find(tier => getTierDomController().matchesAny(valueText, getTierConfigController().config?.tiers?.[tier]));
      if (valueTier) return valueTier;
      const trigger = findThinkingSliderTrigger();
      return trigger ? getTierConfigController().TIER_IDS.find(tier => getTierDiscoveryController().matchesTier(trigger.label, tier)) || null : null;
    }

    function sliderState(slider) {
      if (!slider) return null;
      const bounds = sliderBounds(slider);
      const tier = sliderTier(slider);
      if (!bounds) return { status: 'unavailable', reason: 'slider_range_not_readable', tier: null, actualLabel: null, supportedTiers: [], matchedTiers: [] };
      const supportedTiers = bounds.stops.map(stop => stop.tier);
      const actualLabel = getTierDomController().normalize(slider.getAttribute('aria-valuetext')) || findThinkingSliderTrigger()?.label || `思考强度 ${bounds.value}`;
      if (!tier) return { status: 'unavailable', reason: 'current_tier_unknown', tier: null, actualLabel, supportedTiers, matchedTiers: [] };
      return { status: 'success', reason: null, tier, actualLabel, supportedTiers, matchedTiers: [tier] };
    }

    async function readThinkingSliderState({ openIfNeeded = false } = {}) {
      let slider = findThinkingSlider();
      const trigger = findThinkingSliderTrigger();
      let openedByUs = false;
      try {
        if (!slider && trigger && openIfNeeded && getTierDiscoveryController().isEnabled(trigger.element)) {
          trigger.element.click();
          openedByUs = true;
          slider = await getTierDomController().waitFor(findThinkingSlider, 700, 35);
        }
        if (slider) return sliderState(slider);
        if (trigger) {
          return {
            status: 'unavailable',
            reason: getTierDiscoveryController().isEnabled(trigger.element) ? 'slider_not_visible' : 'slider_disabled',
            tier: null,
            actualLabel: trigger.label || null,
            supportedTiers: [],
            matchedTiers: []
          };
        }
        return null;
      } finally {
        if (openedByUs) getTierMenuController().closeMenuIfOpened(true);
      }
    }

    function dispatchRangeInput(slider, value) {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(slider), 'value')?.set;
      if (setter) setter.call(slider, String(value));
      else slider.value = String(value);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
    }

    async function setAccessibleSliderValue(slider, target, bounds) {
      const deadline = Date.now() + 3000;
      const tolerance = Math.max(bounds.step / 2, (bounds.max - bounds.min) * 0.01);
      if (Math.abs(bounds.value - target.value) <= tolerance) return slider;
      const originalActiveElement = document.activeElement;
      const dispatchKey = (element, key) => {
        element.focus();
        element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
        element.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }));
      };
      let current = slider;
      let currentBounds = bounds;
      try {
        const endpointKey = target.value === bounds.min ? 'Home' : target.value === bounds.max ? 'End' : null;
        if (endpointKey) {
          dispatchKey(current, endpointKey);
          const updated = await getTierDomController().waitFor(() => {
            const candidate = findThinkingSlider();
            const value = sliderBounds(candidate)?.value;
            return candidate && value !== currentBounds.value ? candidate : null;
          }, Math.min(100, Math.max(0, deadline - Date.now())), 10);
          if (updated) {
            current = updated;
            currentBounds = sliderBounds(current);
            if (!currentBounds) return null;
          }
        }

        const delta = Math.round((target.value - currentBounds.value) / currentBounds.step);
        if (delta === 0) return current;
        if (Math.abs(delta) > 128) return null;
        const key = delta > 0 ? 'ArrowRight' : 'ArrowLeft';
        for (let index = 0; index < Math.abs(delta); index++) {
          const remaining = deadline - Date.now();
          if (remaining <= 0) return null;
          const previous = currentBounds.value;
          dispatchKey(current, key);
          const updated = await getTierDomController().waitFor(() => {
            const candidate = findThinkingSlider();
            const value = sliderBounds(candidate)?.value;
            return candidate && value !== previous ? candidate : null;
          }, Math.min(100, remaining), 10);
          if (!updated) return null;
          current = updated;
          currentBounds = sliderBounds(current);
          if (!currentBounds) return null;
        }
        return Math.abs(currentBounds.value - target.value) <= tolerance ? current : null;
      } finally {
        const activeElement = document.activeElement;
        if (activeElement === current && current?.isConnected && current.matches('[role="slider"]')
          && originalActiveElement?.isConnected && originalActiveElement !== document.body
          && typeof originalActiveElement.focus === 'function') {
          originalActiveElement.focus();
        }
      }
    }

    async function setThinkingSliderTier(tier) {
      let slider = findThinkingSlider();
      const trigger = findThinkingSliderTrigger();
      let openedByUs = false;
      try {
        if (!slider && trigger && getTierDiscoveryController().isEnabled(trigger.element)) {
          trigger.element.click();
          openedByUs = true;
          slider = await getTierDomController().waitFor(findThinkingSlider, 700, 35);
        }
        if (!slider) {
          return {
            status: trigger && !getTierDiscoveryController().isEnabled(trigger.element) ? 'unavailable' : 'unsupported',
            reason: trigger && !getTierDiscoveryController().isEnabled(trigger.element) ? 'selector_disabled' : 'slider_not_visible',
            tier: null, requestedTier: tier, actualLabel: trigger?.label || null,
            supportedTiers: [], matchedTiers: []
          };
        }

        const bounds = sliderBounds(slider);
        if (!bounds) return { status: 'unavailable', reason: 'slider_range_not_readable', tier: null, requestedTier: tier, actualLabel: null, supportedTiers: [], matchedTiers: [] };
        const target = bounds.stops.find(stop => stop.tier === tier);
        const supportedTiers = bounds.stops.map(stop => stop.tier);
        if (!getTierDiscoveryController().isEnabled(slider)) {
          return { status: 'unavailable', reason: 'slider_disabled', tier: null, requestedTier: tier, actualLabel: slider.getAttribute('aria-valuetext') || null, supportedTiers, matchedTiers: [] };
        }
        if (!target) {
          return { status: 'unsupported', reason: 'tier_unavailable', tier: null, requestedTier: tier, actualLabel: null, supportedTiers, matchedTiers: [] };
        }
        const tolerance = Math.max(bounds.step / 2, (bounds.max - bounds.min) * 0.01);
        let sliderToVerify = slider;
        if (Math.abs(bounds.value - target.value) > tolerance) {
          if (slider instanceof HTMLInputElement && slider.type === 'range') {
            dispatchRangeInput(slider, target.value);
          } else if (slider.matches('[role="slider"]')) {
            sliderToVerify = await setAccessibleSliderValue(slider, target, bounds);
          }
          if (!sliderToVerify) {
            return { status: 'unavailable', reason: 'slider_not_writable', tier: null, requestedTier: tier, actualLabel: null, supportedTiers, matchedTiers: [] };
          }
        }
        // Let React or another UI framework process its input event and replace
        // the slider before reading back the value. Checking the mutated input
        // immediately can mistake a DOM-only change for an applied setting.
        await new Promise(resolve => setTimeout(resolve, 90));
        const verified = await getTierDomController().waitFor(() => {
          const current = findThinkingSlider();
          const value = sliderBounds(current)?.value;
          const labelTier = sliderLabelTier(current);
          return current && Math.abs(value - target.value) <= tolerance
            && sliderTier(current) === tier && (!labelTier || labelTier === tier) ? current : null;
        }, 1100, 50);
        if (!verified) return { status: 'error', reason: 'verification_failed', tier: null, requestedTier: tier, actualLabel: null, supportedTiers, matchedTiers: [] };
        const state = sliderState(verified);
        return { ...state, requestedTier: tier };
      } finally {
        if (openedByUs) getTierMenuController().closeMenuIfOpened(true);
      }
    }

    return {
      findThinkingSlider,
      findThinkingSliderTrigger,
      readThinkingSliderState,
      setThinkingSliderTier,
    };
  }

  runtime.factories.createTierSliderController = createTierSliderController;
})(globalThis.PanelizeContent);
