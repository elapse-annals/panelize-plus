(function(runtime) {
  'use strict';

  /**
   * Owns tier requests behavior and its page-local state.
   * Deferred controller getters keep composition in the entry point.
   */


  function createTierRequestsController({
    getTierConfigController,
    getTierDiscoveryController,
    getTierMenuController,
    getTierRecipesController,
    getTierSliderController
  }) {
    const inFlight = new Map();
    const completed = new Map();
    let operationQueue = Promise.resolve();

    function responseFor(data, responseType, result) {
      const matchedTiers = Array.isArray(result.matchedTiers)
        ? result.matchedTiers.filter(tier => getTierConfigController().TIER_IDS.includes(tier))
        : result.status === 'success' && getTierConfigController().TIER_IDS.includes(result.tier) ? [result.tier] : [];
      return {
        type: responseType,
        requestId: data.requestId,
        context: 'multi-panel',
        provider: getTierConfigController().provider,
        tier: result.tier ?? null,
        requestedTier: result.requestedTier ?? (data.type === 'SET_PROVIDER_TIER' ? data.tier : null),
        actualLabel: result.actualLabel ?? null,
        supportedTiers: Array.isArray(result.supportedTiers) ? result.supportedTiers.filter(tier => getTierConfigController().TIER_IDS.includes(tier)) : [],
        matchedTiers,
        status: result.status,
        ...(result.reason ? { reason: result.reason } : {})
      };
    }

    function postResponse(message) {
      if (!getTierConfigController().extensionOrigin || window.parent === window) return;
      try {
        window.parent.postMessage(message, getTierConfigController().extensionOrigin);
      } catch {
        // A navigation may have replaced the extension host while the request ran.
      }
    }

    async function processRequest(data) {
      if (!getTierConfigController().provider || !getTierConfigController().config || getTierConfigController().config.strategy === 'unsupported') {
        return { status: 'unsupported', reason: 'provider_not_supported', tier: null, requestedTier: data.tier || null, actualLabel: null, supportedTiers: [] };
      }
      if (getTierConfigController().config.strategy === 'recipe' || (getTierConfigController().config.acceptsRecipes && data.recipes)) return getTierRecipesController().processRecipeRequest(data);
      if (getTierConfigController().provider === 'chatgpt') {
        const slider = getTierSliderController().findThinkingSlider();
        const sliderTrigger = getTierSliderController().findThinkingSliderTrigger();
        if (data.type === 'GET_PROVIDER_TIER_STATE') {
          const state = await getTierSliderController().readThinkingSliderState({ openIfNeeded: true });
          if (state?.reason === 'slider_not_visible') return getTierDiscoveryController().readCurrentState();
          if (state) return state;
        } else if (slider || sliderTrigger) {
          const result = await getTierSliderController().setThinkingSliderTier(data.tier);
          if (result.reason !== 'slider_not_visible') return result;
          return getTierMenuController().setMenuTier(data.tier);
        }
      }
      if (data.type === 'SET_PROVIDER_TIER' && getTierDiscoveryController().getToggle()) return getTierMenuController().setToggleTier(data.tier);
      if (data.type === 'GET_PROVIDER_TIER_STATE') return getTierDiscoveryController().readCurrentState();
      return getTierMenuController().setMenuTier(data.tier);
    }

    function isValidHostMessage(event, data) {
      if (!getTierConfigController().extensionOrigin || window.parent === window) return false;
      if (event.source !== window.parent || event.origin !== getTierConfigController().extensionOrigin) return false;
      if (!data || data.context !== 'multi-panel' || !getTierConfigController().REQUESTS[data.type]) return false;
      if (typeof data.requestId !== 'string' || data.requestId.length < 1 || data.requestId.length > 160) return false;
      if (data.provider && data.provider !== getTierConfigController().provider) return false;
      if (data.type === 'SET_PROVIDER_TIER' && !getTierConfigController().TIER_IDS.includes(data.tier)) return false;
      return true;
    }

    function onMessage(event) {
      const data = event.data;
      if (!isValidHostMessage(event, data)) return;
      const responseType = getTierConfigController().REQUESTS[data.type];
      const key = `${data.type}:${data.requestId}`;
      if (completed.has(key)) {
        postResponse(completed.get(key));
        return;
      }
      if (inFlight.has(key)) return;

      const task = operationQueue.then(() => processRequest(data)).catch(() => ({
        status: 'error', reason: 'operation_failed', tier: data.tier || null, actualLabel: null, supportedTiers: []
      }));
      operationQueue = task.then(() => undefined, () => undefined);
      inFlight.set(key, task);
      task.then(result => {
        const message = responseFor(data, responseType, result);
        completed.set(key, message);
        if (completed.size > 100) completed.delete(completed.keys().next().value);
        postResponse(message);
      }).finally(() => inFlight.delete(key));
    }

    return {
      onMessage,
    };
  }

  runtime.factories.createTierRequestsController = createTierRequestsController;
})(globalThis.PanelizeContent);
