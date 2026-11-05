(function(runtime) {
  'use strict';

  /**
   * Owns composer behavior and its page-local state.
   * Deferred controller getters keep composition in the entry point.
   */


  function createComposerController({
    getChatgptController,
    getConfigController,
    getDomController,
    getGoogleController,
    getNewChatController,
    getSendingController
  }) {
    function clearRichTextInput(provider, element, { focus = true } = {}) {
      if (focus) {
        element.focus();
      }

      if (provider !== 'kimi' && provider !== 'doubao') {
        element.innerHTML = '';
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }

      // Slate-based composers need a focused selection to clear. When the host
      // is restoring focus to its own composer, fall back to the DOM reset so
      // clearing a panel never steals the caret.
      if (!focus) {
        element.innerHTML = '';
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }

      getDomController().dispatchEditorKeyEvent(element, 'a', 'KeyA', { ctrl: true, meta: true });
      document.execCommand('selectAll', false, null);

      setTimeout(() => {
        getDomController().dispatchEditorKeyEvent(element, 'Backspace', 'Backspace');
        document.execCommand('delete', false, null);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));

        const hasResidualContent = element.textContent.trim().length > 0 ||
          element.querySelector('img, figure, [data-slate-node], [data-slate-string], [data-slate-zero-width]');

        if (provider === 'doubao' && hasResidualContent) {
          element.innerHTML = '';
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, 10);
    }

    // Best-effort removal of composer attachments. Providers render previews in
    // different ways, so only an explicit remove/delete control inside a visible
    // preview is clicked; an unrecognized preview is left untouched.
    function removeProviderComposerAttachments(provider, composer) {
      const container = getNewChatController().getNewChatComposerContainer(provider, composer);
      if (!container) return 0;

      let removed = 0;
      try {
        container.querySelectorAll('input[type="file"]').forEach(input => {
          if (input.value) input.value = '';
        });

        const previews = [...container.querySelectorAll(getConfigController().NEW_CHAT_ATTACHMENT_PREVIEW_SELECTORS)]
          .filter(getDomController().isVisibleElement)
          .slice(0, 20);

        previews.forEach(preview => {
          const controls = preview.matches('button, [role="button"]')
            ? [preview]
            : [...preview.querySelectorAll('button, [role="button"]')];
          const control = controls.find(element => getDomController().isVisibleElement(element) &&
            getConfigController().COMPOSER_ATTACHMENT_REMOVE_LABEL.test(
              `${element.getAttribute('aria-label') || ''} ${element.getAttribute('title') || ''} ${element.textContent || ''}`
            ));
          if (!control) return;
          control.click();
          removed += 1;
        });
      } catch (error) {
        console.warn('[Text Injection] Could not clear composer attachments:', error);
      }
      return removed;
    }

    function clearProviderComposer(provider, providerMode, {
      focus = true,
      clearImages = false,
      onlyIfDirty = false
    } = {}) {
      if (!provider) return false;

      if (provider === 'google') {
        const input = getGoogleController().findGoogleInput(providerMode);
        if (!input) return false;
        if (onlyIfDirty && String(input.value || '').trim() === '') return false;
        return getGoogleController().clearGoogleInput(providerMode);
      }

      const element = findProviderInput(provider);
      if (!element) return false;

      const hasText = getNewChatController().getNewChatComposerText(element) !== '';
      const hasAttachments = clearImages && getNewChatController().hasNewChatComposerAttachments(provider, element);
      if (onlyIfDirty && !hasText && !hasAttachments) return false;

      const isTextarea = element.tagName === 'TEXTAREA' || element.tagName === 'INPUT';
      if (isTextarea) {
        getDomController().setFormControlValue(element, '');
      } else {
        clearRichTextInput(provider, element, { focus });
      }

      if (clearImages) {
        removeProviderComposerAttachments(provider, element);
      }
      return true;
    }

    function isProviderSendControlEnabled(provider, element) {
      if (!getDomController().isElementEnabled(element)) {
        return false;
      }

      if (provider === 'yuanbao') {
        return window.ButtonFinderUtils?.isYuanbaoSendControl(element) === true;
      }

      if (provider === 'mimo') {
        return window.ButtonFinderUtils?.isMimoSendIcon(element) === true;
      }

      return !element.classList.contains('disabled');
    }

    // Find text input element by selector
    function findTextInputElement(selector) {
      if (!selector || typeof selector !== 'string') {
        return null;
      }

      try {
        return document.querySelector(selector);
      } catch (error) {
        console.error('Error finding element:', error);
        return null;
      }
    }

    function getProviderInputSelectors(provider) {
      if (provider === 'chatgpt') {
        return getChatgptController().getChatgptComposer()?.EDITOR_SELECTORS || null;
      }
      return getConfigController().PROVIDER_SELECTORS[provider] || null;
    }

    function* findProviderInputs(provider) {
      if (provider === 'chatgpt') {
        yield getChatgptController().getChatgptComposer()?.findEditor() || null;
        return;
      }
      if (provider === 'mimo') {
        yield window.ButtonFinderUtils?.findMimoInput() || null;
        return;
      }
      if (provider === 'meta-ai') {
        yield getDomController().findFirstVisibleElement(getConfigController().PROVIDER_SELECTORS[provider]);
        return;
      }
      for (const selector of getConfigController().PROVIDER_SELECTORS[provider] || []) {
        yield findTextInputElement(selector);
      }
    }

    function findProviderInput(provider) {
      for (const element of findProviderInputs(provider)) {
        if (element) return element;
      }
      return null;
    }

    // Inject text into an element (textarea or contenteditable)
    function injectTextIntoElement(element, text, provider = null) {
      if (!element || !text || typeof text !== 'string' || text.trim() === '') {
        return false;
      }

      try {
        const isTextarea = element.tagName === 'TEXTAREA' || element.tagName === 'INPUT';
        const isContentEditable = element.isContentEditable || element.getAttribute('contenteditable') === 'true';

        if (!isTextarea && !isContentEditable) {
          console.warn('Element is not a textarea or contenteditable:', element);
          return false;
        }

        if (isTextarea) {
          // For textarea/input elements
          const currentValue = element.value || '';
          const newValue = currentValue + text;

          getDomController().setFormControlValue(element, newValue);
        } else {
          // For contenteditable elements - append text without clearing existing content
          element.focus();

          // Move cursor to end first
          try {
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(element);
            range.collapse(false); // Collapse to end
            selection.removeAllRanges();
            selection.addRange(range);
          } catch (e) {
            // Ignore selection errors in cross-origin context
          }

          if (provider === 'qwen-cn') {
            // Qwen China uses Slate's beforeinput handler as its source of truth.
            // A DOM-only insertion is visible but leaves the send control disabled.
            const beforeInputEvent = new InputEvent('beforeinput', {
              inputType: 'insertText',
              data: text,
              bubbles: true,
              cancelable: true,
              composed: true
            });

            if (!element.dispatchEvent(beforeInputEvent)) {
              return true;
            }
          }

          // Use execCommand insertText to append - works well with ProseMirror/Lexical/Quill
          let inserted = false;
          try {
            inserted = document.execCommand('insertText', false, text);
          } catch (e) {
            // execCommand not available in some contexts
          }

          if (!inserted) {
            // Fallback: manually append text node
            const textNode = document.createTextNode(text);
            element.appendChild(textNode);
            element.dispatchEvent(new Event('input', { bubbles: true }));
          }

          // Ensure cursor is at the end after insertion
          try {
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(element);
            range.collapse(false);
            selection.removeAllRanges();
            selection.addRange(range);
          } catch (e) {
            // Ignore selection errors in cross-origin context
          }
        }

        return true;
      } catch (error) {
        console.error('Error injecting text:', error);
        return false;
      }
    }

    // ===== Image Injection Functions =====

    // Helper function to inject text into provider's input field
    function inputEndsWithText(element, text) {
      const isFormControl = element?.tagName === 'TEXTAREA' || element?.tagName === 'INPUT';
      const currentText = isFormControl ? element.value : element?.textContent;
      return typeof currentText === 'string' && currentText.endsWith(text);
    }

    function injectText(
      provider,
      text,
      autoSubmit,
      providerMode = null,
      { skipIfAlreadyPresent = false, waitForSendReady = false } = {}
    ) {
      const scheduleSend = () => {
        const delay = getConfigController().SLOW_COMPOSER_PROVIDERS.has(provider) ? 800 : 500;
        setTimeout(() => {
          if (waitForSendReady) {
            getSendingController().clickSendButtonWhenReady(provider, providerMode);
          } else {
            getSendingController().clickSendButton(provider, providerMode);
          }
        }, delay);
      };

      if (provider === 'google') {
        const input = getGoogleController().findGoogleInput(providerMode);
        if (skipIfAlreadyPresent && inputEndsWithText(input, text)) {
          // A retry finds the text from the earlier fill; it still has to send.
          if (autoSubmit) {
            scheduleSend();
          }
          return true;
        }
        return getGoogleController().handleGoogleTextInjection(text, autoSubmit, providerMode);
      }

      if (!getProviderInputSelectors(provider)) {
        console.warn('[Text Injection] No selectors for provider:', provider);
        return false;
      }

      for (const element of findProviderInputs(provider)) {
        if (!element) continue;
        if (skipIfAlreadyPresent && inputEndsWithText(element, text)) {
          // A retry finds the text from the earlier fill; it still has to send.
          if (autoSubmit) {
            scheduleSend();
          }
          return true;
        }
        const success = injectTextIntoElement(element, text, provider);
        if (success) {
          console.log('[Text Injection] Text injected via injectText helper for', provider);
          if (autoSubmit) {
            // Use longer delay for providers whose composer state updates asynchronously
            scheduleSend();
          }
          return true;
        }
      }

      console.warn('[Text Injection] No input element found for provider:', provider);
      return false;
    }

    return {
      clearProviderComposer,
      findProviderInput,
      getProviderInputSelectors,
      injectText,
      injectTextIntoElement,
      isProviderSendControlEnabled,
    };
  }

  runtime.factories.createComposerController = createComposerController;
})(globalThis.PanelizeContent);
