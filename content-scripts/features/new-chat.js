(function(runtime) {
  'use strict';

  /**
   * Owns new chat behavior and its page-local state.
   * Deferred controller getters keep composition in the entry point.
   */


  function createNewChatController({
    getChatgptController,
    getComposerController,
    getConfigController,
    getDeepseekController,
    getDomController,
    getDoubaoController,
    getGoogleController,
    getGrokController,
    getKimiController,
    getMimoController,
    getProtocolController,
    getReportingController,
    getSecurityController,
    getYuanbaoController
  }) {
    let yuanbaoTemporaryChatActivation = null;
    let yuanbaoTemporaryChatLastClickAt = -Infinity;
    const pendingNewChatRequests = new Map();

    function isTemporaryChatControlActive(element) {
      if (!element) {
        return false;
      }

      if (element.getAttribute('aria-pressed') === 'true' || element.getAttribute('aria-checked') === 'true') {
        return true;
      }

      const dataState = (element.dataset?.state || '').toLowerCase();
      if (dataState === 'active' || dataState === 'on' || dataState === 'checked' || dataState === 'selected') {
        return true;
      }

      const classTokens = element.classList
        ? [...element.classList].map(token => token.toLowerCase())
        : String(element.className || '')
          .toLowerCase()
          .split(/\s+/)
          .filter(Boolean);

      return ['active', 'selected', 'checked', 'toggled', 'enabled', 'on'].some(token => classTokens.includes(token));
    }

    function isGeminiTemporaryChatEnabled(control = null) {
      const button = control ||
        document.querySelector('button[data-test-id="temp-chat-button"]') ||
        document.querySelector('button[aria-label="Temporary chat"]');

      if (!button) {
        return false;
      }

      return button.classList.contains('temp-chat-on') || isTemporaryChatControlActive(button);
    }

    function isTemporaryChatAlreadyEnabled(provider, control = null) {
      const currentUrl = new URL(window.location.href);

      switch (provider) {
        case 'chatgpt':
          return currentUrl.searchParams.get('temporary-chat') === 'true';
        case 'claude':
          return currentUrl.searchParams.has('incognito');
        case 'grok':
          return currentUrl.hash === '#private' || isTemporaryChatControlActive(control);
        case 'gemini': {
          return isGeminiTemporaryChatEnabled(control);
        }
        case 'yuanbao':
          return (
            currentUrl.searchParams.get('chatMode') === 'temp' ||
            /^(Exit Temporary Chat|退出临时对话|退出臨時對話)$/
              .test(control?.getAttribute('aria-label') || '')
          );
        default:
          return false;
      }
    }

    function enableTemporaryChat(provider) {
      if (provider !== 'yuanbao') {
        return activateTemporaryChat(provider);
      }
      if (yuanbaoTemporaryChatActivation) {
        return yuanbaoTemporaryChatActivation;
      }

      const activation = activateTemporaryChat(provider);
      yuanbaoTemporaryChatActivation = activation;
      const clearActivation = () => {
        if (yuanbaoTemporaryChatActivation === activation) {
          yuanbaoTemporaryChatActivation = null;
        }
      };
      activation.then(clearActivation, clearActivation);
      return activation;
    }

    async function activateTemporaryChat(provider) {
      const selectors = getConfigController().TEMP_CHAT_BUTTON_SELECTORS[provider];
      if (!selectors || selectors.length === 0) {
        console.log('[Temporary Chat] Provider does not support temporary chat:', provider);
        return false;
      }

      if (isTemporaryChatAlreadyEnabled(provider)) {
        getReportingController().postTemporaryChatEnabled(provider);
        return true;
      }

      const deadline = Date.now() + getConfigController().TEMP_CHAT_POLL_TIMEOUT_MS;
      while (Date.now() <= deadline) {
        const button = getDomController().findDeepFirstVisibleElement(selectors) || getDomController().findFirstVisibleElement(selectors);
        if (isTemporaryChatAlreadyEnabled(provider, button)) {
          getReportingController().postTemporaryChatEnabled(provider);
          return true;
        }

        if (button && getDomController().isElementEnabled(button)) {
          if (
            provider === 'yuanbao' &&
            Date.now() - yuanbaoTemporaryChatLastClickAt < getConfigController().YUANBAO_TEMP_CHAT_CLICK_COOLDOWN_MS
          ) {
            await getDomController().sleep(getConfigController().TEMP_CHAT_POLL_INTERVAL_MS);
            continue;
          }
          if (provider === 'yuanbao') {
            // Parent retries for five seconds; never toggle this control twice in that cycle.
            yuanbaoTemporaryChatLastClickAt = Date.now();
          }
          button.click();
          if (provider !== 'yuanbao') {
            getReportingController().postTemporaryChatEnabled(provider);
            return true;
          }

          const confirmationDeadline = Date.now() + getConfigController().TEMP_CHAT_POLL_TIMEOUT_MS;
          while (Date.now() <= confirmationDeadline) {
            const currentControl = getDomController().findDeepFirstVisibleElement(selectors) ||
              getDomController().findFirstVisibleElement(selectors);
            if (isTemporaryChatAlreadyEnabled(provider, currentControl)) {
              getReportingController().postTemporaryChatEnabled(provider);
              return true;
            }
            await getDomController().sleep(getConfigController().TEMP_CHAT_POLL_INTERVAL_MS);
          }
          return false;
        }

        await getDomController().sleep(getConfigController().TEMP_CHAT_POLL_INTERVAL_MS);
      }

      console.log('[Temporary Chat] Temporary chat control not found for provider:', provider);
      return false;
    }

    // Links in chat content (e.g. Claude citations to news.sina.com.cn) can match
    // loose href selectors; a new-chat control never leaves the provider's origin.
    function isSameOriginNewChatCandidate(element) {
      const anchor = element.closest('a[href]');
      if (!anchor) {
        return true;
      }

      try {
        return new URL(anchor.getAttribute('href'), window.location.href).origin === window.location.origin;
      } catch (error) {
        return false;
      }
    }

    // Doubao and others name a fresh conversation "新对话", so a history link
    // with that title must not count as the new-chat control.
    function isRootNewChatLinkCandidate(element) {
      const anchor = element.closest('a[href]');
      if (!anchor) return true;
      try {
        return getConfigController().ROOT_NEW_CHAT_PATHS.has(new URL(anchor.getAttribute('href'), window.location.href).pathname);
      } catch (error) {
        return false;
      }
    }

    // Find and click new chat button
    function clickNewChatButton(provider, providerMode = null) {
      // Special handling for Google
      if (provider === 'google') {
        return getGoogleController().handleGoogleNewSearch(providerMode);
      }

      const selectors = getConfigController().NEW_CHAT_BUTTON_SELECTORS[provider];
      if (!selectors) {
        console.warn('[Text Injection] No new chat button selectors for provider:', provider);
        return false;
      }

      // In a narrow Doubao panel the sidebar is a drawer: its control may be
      // off-screen or under a mask. Only click a control the user could click;
      // otherwise load the new-chat URL instead of opening the drawer.
      const isDoubao = provider === 'doubao';
      const acceptCandidate = isDoubao
        ? element => isSameOriginNewChatCandidate(element) && !getDoubaoController().isDoubaoProjectControl(element) &&
          getDomController().isElementUncovered(element)
        : isSameOriginNewChatCandidate;

      // Try to find and click button
      const button = getDomController().findDeepFirstVisibleElement(selectors, acceptCandidate) ||
        getDomController().findFirstVisibleElement(selectors, acceptCandidate);
      if (button) {
        console.log('[Text Injection] Clicking new chat button via visible selector match');
        button.click();
        if (isDoubao) getDoubaoController().scheduleDoubaoOverlayCleanup();
        return true;
      }

      // Fallback: Try to find any link or button containing "new" text
      try {
        const allButtons = document.querySelectorAll('button, a, div[role="button"]');
        for (const elem of allButtons) {
          if (!isSameOriginNewChatCandidate(elem)) {
            continue;
          }
          if (isDoubao && (!getDomController().isVisibleElement(elem) || getDoubaoController().isDoubaoProjectControl(elem) || !getDomController().isElementUncovered(elem))) {
            continue;
          }

          const text = (elem.textContent || '').toLowerCase();
          const ariaLabel = (elem.getAttribute('aria-label') || '').toLowerCase();
          const href = elem.getAttribute('href') || '';

          if (text.includes('new chat') ||
            text.includes('new conversation') ||
            text.includes('start new') ||
            text.includes('新建会话') ||
            text.includes('新建对话') ||
            text.includes('开启新对话') ||
            ariaLabel.includes('new chat') ||
            ariaLabel.includes('new conversation') ||
            ariaLabel.includes('start new') ||
            ariaLabel.includes('新建会话') ||
            ariaLabel.includes('新建对话') ||
            // Exact match only: chat titles also read "新对话".
            ((text.trim() === '新对话' || ariaLabel.trim() === '新对话') && isRootNewChatLinkCandidate(elem)) ||
            (href === '/' && elem.closest('nav, aside'))) {
            console.log('[Text Injection] Found new chat button by text search');
            elem.click();
            if (isDoubao) getDoubaoController().scheduleDoubaoOverlayCleanup();
            return true;
          }
        }
      } catch (error) {
        console.warn('[Text Injection] Error in text-based button search:', error);
      }

      // Ultimate fallback: navigate to new chat URL
      const fallbackUrl = getConfigController().NEW_CHAT_URLS[provider];
      if (fallbackUrl) {
        console.log('[Text Injection] Using fallback URL for new chat:', fallbackUrl);
        if (fallbackUrl.startsWith('http')) {
          window.location.href = fallbackUrl;
        } else {
          window.location.href = window.location.origin + fallbackUrl;
        }
        return true;
      }

      console.warn('[Text Injection] New chat button not found for:', provider);
      return false;
    }

    function getPendingNewChatStorageKey(requestId, panelId = '') {
      return `${getConfigController().NEW_CHAT_PENDING_STORAGE_PREFIX}${encodeURIComponent(requestId)}:${encodeURIComponent(panelId)}`;
    }

    function getNewChatRequestMapKey(requestId, panelId = '') {
      return `${requestId}\u0000${panelId}`;
    }

    function writePendingNewChatRequest(data, provider, providerMode) {
      if (typeof data.requestId !== 'string' || data.requestId.length === 0) {
        return null;
      }

      const panelId = typeof data.panelId === 'string' ? data.panelId : '';
      const key = getPendingNewChatStorageKey(data.requestId, panelId);
      try {
        sessionStorage.setItem(key, JSON.stringify({
          requestId: data.requestId,
          provider,
          providerMode,
          panelId,
          createdAt: Date.now()
        }));
        return key;
      } catch (error) {
        console.warn('[New Chat] Could not persist navigation recovery state:', error);
        return null;
      }
    }

    function clearPendingNewChatRequest(key) {
      if (!key) return;
      try {
        sessionStorage.removeItem(key);
      } catch (error) {
        console.warn('[New Chat] Could not clear navigation recovery state:', error);
      }
    }

    function findPendingNewChatRequests() {
      const pending = [];
      const expiredKeys = [];
      try {
        for (let index = 0; index < sessionStorage.length; index += 1) {
          const key = sessionStorage.key(index);
          if (!key?.startsWith(getConfigController().NEW_CHAT_PENDING_STORAGE_PREFIX)) continue;
          try {
            const value = JSON.parse(sessionStorage.getItem(key) || 'null');
            if (!value || typeof value.requestId !== 'string' || typeof value.provider !== 'string') {
              expiredKeys.push(key);
            } else if (!Number.isFinite(value.createdAt) || Date.now() - value.createdAt > getConfigController().NEW_CHAT_PENDING_MAX_AGE_MS) {
              expiredKeys.push(key);
            } else {
              pending.push({ ...value, storageKey: key });
            }
          } catch (error) {
            expiredKeys.push(key);
          }
        }
        expiredKeys.forEach(clearPendingNewChatRequest);
      } catch (error) {
        console.warn('[New Chat] Could not inspect navigation recovery state:', error);
      }
      return pending;
    }

    function getNewChatComposer(provider, providerMode) {
      return provider === 'google'
        ? getGoogleController().findGoogleInput(providerMode)
        : getComposerController().findProviderInput(provider);
    }

    function getNewChatComposerContainer(provider, composer) {
      if (!composer) return null;

      let providerContainer = null;
      switch (provider) {
        case 'chatgpt':
          providerContainer = getChatgptController().getChatgptComposer()?.findForm?.(composer) || composer.closest('form');
          break;
        case 'grok':
          providerContainer = getGrokController().getGrokComposer();
          break;
        case 'deepseek':
          providerContainer = getDeepseekController().getDeepSeekComposer();
          break;
        case 'kimi':
          providerContainer = getKimiController().getKimiComposer();
          break;
        case 'yuanbao':
          providerContainer = getYuanbaoController().getYuanbaoComposer();
          break;
        case 'mimo':
          providerContainer = getMimoController().getMimoComposer();
          break;
        default:
          break;
      }

      if (providerContainer?.contains(composer)) return providerContainer;
      return composer.closest(
        'form, [data-testid*="composer"], [data-slot*="composer"], [class*="composer"], ' +
        '[id*="composer"], .chat-editor, #chat-box, [data-chat-input-layout="true"]'
      ) || getDomController().findClosestAncestorContaining(composer, 'input[type="file"]') || composer;
    }

    function hasNewChatComposerAttachments(provider, composer) {
      const container = getNewChatComposerContainer(provider, composer);
      if (!container) return false;

      const hasSelectedFiles = [...(container.querySelectorAll('input[type="file"]') || [])]
        .some(input => Number(input.files?.length) > 0);
      if (hasSelectedFiles) return true;

      try {
        return [...container.querySelectorAll(getConfigController().NEW_CHAT_ATTACHMENT_PREVIEW_SELECTORS)]
          .some(getDomController().isVisibleElement);
      } catch (error) {
        console.warn('[New Chat] Could not inspect composer attachments:', error);
        return true;
      }
    }

    function getNewChatComposerText(element) {
      if (!element) return '';
      if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
        return String(element.value || '').trim();
      }
      return String(element.innerText ?? element.textContent ?? '').trim();
    }

    function isNewChatComposerEmpty(provider, element) {
      if (!element || !getDomController().isVisibleElement(element) || getNewChatComposerText(element) !== '') {
        return false;
      }
      return !hasNewChatComposerAttachments(provider, element);
    }

    function countVisibleNewChatMessages(selector) {
      try {
        return [...document.querySelectorAll(selector)].filter(getDomController().isVisibleElement).length;
      } catch (error) {
        return 0;
      }
    }

    // Doubao can leave its sidebar drawer or a modal over the composer. A
    // composer the user cannot reach is not a ready new chat.
    function isNewChatComposerCovered(provider, composer) {
      if (provider !== 'doubao' || !composer || !getDomController().isVisibleElement(composer)) return false;
      const hit = getDomController().getElementHitTarget(composer);
      if (!hit) return false;
      const container = getNewChatComposerContainer(provider, composer) || composer;
      if (container.contains(hit) || hit.contains(composer)) return false;
      // A floating hint or toolbar over the composer is not a blocker; only a
      // detected drawer, mask or dialog is.
      return Boolean(getDoubaoController().findDoubaoOverlay());
    }

    function captureNewChatState(provider, providerMode) {
      const composer = getNewChatComposer(provider, providerMode);
      return {
        url: window.location.href,
        composerFound: Boolean(composer && getDomController().isVisibleElement(composer)),
        composerCovered: isNewChatComposerCovered(provider, composer),
        composerEmpty: isNewChatComposerEmpty(provider, composer),
        composerTextLength: getNewChatComposerText(composer).length,
        userMessageCount: countVisibleNewChatMessages(getConfigController().SNAPSHOT_USER_TURN_SELECTORS),
        assistantMessageCount: countVisibleNewChatMessages(getConfigController().NEW_CHAT_ASSISTANT_TURN_SELECTORS)
      };
    }

    function isCanonicalFreshNewChatUrl(provider, providerMode) {
      try {
        const currentUrl = new URL(window.location.href);
        if (provider === 'google') {
          return getGoogleController().normalizeGoogleProviderMode(providerMode) === getProtocolController().GOOGLE_PROVIDER_MODE_SEARCH
            ? currentUrl.pathname === '/'
            : currentUrl.pathname === '/search' && currentUrl.searchParams.get('udm') === '50'
              && !currentUrl.searchParams.get('q');
        }

        // Both entry URLs represent a fresh Gemini chat. Private Grok chats use
        // a dedicated entry route and must survive private-mode reactivation.
        if (provider === 'gemini' && currentUrl.pathname === '/') return true;
        // Qwen Global now keeps a fresh chat at its root; New Chat on a blank
        // root page leaves the URL and DOM unchanged.
        if (provider === 'qwen-global' && currentUrl.pathname === '/') return true;
        if (provider === 'grok' && currentUrl.pathname === '/c' && currentUrl.hash === '#private') return true;

        const expectedUrl = new URL(getConfigController().NEW_CHAT_URLS[provider]);
        const normalizePath = pathname => pathname.replace(/\/+$/, '') || '/';
        return normalizePath(currentUrl.pathname) === normalizePath(expectedUrl.pathname) &&
          (!expectedUrl.hash || currentUrl.hash === expectedUrl.hash);
      } catch (error) {
        return false;
      }
    }

    function isBlankConversation(state) {
      return Boolean(
        state &&
        state.composerFound &&
        !state.composerCovered &&
        state.composerEmpty &&
        state.userMessageCount === 0 &&
        state.assistantMessageCount === 0
      );
    }

    function isAlreadyFreshNewChatState(state, provider, providerMode) {
      return isBlankConversation(state) && isCanonicalFreshNewChatUrl(provider, providerMode);
    }

    function hasNewChatTransition(before, after) {
      return Boolean(
        before && after && (
          before.url !== after.url ||
          before.userMessageCount > after.userMessageCount ||
          before.assistantMessageCount > after.assistantMessageCount ||
          (before.composerTextLength > 0 && after.composerEmpty)
        )
      );
    }

    async function waitForNewChatState(provider, providerMode, {
      baseline = null,
      timeoutMs = getConfigController().NEW_CHAT_CONFIRMATION_TIMEOUT_MS,
      stableMs = getConfigController().NEW_CHAT_CLICK_STABLE_MS,
      requireTransition = Boolean(baseline),
      requireCanonicalFreshUrl = false
    } = {}) {
      const deadline = Date.now() + timeoutMs;
      let stableSince = null;
      let blockedSince = null;
      let dismissAttempts = 0;

      while (Date.now() <= deadline) {
        const state = captureNewChatState(provider, providerMode);
        if (state.composerCovered) {
          const overlay = getDoubaoController().findDoubaoOverlay();
          if (overlay?.blocking) {
            // A login or rate-limit prompt needs the user; never dismiss it.
            if (blockedSince === null) blockedSince = Date.now();
            if (Date.now() - blockedSince >= stableMs) {
              return { verified: false, failed: true, reason: 'provider-dialog-open' };
            }
          } else {
            blockedSince = null;
            // Each strategy gets one try; repeating them every poll would keep
            // clicking and sending Escape to the page.
            if (overlay && dismissAttempts < getConfigController().DOUBAO_MAX_DISMISS_ATTEMPTS) getDoubaoController().dismissDoubaoOverlay(overlay, dismissAttempts++);
          }
        } else {
          blockedSince = null;
        }

        const blankConversation = isBlankConversation(state);
        const transitioned = (!requireTransition || hasNewChatTransition(baseline, state))
          && (!requireCanonicalFreshUrl || isCanonicalFreshNewChatUrl(provider, providerMode));

        if (blankConversation && transitioned) {
          if (stableSince === null) stableSince = Date.now();
          if (Date.now() - stableSince >= stableMs) {
            return { verified: true };
          }
        } else {
          stableSince = null;
        }

        await getDomController().sleep(getConfigController().NEW_CHAT_CONFIRMATION_POLL_MS);
      }

      return { verified: false, reason: 'confirmation-timeout' };
    }

    function postNewChatResult({ requestId, provider, panelId, status, reason }) {
      if (!requestId) return;
      try {
        window.parent.postMessage({
          type: getProtocolController().PANELIZE_NEW_CHAT_RESULT,
          context: getProtocolController().MULTI_PANEL_NEW_CHAT_RESULT_CONTEXT,
          requestId,
          provider,
          ...(typeof panelId === 'string' ? { panelId } : {}),
          status,
          ...(reason ? { reason } : {})
        }, getSecurityController().MULTI_PANEL_EXTENSION_ORIGIN || '*');
      } catch (error) {
        console.warn('[New Chat] Could not report the result to the host:', error);
      }
    }

    function getNewChatResultIdentity(data, detectedProvider) {
      return {
        requestId: data.requestId,
        provider: typeof data.provider === 'string' ? data.provider : detectedProvider,
        panelId: typeof data.panelId === 'string' ? data.panelId : undefined
      };
    }

    function resolveNewChatRequest(data, detectedProvider) {
      const identity = getNewChatResultIdentity(data, detectedProvider);
      if (!detectedProvider) {
        return { identity, failure: { ...identity, status: 'failed', reason: 'provider-not-detected' } };
      }
      if (identity.provider && identity.provider !== detectedProvider) {
        return { identity, failure: { ...identity, status: 'failed', reason: 'provider-mismatch' } };
      }
      const providerMode = detectedProvider === 'google'
        ? getGoogleController().normalizeGoogleProviderMode(data.providerMode)
        : null;
      return { identity, providerMode };
    }

    // Starting a new conversation should not let a leftover composer draft (from
    // a failed send, Fill, or a provider-restored draft) ride along with the next
    // question. The host is restoring focus to its unified composer here, so this
    // path never focuses the provider editor.
    function clearComposerAfterNewChat(provider, providerMode) {
      try {
        getComposerController().clearProviderComposer(provider, providerMode, {
          focus: false,
          clearImages: true,
          onlyIfDirty: true
        });
      } catch (error) {
        console.warn('[New Chat] Could not clear the composer:', error);
      }
    }

    // While the provider confirms the new chat (up to 12s), the user may click
    // into this panel and start typing. A trusted interaction means the draft is
    // theirs, not leftover content, so it must survive the cleanup.
    function watchNewChatUserInteraction() {
      let interacted = false;
      const mark = event => {
        if (event.isTrusted) interacted = true;
      };
      document.addEventListener('pointerdown', mark, true);
      document.addEventListener('keydown', mark, true);
      return {
        get interacted() {
          return interacted;
        },
        stop() {
          document.removeEventListener('pointerdown', mark, true);
          document.removeEventListener('keydown', mark, true);
        }
      };
    }

    async function verifyNewChatRequest(data, detectedProvider, { baseline = null, recovery = false } = {}) {
      const { identity, providerMode, failure } = resolveNewChatRequest(data, detectedProvider);
      if (failure) return failure;
      const provider = detectedProvider;

      const baselineIsAlreadyFresh = isAlreadyFreshNewChatState(baseline, provider, providerMode);
      const interaction = watchNewChatUserInteraction();
      let result;
      try {
        result = await waitForNewChatState(provider, providerMode, {
          baseline,
          timeoutMs: getConfigController().NEW_CHAT_CONFIRMATION_TIMEOUT_MS,
          stableMs: recovery ? getConfigController().NEW_CHAT_RECOVERY_STABLE_MS : getConfigController().NEW_CHAT_CLICK_STABLE_MS,
          requireTransition: Boolean(baseline) && !baselineIsAlreadyFresh,
          // A navigation recovery or host-driven verification has no trusted
          // before/after DOM snapshot. Require the provider's canonical new-chat
          // route before a blank, still-hydrating page can count as ready.
          requireCanonicalFreshUrl: recovery || data.type === 'VERIFY_NEW_CHAT'
        });
      } finally {
        interaction.stop();
      }

      if (!interaction.interacted) {
        clearComposerAfterNewChat(provider, providerMode);
      }

      if (result.verified) return { ...identity, provider: detectedProvider, status: 'verified' };
      return {
        ...identity,
        provider: detectedProvider,
        status: result.failed ? 'failed' : 'unconfirmed',
        reason: result.reason
      };
    }

    function submitNewChatRequest(data, detectedProvider, type) {
      if (typeof data.requestId !== 'string' || data.requestId.length === 0) {
        return;
      }

      const mapKey = getNewChatRequestMapKey(data.requestId, data.panelId || '');
      const existing = pendingNewChatRequests.get(mapKey);
      if (existing) {
        existing.then(result => postNewChatResult(result));
        return;
      }

      const task = (async () => {
        if (type === 'VERIFY_NEW_CHAT') {
          const result = await verifyNewChatRequest(data, detectedProvider, { recovery: true });
          clearPendingNewChatRequest(getPendingNewChatStorageKey(data.requestId, data.panelId || ''));
          return result;
        }

        const { identity, providerMode, failure } = resolveNewChatRequest(data, detectedProvider);
        if (failure) return failure;
        const provider = detectedProvider;

        const baseline = captureNewChatState(provider, providerMode);
        const storageKey = writePendingNewChatRequest(data, detectedProvider, providerMode);
        let started = false;
        try {
          started = clickNewChatButton(detectedProvider, providerMode);
        } catch (error) {
          console.warn('[New Chat] Provider new-chat control failed:', error);
          clearPendingNewChatRequest(storageKey);
          clearComposerAfterNewChat(detectedProvider, providerMode);
          return { ...identity, provider: detectedProvider, status: 'failed', reason: 'click-error' };
        }

        if (!started) {
          clearPendingNewChatRequest(storageKey);
          clearComposerAfterNewChat(detectedProvider, providerMode);
          return { ...identity, provider: detectedProvider, status: 'failed', reason: 'control-not-found' };
        }

        const result = await verifyNewChatRequest(data, detectedProvider, { baseline });
        clearPendingNewChatRequest(storageKey);
        return result;
      })();

      pendingNewChatRequests.set(mapKey, task);
      task.then(result => postNewChatResult(result)).catch(error => {
        console.error('[New Chat] Could not verify the new conversation:', error);
        const identity = getNewChatResultIdentity(data, detectedProvider);
        postNewChatResult({ ...identity, status: 'unconfirmed', reason: 'verification-error' });
      });

      // Keep a small idempotency cache so a duplicate host message cannot click
      // the provider's new-chat control twice.
      if (pendingNewChatRequests.size > 32) {
        const oldestRequestKey = pendingNewChatRequests.keys().next().value;
        pendingNewChatRequests.delete(oldestRequestKey);
      }
    }

    function recoverPendingNewChatRequests() {
      const detectedProvider = getConfigController().detectProvider();
      if (!detectedProvider) return;

      for (const pending of findPendingNewChatRequests()) {
        if (pending.provider !== detectedProvider) continue;
        const mapKey = getNewChatRequestMapKey(pending.requestId, pending.panelId || '');
        const existing = pendingNewChatRequests.get(mapKey);
        if (existing) continue;

        const task = verifyNewChatRequest(pending, detectedProvider, { recovery: true });
        pendingNewChatRequests.set(mapKey, task);
        task.then(result => postNewChatResult(result)).catch(error => {
          console.error('[New Chat] Could not recover the new conversation result:', error);
          postNewChatResult({
            requestId: pending.requestId,
            provider: detectedProvider,
            panelId: pending.panelId,
            status: 'unconfirmed',
            reason: 'verification-error'
          });
        });
      }
    }

    return {
      clearComposerAfterNewChat,
      clickNewChatButton,
      enableTemporaryChat,
      getNewChatComposerContainer,
      getNewChatComposerText,
      hasNewChatComposerAttachments,
      recoverPendingNewChatRequests,
      submitNewChatRequest,
    };
  }

  runtime.factories.createNewChatController = createNewChatController;
})(globalThis.PanelizeContent);
