(function(runtime) {
  'use strict';

  /**
   * Owns readiness behavior and its page-local state.
   * Deferred controller getters keep composition in the entry point.
   */


  function createReadinessController({
    getComposerController,
    getConfigController,
    getDomController,
    getProtocolController,
    getReportingController
  }) {
    function findReadyComposer(provider) {
      if (provider === 'google') {
        return getDomController().findFirstVisibleElement([...getConfigController().GOOGLE_AI_INPUT_SELECTORS, ...getConfigController().GOOGLE_SEARCH_INPUT_SELECTORS]);
      }
      return getComposerController().findProviderInput(provider);
    }

    // Tells Multi-Panel once this page's question box exists, so sending can
    // wait until every AI is able to take the question.
    function setupComposerReadyReporting() {
      if (!getReportingController().isMultiPanelFrame()) {
        return;
      }
      let timer = null;
      let giveUpTimer = null;
      let done = false;
      let observer = null;

      const stop = () => {
        done = true;
        clearTimeout(timer);
        clearTimeout(giveUpTimer);
        timer = null;
        observer?.disconnect();
      };

      const check = () => {
        timer = null;
        if (done) return;
        const provider = getConfigController().detectProvider();
        if (!provider || !findReadyComposer(provider)) return;
        stop();
        window.parent.postMessage({
          type: getProtocolController().PANELIZE_COMPOSER_READY,
          provider,
          context: getProtocolController().MULTI_PANEL_PROVIDER_STATUS_CONTEXT
        }, '*');
      };

      const schedule = () => {
        if (!done && timer === null) {
          timer = setTimeout(check, getConfigController().COMPOSER_READY_CHECK_THROTTLE_MS);
        }
      };

      giveUpTimer = setTimeout(stop, getConfigController().COMPOSER_READY_MAX_WAIT_MS);
      window.addEventListener('pagehide', stop, { once: true });
      check();
      if (done) return;
      observer = new MutationObserver(schedule);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style']
      });
    }

    return {
      setupComposerReadyReporting,
    };
  }

  runtime.factories.createReadinessController = createReadinessController;
})(globalThis.PanelizeContent);
