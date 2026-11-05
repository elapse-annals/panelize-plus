(function(runtime) {
  'use strict';

  /**
   * Owns focus behavior and its page-local state.
   * Deferred controller getters keep composition in the entry point.
   */


  function createFocusController({
    getChatgptController,
    getConfigController,
    getProtocolController,
    getReportingController
  }) {
    let multiPanelUserInteractionTracking = null;

    // Element the user focused with the interaction reported to multi-panel,
    // in case the parent's focus restore took focus away before it heard back.
    let lastUserFocus = null;

    function rememberUserFocus() {
      const entry = { element: null, at: Date.now() };
      lastUserFocus = entry;
      // Focus moves after pointerdown, so capture the element it lands on.
      const captureFocus = (event) => {
        if (lastUserFocus === entry && !entry.element) {
          entry.element = event.target;
        }
      };
      document.addEventListener('focusin', captureFocus, { capture: true, once: true });
      setTimeout(() => document.removeEventListener('focusin', captureFocus, true), getConfigController().USER_FOCUS_RESTORE_WINDOW_MS);
    }

    function restoreUserFocus() {
      const entry = lastUserFocus;
      lastUserFocus = null;
      if (!entry?.element?.isConnected || Date.now() - entry.at > getConfigController().USER_FOCUS_RESTORE_WINDOW_MS) {
        return;
      }

      try {
        entry.element.focus({ preventScroll: true });
      } catch {
        entry.element.focus();
      }
    }

    function stopMultiPanelUserInteractionTracking() {
      const tracking = multiPanelUserInteractionTracking;
      if (!tracking) {
        return;
      }

      if (typeof tracking.timeoutId === 'number') {
        clearTimeout(tracking.timeoutId);
      }

      if (tracking.interactionHandler) {
        document.removeEventListener('pointerdown', tracking.interactionHandler, true);
        if (!tracking.pointerOnly) {
          document.removeEventListener('keydown', tracking.interactionHandler, true);
        }
      }

      multiPanelUserInteractionTracking = null;
    }

    let hostFocusGuard = null;

    function stopHostFocusGuard() {
      const guard = hostFocusGuard;
      if (!guard) {
        return;
      }
      hostFocusGuard = null;
      clearTimeout(guard.timeoutId);
      flushHostFocusGuardKeys(guard);
      window.removeEventListener('keydown', guard.keydownHandler, true);
      document.removeEventListener('pointerdown', guard.pointerHandler, true);
    }

    function flushHostFocusGuardKeys(guard) {
      clearTimeout(guard.flushId);
      guard.flushId = null;
      if (!guard.keys || window.parent === window) {
        return;
      }
      window.parent.postMessage({
        type: getProtocolController().PANELIZE_FORWARD_KEYS,
        requestId: guard.requestId,
        provider: guard.provider,
        keys: guard.keys,
        context: getProtocolController().MULTI_PANEL_PROVIDER_STATUS_CONTEXT
      }, '*');
      guard.keys = '';
    }

    // While the host's question box has focus and this page loads, the page may
    // autofocus its own input. Until the user clicks in this frame, keys that
    // land here belong to the host: they are sent back instead of typed here.
    // Enter is dropped so a stolen Enter can never send in this panel; IME
    // composition is left alone.
    function startHostFocusGuard(requestId, durationMs) {
      stopHostFocusGuard();
      const provider = getConfigController().detectProvider();
      if (!requestId || !provider) {
        return;
      }
      const guard = { requestId, provider, keys: '', flushId: null, timeoutId: null };
      guard.keydownHandler = (event) => {
        if (hostFocusGuard !== guard || !event.isTrusted || event.isComposing || event.keyCode === 229
          || event.ctrlKey || event.metaKey || event.altKey) {
          return;
        }
        let key;
        if (event.key === 'Backspace') key = '\b';
        else if (event.key === 'Enter') key = '';
        else if (typeof event.key === 'string' && event.key.length === 1) key = event.key;
        else return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!key) {
          return;
        }
        guard.keys += key;
        if (!guard.flushId) {
          guard.flushId = setTimeout(() => flushHostFocusGuardKeys(guard), 0);
        }
      };
      guard.pointerHandler = (event) => {
        if (hostFocusGuard !== guard || !event.isTrusted) {
          return;
        }
        stopHostFocusGuard();
        rememberUserFocus();
        getReportingController().postMultiPanelProviderStatus(getProtocolController().PANELIZE_PROVIDER_USER_INTERACTION, requestId, 'user-interaction', provider);
      };
      window.addEventListener('keydown', guard.keydownHandler, true);
      document.addEventListener('pointerdown', guard.pointerHandler, true);
      const duration = Math.min(Math.max(Number(durationMs) || 0, 0), getConfigController().FOCUS_GUARD_MAX_MS);
      guard.timeoutId = setTimeout(() => {
        if (hostFocusGuard === guard) stopHostFocusGuard();
      }, duration);
      hostFocusGuard = guard;
    }

    // pointerOnly ignores keys: while the host restores focus, keys that land
    // here only arrive because the page stole focus mid-typing.
    function startMultiPanelUserInteractionTracking(requestId, provider = getConfigController().detectProvider(), { pointerOnly = false } = {}) {
      if (!requestId || !provider) {
        return;
      }

      stopMultiPanelUserInteractionTracking();

      const tracking = {
        requestId,
        provider,
        pointerOnly,
        timeoutId: null,
        interactionHandler: null
      };

      tracking.interactionHandler = (event) => {
        if (multiPanelUserInteractionTracking !== tracking || !event.isTrusted) {
          return;
        }

        rememberUserFocus();
        getReportingController().postMultiPanelProviderStatus(
          getProtocolController().PANELIZE_PROVIDER_USER_INTERACTION,
          tracking.requestId,
          'user-interaction',
          tracking.provider
        );

        if (tracking.provider === 'chatgpt' && getChatgptController().chatgptSendTracking?.requestId === tracking.requestId) {
          getChatgptController().stopChatgptSendTracking();
        }

        stopMultiPanelUserInteractionTracking();
      };

      document.addEventListener('pointerdown', tracking.interactionHandler, true);
      if (!pointerOnly) {
        document.addEventListener('keydown', tracking.interactionHandler, true);
      }

      tracking.timeoutId = setTimeout(() => {
        if (multiPanelUserInteractionTracking !== tracking) {
          return;
        }

        stopMultiPanelUserInteractionTracking();
      }, getProtocolController().MULTI_PANEL_USER_INTERACTION_TRACKING_TIMEOUT_MS);

      multiPanelUserInteractionTracking = tracking;
    }

    return {
      get hostFocusGuard() { return hostFocusGuard; },
      restoreUserFocus,
      startHostFocusGuard,
      startMultiPanelUserInteractionTracking,
      stopHostFocusGuard,
      stopMultiPanelUserInteractionTracking,
    };
  }

  runtime.factories.createFocusController = createFocusController;
})(globalThis.PanelizeContent);
