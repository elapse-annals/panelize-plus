(function(runtime) {
  'use strict';

  /**
   * Owns chatgpt behavior and its page-local state.
   * Deferred controller getters keep composition in the entry point.
   */


  function createChatgptController({
    getConfigController,
    getProtocolController,
    getReportingController,
    getUploadsController
  }) {
    let chatgptSendTracking = null;

    function findChatgptBusyButton() {
      return document.querySelector(getConfigController().CHATGPT_STOP_BUTTON_SELECTOR);
    }

    function isChatgptGenerating() {
      return Boolean(findChatgptBusyButton());
    }

    function nodeContainsChatgptBusyButton(node) {
      if (node?.nodeType !== Node.ELEMENT_NODE) {
        return false;
      }

      return node.matches(getConfigController().CHATGPT_STOP_BUTTON_SELECTOR)
        || Boolean(node.querySelector(getConfigController().CHATGPT_STOP_BUTTON_SELECTOR));
    }

    function hasChatgptBusyButtonMutation(records) {
      return records.some(record => {
        if (record.type === 'attributes') {
          return record.target.matches(getConfigController().CHATGPT_STOP_BUTTON_SELECTOR)
            || (record.attributeName === 'data-testid' && record.target.tagName === 'BUTTON');
        }

        if (record.type !== 'childList') {
          return false;
        }

        return [...record.addedNodes, ...record.removedNodes].some(nodeContainsChatgptBusyButton);
      });
    }

    function stopChatgptSendTracking({ reportIdle = false } = {}) {
      const tracking = chatgptSendTracking;
      if (!tracking) {
        return;
      }

      if (tracking.observer) {
        tracking.observer.disconnect();
      }

      if (typeof tracking.idleTimerId === 'number') {
        clearTimeout(tracking.idleTimerId);
      }

      if (typeof tracking.noBusyTimerId === 'number') {
        clearTimeout(tracking.noBusyTimerId);
      }

      const { requestId, phase } = tracking;
      chatgptSendTracking = null;

      if (reportIdle) {
        getReportingController().postMultiPanelProviderStatus(getProtocolController().PANELIZE_PROVIDER_IDLE, requestId, phase, 'chatgpt');
      }
    }

    function evaluateChatgptSendTrackingState() {
      const tracking = chatgptSendTracking;
      if (!tracking) {
        return;
      }

      if (findChatgptBusyButton()) {
        if (typeof tracking.noBusyTimerId === 'number') {
          clearTimeout(tracking.noBusyTimerId);
          tracking.noBusyTimerId = null;
        }

        if (typeof tracking.idleTimerId === 'number') {
          clearTimeout(tracking.idleTimerId);
          tracking.idleTimerId = null;
        }

        if (tracking.phase !== 'busy') {
          tracking.phase = 'busy';
          getReportingController().postMultiPanelProviderStatus(getProtocolController().PANELIZE_PROVIDER_BUSY, tracking.requestId, tracking.phase, 'chatgpt');
        }
        return;
      }

      if (tracking.phase !== 'busy' || typeof tracking.idleTimerId === 'number') {
        return;
      }

      tracking.idleTimerId = setTimeout(() => {
        const currentTracking = chatgptSendTracking;
        if (!currentTracking || currentTracking.requestId !== tracking.requestId) {
          return;
        }

        currentTracking.idleTimerId = null;
        if (findChatgptBusyButton()) {
          evaluateChatgptSendTrackingState();
          return;
        }

        currentTracking.phase = 'idle';
        stopChatgptSendTracking({ reportIdle: true });
      }, getConfigController().CHATGPT_SEND_TRACKING_IDLE_DELAY_MS);
    }

    function startChatgptSendTracking(requestId) {
      if (!requestId) {
        return;
      }

      stopChatgptSendTracking();

      const tracking = {
        requestId,
        phase: 'pending',
        observer: null,
        idleTimerId: null,
        noBusyTimerId: null
      };

      const observerTarget = document.body;
      if (observerTarget) {
        tracking.observer = new MutationObserver((records) => {
          if (chatgptSendTracking !== tracking || !hasChatgptBusyButtonMutation(records)) {
            return;
          }

          if (typeof tracking.idleTimerId === 'number' && findChatgptBusyButton()) {
            clearTimeout(tracking.idleTimerId);
            tracking.idleTimerId = null;
          }

          evaluateChatgptSendTrackingState();
        });

        tracking.observer.observe(observerTarget, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['data-testid']
        });
      }

      tracking.noBusyTimerId = setTimeout(() => {
        if (chatgptSendTracking !== tracking || tracking.phase !== 'pending') {
          return;
        }

        stopChatgptSendTracking();
      }, getConfigController().CHATGPT_SEND_TRACKING_NO_BUSY_TIMEOUT_MS);

      chatgptSendTracking = tracking;
      evaluateChatgptSendTrackingState();
    }

    function getChatgptComposer() {
      const composer = window.PanelizeChatgptComposer;
      if (!composer) {
        console.warn('[Text Injection] ChatGPT composer lookup missing; chatgpt-composer.js did not load');
        return null;
      }
      return composer;
    }

    // ChatGPT-specific image injection
    async function injectImageToChatGPT(imageData) {
      try {
        // ChatGPT: find and use file input directly
        const fileInput = document.querySelector('input[type="file"]');
        if (fileInput) {
          const blob = await getUploadsController().dataUrlToBlob(imageData.dataUrl);
          const file = new File([blob], imageData.name, { type: imageData.type });
          const dataTransfer = new DataTransfer();
          dataTransfer.items.add(file);
          fileInput.files = dataTransfer.files;
          fileInput.dispatchEvent(new Event('change', { bubbles: true }));
          console.log('[Image Injection] ChatGPT: File input triggered');
          return true;
        }
        console.warn('[Image Injection] ChatGPT: No file input found');
        return false;
      } catch (error) {
        console.error('[Image Injection] ChatGPT error:', error);
        return false;
      }
    }

    return {
      get chatgptSendTracking() { return chatgptSendTracking; },
      getChatgptComposer,
      injectImageToChatGPT,
      isChatgptGenerating,
      startChatgptSendTracking,
      stopChatgptSendTracking,
    };
  }

  runtime.factories.createChatgptController = createChatgptController;
})(globalThis.PanelizeContent);
