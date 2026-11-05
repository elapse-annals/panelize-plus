(function(runtime) {
  'use strict';

  /**
   * Owns tier dom behavior and its page-local state.
   * Deferred controller getters keep composition in the entry point.
   */


  function createTierDomController({
    getTierConfigController
  }) {
    function normalize(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function getStyle(element) {
      try {
        return window.getComputedStyle(element);
      } catch {
        return null;
      }
    }

    function isVisible(element) {
      if (!(element instanceof Element) || !element.isConnected) return false;
      if (element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
      if (element.closest('[hidden], [aria-hidden="true"]')) return false;
      const style = getStyle(element);
      if (style && (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0')) return false;
      return Boolean(element.offsetParent || element.getClientRects?.().length || style?.position === 'fixed');
    }

    function elementLabel(element) {
      if (!element) return '';
      if (element instanceof HTMLInputElement) {
        const label = element.labels?.[0] || element.closest('label');
        if (label) return normalize(label.innerText || label.textContent);
      }
      const text = normalize(element.innerText || element.textContent);
      const accessible = normalize(element.getAttribute('aria-label')
        || element.getAttribute('title')
        || element.getAttribute('data-tooltip-content'));
      return text || accessible || normalize(element.getAttribute('data-testid'));
    }

    function isForbidden(element, label) {
      if (getTierConfigController().FORBIDDEN_LABEL.test(label)) return true;
      return Boolean(element.closest('form [type="submit"], [data-testid*="send"], [aria-label*="send" i], [aria-label*="agent" i]'));
    }

    function matchesAny(label, patterns = []) {
      const value = normalize(label);
      return Boolean(value) && patterns.some(pattern => {
        pattern.lastIndex = 0;
        return pattern.test(value);
      });
    }

    function hasLoginGate() {
      if (document.querySelector('[contenteditable="true"], [role="textbox"], textarea')) return false;
      if (document.querySelector('input[type="password"], [data-testid*="login" i], [data-testid*="sign-in" i]')) return true;
      const bodyText = normalize(document.body?.innerText || document.body?.textContent).slice(0, 5000);
      if (/sign in to continue|log in to continue|登录后继续|请先登录/i.test(bodyText)) return true;
      return Array.from(document.querySelectorAll('button, a, [role="button"]')).some(element => isVisible(element) && getTierConfigController().LOGIN_LABEL.test(elementLabel(element)));
    }

    async function waitFor(predicate, timeoutMs = 1400, intervalMs = 60) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() <= deadline) {
        const value = predicate();
        if (value) return value;
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      }
      return null;
    }

    return {
      elementLabel,
      hasLoginGate,
      isForbidden,
      isVisible,
      matchesAny,
      normalize,
      waitFor,
    };
  }

  runtime.factories.createTierDomController = createTierDomController;
})(globalThis.PanelizeContent);
