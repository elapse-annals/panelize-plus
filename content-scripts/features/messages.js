(function(runtime) {
  'use strict';

  /**
   * Owns messages behavior and its page-local state.
   * Deferred controller getters keep composition in the entry point.
   */


  function createMessagesController({
    getAnswersController,
    getChatgptController,
    getComposerController,
    getConfigController,
    getFocusController,
    getGoogleController,
    getNewChatController,
    getProtocolController,
    getReportingController,
    getSecurityController,
    getSendingController,
    getSnapshotSessionController,
    getUploadsController
  }) {
    let pendingChatgptTextSend = null;

    function sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    function normalizeComposerText(value) {
      return String(value || '').replace(/\u200b/g, '').replace(/\s+/g, ' ').trim();
    }

    function stripComposerWhitespace(value) {
      return String(value || '').replace(/\u200b/g, '').replace(/\s+/g, '');
    }

    // ProseMirror renders newlines as separate block elements, so textContent
    // can lose the whitespace that the prompt contains. Compare both the
    // normalized and the whitespace-free forms of innerText and textContent.
    function editorHasText(editor, text, { exact = false } = {}) {
      if (!text) {
        return false;
      }
      const normalizedNeedle = normalizeComposerText(text);
      const strippedNeedle = stripComposerWhitespace(text);
      const values = [editor?.textContent, editor?.innerText]
        .filter(value => typeof value === 'string');
      return values.some(value => {
        const normalized = normalizeComposerText(value);
        if (exact ? normalized === normalizedNeedle : normalized.includes(normalizedNeedle)) {
          return true;
        }
        const stripped = stripComposerWhitespace(value);
        return exact ? stripped === strippedNeedle : stripped.includes(strippedNeedle);
      });
    }

    function editorContainsText(editor, text) {
      return editorHasText(editor, text);
    }

    function editorContainsExactly(editor, text) {
      return editorHasText(editor, text, { exact: true });
    }

    function findVisibleChatgptEditor() {
      return getChatgptController().getChatgptComposer()?.findVisibleEditor?.() || null;
    }

    // A newer Send All supersedes a queued one. Only clear text that is exactly
    // the old prompt, so a draft the user typed is never discarded.
    function clearSupersededChatgptText(previous) {
      if (!previous?.text) {
        return;
      }
      const editor = findVisibleChatgptEditor();
      if (!editor?.isConnected || !editorContainsExactly(editor, previous.text)) {
        return;
      }
      editor.innerHTML = '';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      editor.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function cancelChatgptTextSend() {
      const pending = pendingChatgptTextSend;
      pendingChatgptTextSend = null;
      if (pending) {
        pending.cancelled = true;
      }
    }

    // ChatGPT cannot submit while it is still answering: its send button is
    // replaced by the stop button. Wait (bounded) for a visible composer and
    // for the answer to finish, then click exactly once. The prompt stays in
    // the composer while queued so it is visible and can be cancelled.
    async function runChatgptTextSend({ text, providerMode, requestId }) {
      const previous = pendingChatgptTextSend;
      cancelChatgptTextSend();
      clearSupersededChatgptText(previous);

      const state = { text, cancelled: false };
      pendingChatgptTextSend = state;

      const config = getConfigController();
      const composerDeadline = Date.now() + config.CHATGPT_COMPOSER_WAIT_TIMEOUT_MS;
      let editor = null;
      while (!state.cancelled) {
        editor = findVisibleChatgptEditor();
        if (editor || Date.now() >= composerDeadline) {
          break;
        }
        await sleep(100);
      }
      if (state.cancelled) {
        return;
      }
      if (!editor) {
        pendingChatgptTextSend = null;
        console.error('[Text Injection] ChatGPT has no visible composer to send into');
        return;
      }

      let injectedEditor = editor;
      let injectionAttempts = 0;
      const injectInto = (target) => {
        if (injectedEditor !== target) {
          injectedEditor = target;
          injectionAttempts = 0;
        }
        if (editorContainsText(target, text)) {
          return true;
        }
        if (injectionAttempts >= 2) {
          return false;
        }
        injectionAttempts += 1;
        const injected = getComposerController().injectTextIntoElement(target, text, 'chatgpt');
        return injected || editorContainsText(target, text);
      };

      if (!injectInto(editor)) {
        pendingChatgptTextSend = null;
        console.error('[Text Injection] ChatGPT text injection failed; send skipped');
        return;
      }
      console.log('[Text Injection] Text injected into', 'chatgpt');

      // Let the framework-managed composer state catch up before sending.
      await sleep(500);
      if (state.cancelled) {
        return;
      }

      const sendDeadline = Date.now() + config.CHATGPT_TEXT_SEND_TIMEOUT_MS;
      let clickedEditor = null;
      while (!state.cancelled && Date.now() < sendDeadline) {
        const current = findVisibleChatgptEditor();
        if (current && !editorContainsText(current, text) && !injectInto(current)) {
          await sleep(config.CHATGPT_TEXT_SEND_POLL_MS);
          continue;
        }
        if (!current || getChatgptController().isChatgptGenerating?.()) {
          await sleep(config.CHATGPT_TEXT_SEND_POLL_MS);
          continue;
        }
        if (getSendingController().clickSendButton('chatgpt', providerMode, { editor: current })) {
          clickedEditor = current;
          break;
        }
        await sleep(config.CHATGPT_TEXT_SEND_POLL_MS);
      }

      if (!clickedEditor) {
        pendingChatgptTextSend = null;
        if (!state.cancelled) {
          console.error('[Text Injection] ChatGPT send did not become ready; prompt kept in composer');
        }
        return;
      }

      pendingChatgptTextSend = null;
      if (requestId && getChatgptController().chatgptSendTracking?.requestId !== requestId) {
        getChatgptController().startChatgptSendTracking(requestId);
      }

      // A second click could duplicate the prompt; instead confirm the first
      // click took effect (composer cleared, stop button appeared, or the
      // composer was replaced by the thread view).
      const confirmDeadline = Date.now() + config.CHATGPT_SEND_CONFIRM_MS;
      while (!state.cancelled && Date.now() < confirmDeadline) {
        await sleep(100);
        const current = findVisibleChatgptEditor();
        const replaced = Boolean(current && current !== clickedEditor);
        const stillThere = clickedEditor.isConnected && editorContainsText(clickedEditor, text);
        if (replaced || !stillThere || getChatgptController().isChatgptGenerating?.()) {
          return;
        }
      }
      if (!state.cancelled) {
        console.warn('[Text Injection] ChatGPT send click was not confirmed; prompt left in composer');
      }
    }

    async function runChatgptTriggerSend({ providerMode, requestId }) {
      const config = getConfigController();
      const deadline = Date.now() + config.CHATGPT_TEXT_SEND_TIMEOUT_MS;
      while (Date.now() < deadline) {
        const editor = findVisibleChatgptEditor();
        if (editor && !getChatgptController().isChatgptGenerating?.()
          && getSendingController().clickSendButton('chatgpt', providerMode, { editor })) {
          if (requestId && getChatgptController().chatgptSendTracking?.requestId !== requestId) {
            getChatgptController().startChatgptSendTracking(requestId);
          }
          return;
        }
        await sleep(config.CHATGPT_TEXT_SEND_POLL_MS);
      }
      console.error('[Text Injection] ChatGPT trigger send did not become ready');
    }

    // Handle text injection message
    function handleTextInjection(event) {
      // Validate event data structure
      if (!event || !event.data || typeof event.data !== 'object') {
        return;
      }

      if (getSnapshotSessionController().handleSnapshotMessage(event)) {
        return;
      }

      if (event.data.type === getProtocolController().PANELIZE_RESTORE_USER_FOCUS && event.data.context === 'multi-panel') {
        getFocusController().restoreUserFocus();
        return;
      }

      if (event.data.type === getProtocolController().PANELIZE_GET_ANSWER_TEXT && event.data.context === 'multi-panel') {
        getAnswersController().handleAnswerTextRequest(event);
        return;
      }

      if (event.data.type === getProtocolController().PANELIZE_LOCATE_ANSWER_TEXT && event.data.context === 'multi-panel') {
        getAnswersController().handleLocateAnswerTextRequest(event);
        return;
      }

      if (event.data.type === getProtocolController().PANELIZE_FOCUS_GUARD && event.data.context === 'multi-panel') {
        if (event.source !== window.parent || window.parent === window) {
          return;
        }
        if (event.data.active) getFocusController().startHostFocusGuard(event.data.requestId, event.data.durationMs);
        else if (!event.data.requestId || getFocusController().hostFocusGuard?.requestId === event.data.requestId) getFocusController().stopHostFocusGuard();
        return;
      }

      // Handle CLEAR_INPUT messages
      if (event.data.type === 'CLEAR_INPUT' && event.data.context === 'multi-panel') {
        const provider = getConfigController().detectProvider();
        getFocusController().stopMultiPanelUserInteractionTracking();
        cancelChatgptTextSend();
        if (provider === 'chatgpt') {
          getChatgptController().stopChatgptSendTracking();
        }
        if (provider) {
          const providerMode = provider === 'google'
            ? getGoogleController().normalizeGoogleProviderMode(event.data.providerMode)
            : null;

          if (provider === 'google') {
            getComposerController().clearProviderComposer(provider, providerMode);
            console.log('[Text Injection] Input cleared for', provider, 'mode:', providerMode);
            return;
          }

          if (getComposerController().clearProviderComposer(provider, null, {
            clearImages: event.data.clearImages === true
          })) {
            console.log('[Text Injection] Input cleared for', provider);
          }
        }
        return;
      }

      // Handle TRIGGER_SEND messages (send without injecting text)
      if (event.data.type === 'TRIGGER_SEND' && event.data.context === 'multi-panel') {
        const provider = getConfigController().detectProvider();
        if (provider) {
          const providerMode = provider === 'google'
            ? getGoogleController().normalizeGoogleProviderMode(event.data.providerMode)
            : null;
          if (event.data.requestId) {
            getFocusController().startMultiPanelUserInteractionTracking(event.data.requestId, provider, { pointerOnly: true });
          } else {
            getFocusController().stopMultiPanelUserInteractionTracking();
          }
          if (provider === 'chatgpt' && event.data.requestId) {
            getChatgptController().startChatgptSendTracking(event.data.requestId);
          }
          getAnswersController().startResponseTiming(provider, event.data.requestId);
          getAnswersController().startAnswerEngagement(provider, event.data.requestId);
          console.log('[Text Injection] Triggering send for', provider);
          if (provider === 'chatgpt') {
            void runChatgptTriggerSend({ providerMode, requestId: event.data.requestId });
            return;
          }
          getSendingController().clickSendButton(provider, providerMode);
        }
        return;
      }

      // Verify a new-chat state after a host-driven reload. This path never
      // clicks a control; the host has already selected the destination URL.
      if (event.data.type === 'VERIFY_NEW_CHAT' && event.data.context === 'multi-panel') {
        if (!getSecurityController().isTrustedNewChatHostMessage(event, event.data)) return;
        const provider = getConfigController().detectProvider();
        // Lets the host stop its focus restore when the user clicks this panel.
        getFocusController().startMultiPanelUserInteractionTracking(event.data.requestId, provider, { pointerOnly: true });
        getNewChatController().submitNewChatRequest(event.data, provider, 'VERIFY_NEW_CHAT');
        return;
      }

      // Handle NEW_CHAT messages (create new chat)
      if (event.data.type === 'NEW_CHAT' && event.data.context === 'multi-panel') {
        if (event.data.requestId && !getSecurityController().isTrustedNewChatHostMessage(event, event.data)) return;
        const provider = getConfigController().detectProvider();
        if (event.data.requestId) {
          // Lets the host stop its focus restore when the user clicks this panel.
          getFocusController().startMultiPanelUserInteractionTracking(event.data.requestId, provider, { pointerOnly: true });
        } else {
          getFocusController().stopMultiPanelUserInteractionTracking();
        }
        if (provider === 'chatgpt') {
          cancelChatgptTextSend();
          getChatgptController().stopChatgptSendTracking();
        }
        getAnswersController().stopResponseTiming('cancelled');
        getAnswersController().startAnswerEngagement(null, null);
        const providerMode = provider === 'google'
          ? getGoogleController().normalizeGoogleProviderMode(event.data.providerMode)
          : null;
        console.log('[Text Injection] NEW_CHAT message received, provider:', provider);
        console.log('[Text Injection] Current URL:', window.location.href);
        if (provider) {
          console.log('[Text Injection] Creating new chat for', provider);
          if (event.data.requestId) {
            getNewChatController().submitNewChatRequest({ ...event.data, provider: event.data.provider || provider }, provider, 'NEW_CHAT');
          } else {
            getNewChatController().clickNewChatButton(provider, providerMode);
            getNewChatController().clearComposerAfterNewChat(provider, providerMode);
          }
        } else {
          console.warn('[Text Injection] Provider not detected for NEW_CHAT');
          if (event.data.requestId) {
            getNewChatController().submitNewChatRequest(event.data, provider, 'NEW_CHAT');
          }
        }
        return;
      }

      if (event.data.type === 'ENABLE_TEMP_CHAT' && event.data.context === 'multi-panel') {
        const provider = getConfigController().detectProvider();
        if (provider) {
          void getNewChatController().enableTemporaryChat(provider);
        }
        return;
      }

      // Handle INJECT_TEXT_WITH_IMAGES messages
      if (event.data.type === 'INJECT_TEXT_WITH_IMAGES' && event.data.context === 'multi-panel') {
        const provider = getConfigController().detectProvider();
        void getUploadsController().handleImageInjection(event)
          .then(result => {
            getReportingController().postMultiPanelActionResult(event.data.requestId, provider, result);
          })
          .catch(error => {
            console.error('[Image Injection] Unhandled fill error:', error);
            getReportingController().postMultiPanelActionResult(
              event.data.requestId,
              provider,
              getUploadsController().createImageInjectionFailure(getConfigController().IMAGE_INJECTION_REASONS.INJECTION_ERROR)
            );
          });
        return;
      }

      // Only handle INJECT_TEXT messages
      if (event.data.type !== 'INJECT_TEXT') {
        return;
      }

      // Validate text payload
      const text = event.data.text;
      if (!text || typeof text !== 'string' || text.length === 0) {
        console.warn('[Text Injection] Invalid text payload');
        return;
      }

      // Sanity check: reject extremely large payloads (> 1MB)
      if (text.length > 1048576) {
        console.error('[Text Injection] Text payload too large:', text.length, 'bytes');
        return;
      }

      const autoSubmit = event.data.autoSubmit === true;
      const context = event.data.context;

      // Security check: Only allow autoSubmit from multi-panel context
      // This prevents other contexts from accidentally auto-submitting when
      // multi-panel sends messages to its iframes
      const shouldAutoSubmit = autoSubmit && context === 'multi-panel';

      const provider = getConfigController().detectProvider();
      if (!provider) {
        console.warn('Unknown provider, cannot inject text');
        return;
      }

      const providerMode = provider === 'google'
        ? getGoogleController().normalizeGoogleProviderMode(event.data.providerMode)
        : null;

      if (event.data.requestId) {
        getFocusController().startMultiPanelUserInteractionTracking(event.data.requestId, provider, { pointerOnly: true });
      } else {
        getFocusController().stopMultiPanelUserInteractionTracking();
      }
      if (provider === 'chatgpt') {
        if (shouldAutoSubmit && event.data.requestId) {
          getChatgptController().startChatgptSendTracking(event.data.requestId);
        } else {
          getChatgptController().stopChatgptSendTracking();
        }
      }
      if (shouldAutoSubmit) {
        getAnswersController().startResponseTiming(provider, event.data.requestId);
        getAnswersController().startAnswerEngagement(provider, event.data.requestId);
      }

      if (provider === 'chatgpt' && shouldAutoSubmit) {
        void runChatgptTextSend({ text, providerMode, requestId: event.data.requestId });
        return;
      }

      if (provider === 'google') {
        const success = getGoogleController().handleGoogleTextInjection(text, shouldAutoSubmit, providerMode);
        if (success) {
          console.log('[Text Injection] Text injected into Google using mode:', providerMode);
          return;
        }

        console.warn('[Text Injection] Google editor not found on first try, retrying...');
        [500, 1000].forEach((delay, index, delays) => {
          setTimeout(() => {
            const retried = getGoogleController().handleGoogleTextInjection(text, shouldAutoSubmit, providerMode);
            if (!retried && index === delays.length - 1) {
              console.error('[Text Injection] Google editor not found after retries');
            }
          }, delay);
        });
        return;
      }

      if (!getComposerController().getProviderInputSelectors(provider)) {
        console.warn('No selectors configured for provider:', provider);
        return;
      }

      // Try each selector until we find an element
      const element = getComposerController().findProviderInput(provider);

      if (element) {
        const success = getComposerController().injectTextIntoElement(element, text, provider);
        if (success) {
          console.log('[Text Injection] Text injected into', provider);

          // Auto-submit if requested (only from multi-panel context)
          if (shouldAutoSubmit) {
            // Wait for framework-managed composer state to catch up before sending.
            const delay = getConfigController().SLOW_COMPOSER_PROVIDERS.has(provider) ? 800 : 500;
            setTimeout(() => {
              console.log('[Text Injection] Attempting to click send button for', provider);
              const clicked = getSendingController().clickSendButton(provider, providerMode);
              if (!clicked) {
                console.warn('[Text Injection] Failed to click send button for', provider);
              }
            }, delay);
          }
        } else {
          console.error(`[Text Injection] Failed to inject text into ${provider}`);
        }
      } else {
        console.warn(`[Text Injection] ${provider} editor not found on first try, retrying...`);
        // Retry after a short delay in case page is still loading
        // Use multiple retries for DeepSeek
        const retryDelays = provider === 'deepseek' ? [1000, 2000] : [1000];

        retryDelays.forEach((delay, index) => {
          setTimeout(() => {
            const retryElement = getComposerController().findProviderInput(provider);
            if (retryElement) {
              const success = getComposerController().injectTextIntoElement(retryElement, text, provider);
              if (success) {
                console.log('[Text Injection] Text injected on retry into', provider);
                if (shouldAutoSubmit) {
                  const submitDelay = getConfigController().SLOW_COMPOSER_PROVIDERS.has(provider) ? 800 : 500;
                  setTimeout(() => {
                    console.log('[Text Injection] Attempting to click send button for', provider, 'after retry');
                    getSendingController().clickSendButton(provider, providerMode);
                  }, submitDelay);
                }
              }
            } else if (index === retryDelays.length - 1) {
              console.error(`[Text Injection] ${provider} editor not found after ${retryDelays.length} retries`);
              console.error('[Text Injection] Available textareas:', document.querySelectorAll('textarea'));
              console.error('[Text Injection] Available contenteditable:', document.querySelectorAll('[contenteditable="true"]'));
            }
          }, delay);
        });
      }
    }

    return {
      handleTextInjection,
    };
  }

  runtime.factories.createMessagesController = createMessagesController;
})(globalThis.PanelizeContent);
