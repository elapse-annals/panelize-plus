(function(runtime) {
  'use strict';

  /**
   * Owns sending behavior and its page-local state.
   * Deferred controller getters keep composition in the entry point.
   */


  function createSendingController({
    getChatgptController,
    getComposerController,
    getConfigController,
    getDomController,
    getGoogleController
  }) {
    const CHATGPT_SEND_LABELS = ['send', '发送', '送信', 'отправить', 'enviar', 'envoyer', 'senden', 'invia', '보내기'];

    function getButtonLabel(element) {
      return `${element?.getAttribute?.('data-testid') || ''} ${element?.getAttribute?.('aria-label') || ''} ${element?.textContent || ''}`
        .toLowerCase();
    }

    function isChatgptStopControl(element) {
      if (!element?.matches) {
        return false;
      }
      if (element.matches(getConfigController().CHATGPT_STOP_BUTTON_SELECTOR)) {
        return true;
      }
      return /stop|停止|中止/.test(getButtonLabel(element));
    }

    // The composer sits at the bottom of a scrollable conversation, so a send
    // control outside the current viewport is still the right one. Reject only
    // controls that are detached, display/visibility hidden, or zero-sized.
    function isChatgptSendControlVisible(element) {
      if (!element?.isConnected || element.offsetParent === null
        || element.getAttribute('aria-hidden') === 'true'
        || element.closest('[aria-hidden="true"]')) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        // happy-dom reports no layout (offsetParent undefined) with empty rects.
        return element.offsetParent !== null;
      }
      try {
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          return false;
        }
      } catch {
        // Older DOM implementations may not expose computed styles.
      }
      return true;
    }

    // Last resort inside the composer form: the thread composer has appeared
    // with a localized aria-label and no test id the explicit selectors know.
    function findChatgptSendControl(root) {
      if (!root || typeof root.querySelectorAll !== 'function') {
        return null;
      }
      const candidates = [...root.querySelectorAll('button')]
        .filter(button => !isChatgptStopControl(button)
          && getComposerController().isProviderSendControlEnabled('chatgpt', button)
          && isChatgptSendControlVisible(button));

      const byTestId = candidates.find(button => (button.getAttribute('data-testid') || '').toLowerCase().includes('send'));
      if (byTestId) {
        return byTestId;
      }
      return candidates.find(button => CHATGPT_SEND_LABELS.some(label => getButtonLabel(button).includes(label))) || null;
    }

    // Find and click send button
    function clickSendButton(provider, providerMode = null, { editor = null } = {}) {
      if (provider === 'google') {
        return getGoogleController().clickGoogleSendButton(providerMode);
      }

      if (provider === 'doubao' && window.ButtonFinderUtils?.findButton) {
        const sendButton = window.ButtonFinderUtils.findButton([
          { type: 'css', value: '#flow-end-msg-send' },
          { type: 'css', value: 'button[type="submit"]' },
          { type: 'aria', textKey: 'send' },
          { type: 'text', textKey: 'send' }
        ]);

        if (sendButton && getDomController().isElementEnabled(sendButton)) {
          sendButton.click();
          return true;
        }
      }

      const selectors = getConfigController().SEND_BUTTON_SELECTORS[provider];
      if (!selectors) {
        console.warn('[Text Injection] No send button selectors for provider:', provider);
        return false;
      }

      console.log('[Text Injection] Attempting to click send button for provider:', provider);

      // ChatGPT's send button lives in the composer's form; searching only there
      // keeps another form's Send (e.g. an inline edit) from being clicked. The
      // editor captured at injection time is preferred so a re-rendered composer
      // cannot move the click into a different form.
      let chatgptEditor = null;
      let searchRoot = document;
      if (provider === 'chatgpt') {
        const composer = getChatgptController().getChatgptComposer();
        chatgptEditor = editor?.isConnected ? editor : composer?.findVisibleEditor?.() || null;
        if (!chatgptEditor || (composer?.isVisibleEditor && !composer.isVisibleEditor(chatgptEditor))) {
          console.warn('[Text Injection] No visible ChatGPT composer for send');
          return false;
        }
        searchRoot = chatgptEditor.closest('form');
        if (!searchRoot) {
          console.warn('[Text Injection] ChatGPT composer has no form for send');
          return false;
        }
      }

      // Try each selector
      for (const selector of selectors) {
        try {
          const elements = searchRoot.querySelectorAll(selector);
          console.log(`[Text Injection] Found ${elements.length} elements with selector:`, selector);

          for (const element of elements) {
            // Handle SVG elements - try to find parent button
            let targetElement = element;
            if (element.tagName === 'svg' || element.tagName === 'SVG') {
              // Look for parent button or clickable container
              let parent = element.parentElement;
              while (parent && parent !== document.body) {
                if (parent.tagName === 'BUTTON' ||
                    parent.role === 'button' ||
                    parent.classList.contains('send-button-container') ||
                    parent.onclick ||
                    parent.getAttribute('role') === 'button') {
                  targetElement = parent;
                  break;
                }
                parent = parent.parentElement;
              }
            }

            if (provider === 'chatgpt') {
              if (isChatgptStopControl(targetElement)) {
                console.log('[Text Injection] Skipping ChatGPT stop control:', selector);
                continue;
              }
              if (!isChatgptSendControlVisible(targetElement)) {
                console.log('[Text Injection] ChatGPT control is not visible:', selector);
                continue;
              }
            }

            // Check if element or its parent is disabled
            if (getComposerController().isProviderSendControlEnabled(provider, targetElement)) {
              console.log('[Text Injection] Clicking send button:', selector, targetElement);
              if (provider === 'chatglm') {
                // ChatGLM submits from its mousedown handler; HTMLElement.click() skips it.
                targetElement.dispatchEvent(new MouseEvent('mousedown', {
                  bubbles: true,
                  cancelable: true,
                  view: window,
                  button: 0,
                  buttons: 1
                }));
              } else {
                targetElement.click();
              }
              return true;
            } else {
              console.log('[Text Injection] Button found but disabled:', selector);
            }
          }
        } catch (error) {
          console.warn('[Text Injection] Error finding button with selector:', selector, error);
        }
      }

      if (provider === 'chatgpt' && chatgptEditor) {
        const fallback = findChatgptSendControl(searchRoot);
        if (fallback) {
          console.log('[Text Injection] Clicking ChatGPT send fallback:', fallback);
          fallback.click();
          return true;
        }
      }

      // Special handling for DeepSeek - trigger Enter key if button not found
      if (provider === 'deepseek') {
        console.log('[Text Injection] DeepSeek send button not found, trying Enter key');
        try {
          const inputSelectors = getConfigController().PROVIDER_SELECTORS.deepseek;
          for (const selector of inputSelectors) {
            const input = document.querySelector(selector);
            if (input) {
              console.log('[Text Injection] Triggering Enter key on DeepSeek input');
              // Trigger multiple events for better compatibility
              const events = [
                new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }),
                new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }),
                new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true })
              ];

              events.forEach(event => input.dispatchEvent(event));
              return true;
            }
          }
        } catch (error) {
          console.warn('[Text Injection] Error in DeepSeek Enter key fallback:', error);
        }
      }

      // Special handling for providers that can fall back to Enter on the editor
      if (
        provider === 'kimi' ||
        provider === 'doubao' ||
        provider === 'qwen-cn' ||
        provider === 'qwen-global' ||
        provider === 'chatglm' ||
        provider === 'zai-global'
      ) {
        console.log('[Text Injection] Provider send button not found, trying Enter key on input:', provider);
        try {
          const inputSelectors = getConfigController().PROVIDER_SELECTORS[provider];
          for (const selector of inputSelectors) {
            const input = document.querySelector(selector);
            if (input) {
              console.log('[Text Injection] Triggering Enter key on provider input:', provider);
              // Focus first
              input.focus();
              // Trigger multiple events for better compatibility
              const events = [
                new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }),
                new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }),
                new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true })
              ];

              events.forEach(event => input.dispatchEvent(event));
              return true;
            }
          }
        } catch (error) {
          console.warn('[Text Injection] Error in provider Enter key fallback:', provider, error);
        }
      }

      console.warn('[Text Injection] Send button not found or disabled for:', provider);
      console.warn('[Text Injection] Available buttons:', document.querySelectorAll('button'));
      return false;
    }

    async function clickSendButtonWhenReady(provider, providerMode = null, options = {}) {
      const deadline = Date.now() + getConfigController().SEND_READY_TIMEOUT_MS;
      while (true) {
        if (clickSendButton(provider, providerMode, options)) {
          return true;
        }
        if (Date.now() >= deadline) {
          console.warn('[Text Injection] Send button did not become ready for', provider);
          return false;
        }
        await getDomController().sleep(getConfigController().SEND_READY_POLL_MS);
      }
    }

    return {
      clickSendButton,
      clickSendButtonWhenReady,
    };
  }

  runtime.factories.createSendingController = createSendingController;
})(globalThis.PanelizeContent);
