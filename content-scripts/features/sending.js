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
    // Find and click send button
    function clickSendButton(provider, providerMode = null) {
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
      // keeps another form's Send (e.g. an inline edit) from being clicked.
      const searchRoot = provider === 'chatgpt'
        ? getChatgptController().getChatgptComposer()?.findForm() || document
        : document;

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

    async function clickSendButtonWhenReady(provider, providerMode = null) {
      const deadline = Date.now() + getConfigController().SEND_READY_TIMEOUT_MS;
      while (true) {
        if (clickSendButton(provider, providerMode)) {
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
