(function(runtime) {
  'use strict';

  /**
   * Owns security behavior and its page-local state.
   * Deferred controller getters keep composition in the entry point.
   */


  function createSecurityController() {
    const MULTI_PANEL_EXTENSION_ORIGIN = getExtensionOrigin();

    function getExtensionOrigin() {
      try {
        const url = new URL(chrome.runtime.getURL('/'));
        if (!['chrome-extension:', 'moz-extension:', 'safari-web-extension:'].includes(url.protocol)) {
          return null;
        }
        return url.origin === 'null' ? `${url.protocol}//${url.host}` : url.origin;
      } catch (error) {
        return null;
      }
    }

    function isTrustedNewChatHostMessage(event, data) {
      return Boolean(
        MULTI_PANEL_EXTENSION_ORIGIN &&
        window.parent !== window &&
        event?.source === window.parent &&
        event?.origin === MULTI_PANEL_EXTENSION_ORIGIN &&
        data &&
        data.context === 'multi-panel' &&
        ['NEW_CHAT', 'VERIFY_NEW_CHAT'].includes(data.type) &&
        typeof data.requestId === 'string' &&
        data.requestId.length > 0 &&
        data.requestId.length <= 160
      );
    }

    return {
      get MULTI_PANEL_EXTENSION_ORIGIN() { return MULTI_PANEL_EXTENSION_ORIGIN; },
      isTrustedNewChatHostMessage,
    };
  }

  runtime.factories.createSecurityController = createSecurityController;
})(globalThis.PanelizeContent);
