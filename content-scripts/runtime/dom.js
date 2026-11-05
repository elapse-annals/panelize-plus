(function(runtime) {
  'use strict';

  /**
   * Owns dom behavior and its page-local state.
   * Deferred controller getters keep composition in the entry point.
   */


  function createDomController() {
    function isVisibleElement(element) {
      if (!element || element.offsetParent === null || element.getAttribute('aria-hidden') === 'true') {
        return false;
      }

      const rect = typeof element.getBoundingClientRect === 'function'
        ? element.getBoundingClientRect()
        : null;

      if (!rect) {
        return true;
      }

      if (rect.width === 0 && rect.height === 0) {
        return element.offsetParent !== null;
      }

      const viewportWidth = window.innerWidth || document.documentElement?.clientWidth || Number.POSITIVE_INFINITY;
      const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || Number.POSITIVE_INFINITY;

      return Boolean(
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < viewportHeight &&
        rect.left < viewportWidth
      );
    }

    function findFirstVisibleElement(selectors, accept = null) {
      for (const selector of selectors) {
        try {
          const elements = document.querySelectorAll(selector);
          for (const element of elements) {
            if (isVisibleElement(element) && (!accept || accept(element))) {
              return element;
            }
          }
        } catch (error) {
          console.warn('[Text Injection] Error finding visible element with selector:', selector, error);
        }
      }

      return null;
    }

    function getElementAccessibleText(element) {
      return [
        element?.getAttribute?.('aria-label') || '',
        element?.getAttribute?.('title') || '',
        element?.textContent || ''
      ]
        .join(' ')
        .trim()
        .toLowerCase();
    }

    function findDeepFirstVisibleElement(selectors, accept = null) {
      for (const selector of selectors) {
        try {
          const elements = querySelectorAllDeep(selector);
          for (const element of elements) {
            if (isVisibleElement(element) && (!accept || accept(element))) {
              return element;
            }
          }
        } catch (error) {
          console.warn('[Text Injection] Error finding deep visible element with selector:', selector, error);
        }
      }

      return null;
    }

    function findDeepClickableElementByKeywords(keywords) {
      const loweredKeywords = keywords.map(keyword => keyword.toLowerCase());
      const candidates = querySelectorAllDeep('button, [role="button"], [role="menuitem"], label');

      for (const candidate of candidates) {
        if (!isVisibleElement(candidate)) {
          continue;
        }

        const searchableText = getElementAccessibleText(candidate);
        if (loweredKeywords.some(keyword => searchableText.includes(keyword))) {
          return candidate;
        }
      }

      return null;
    }

    function setFormControlValue(element, value) {
      const prototype = element.tagName === 'INPUT'
        ? window.HTMLInputElement.prototype
        : window.HTMLTextAreaElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

      if (nativeSetter) {
        nativeSetter.call(element, value);
      } else {
        element.value = value;
      }

      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));

      if (typeof element.value === 'string') {
        element.selectionStart = element.selectionEnd = element.value.length;
      }
    }

    function dispatchEditorKeyEvent(element, key, code, modifiers = {}) {
      element.dispatchEvent(new KeyboardEvent('keydown', {
        key,
        code,
        keyCode: key === 'Backspace' ? 8 : key === 'a' ? 65 : 13,
        which: key === 'Backspace' ? 8 : key === 'a' ? 65 : 13,
        ctrlKey: modifiers.ctrl || false,
        metaKey: modifiers.meta || false,
        shiftKey: modifiers.shift || false,
        altKey: modifiers.alt || false,
        bubbles: true,
        cancelable: true
      }));
    }

    function isElementEnabled(element) {
      return Boolean(
        element &&
        !element.disabled &&
        element.getAttribute('aria-disabled') !== 'true'
      );
    }

    function getElementHitTarget(element) {
      const rect = element?.getBoundingClientRect?.();
      if (!rect || (rect.width === 0 && rect.height === 0)) return null;
      const root = typeof element.getRootNode === 'function' ? element.getRootNode() : document;
      const hitRoot = typeof root?.elementFromPoint === 'function' ? root : document;
      return hitRoot.elementFromPoint?.(
        Math.round(rect.left + rect.width / 2),
        Math.round(rect.top + rect.height / 2)
      ) || null;
    }

    // A hit test that finds nothing (off-screen, or no layout) cannot prove the
    // element is covered, so only a hit on an unrelated element counts.
    function isElementUncovered(element) {
      const hit = getElementHitTarget(element);
      return !hit || element.contains(hit) || hit.contains(element);
    }

    function findClosestAncestorContaining(element, selector, maxDepth = 8) {
      let current = element;

      for (let depth = 0; current && depth <= maxDepth; depth++) {
        if (current === document.body || current === document.documentElement) {
          return null;
        }
        try {
          if (current.querySelector?.(selector)) {
            return current;
          }
        } catch (error) {
          console.warn('[Image Injection] Invalid scoped selector:', selector, error);
          return null;
        }
        current = current.parentElement;
      }

      return null;
    }

    function findVisibleElementByExactText(selector, expectedTexts) {
      const normalizedTexts = expectedTexts.map(text => text.trim().toLowerCase());

      for (const element of document.querySelectorAll(selector)) {
        const text = (element.textContent || '').trim().toLowerCase();
        if (normalizedTexts.includes(text) && isVisibleElement(element)) {
          return element;
        }
      }

      return null;
    }

    // Sleep utility
    function sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Shadow DOM query helper functions
    function querySelectorDeep(selector, root = document) {
      // Try to find in current root element
      const element = root.querySelector(selector);
      if (element) return element;
      
      // Recursively search all shadow DOM
      const allElements = root.querySelectorAll('*');
      for (const el of allElements) {
        if (el.shadowRoot) {
          const found = querySelectorDeep(selector, el.shadowRoot);
          if (found) return found;
        }
      }
      return null;
    }

    function querySelectorAllDeep(selector, root = document) {
      const elements = [...root.querySelectorAll(selector)];
      const allElements = root.querySelectorAll('*');
      for (const el of allElements) {
        if (el.shadowRoot) {
          elements.push(...querySelectorAllDeep(selector, el.shadowRoot));
        }
      }
      return elements;
    }

    return {
      dispatchEditorKeyEvent,
      findClosestAncestorContaining,
      findDeepClickableElementByKeywords,
      findDeepFirstVisibleElement,
      findFirstVisibleElement,
      findVisibleElementByExactText,
      getElementAccessibleText,
      getElementHitTarget,
      isElementEnabled,
      isElementUncovered,
      isVisibleElement,
      querySelectorAllDeep,
      querySelectorDeep,
      setFormControlValue,
      sleep,
    };
  }

  runtime.factories.createDomController = createDomController;
})(globalThis.PanelizeContent);
