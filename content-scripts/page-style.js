// Page style adapter for provider panels. The multi-panel host asks for the
// "blind" look: every provider gets one neutral text style and hides branding
// so answers cannot be told apart by look. Only the extension frame that
// embeds this page may switch it; top-level provider tabs are never styled.
(function() {
  'use strict';

  if (window.PanelizePageStyle) return;

  const MESSAGE_TYPE = 'PANELIZE_PAGE_STYLE';
  const STYLE_ID = 'panelize-page-style';
  const SWIPE_GUARD_ID = 'panelize-swipe-guard';
  const MASK_DELAY_MS = 200;
  const COMPOSER_SELECTORS = 'textarea, [contenteditable="true"]';
  const SEND_CONTROL_SELECTORS = [
    'button[type="submit"]', '[aria-label*="send" i]', '[aria-label*="发送"]', '[aria-label*="送出"]',
    '[data-testid*="send" i]', '[data-testid*="submit" i]'
  ].join(', ');
  const ISOLATION_EXCEPTIONS = '[role="menu"], [role="listbox"], [role="dialog"], [data-radix-popper-content-wrapper], script, style';
  // Model pickers stay in the page so tier switching keeps working; only
  // their text and icons are made invisible.
  const MODEL_LABEL_SELECTORS = [
    '[data-testid="model-switcher-dropdown-button"]',
    '[data-testid*="model-select"]',
    '[data-testid*="model-switcher"]',
    '[data-testid*="reasoning-effort"]',
    '[data-testid*="thinking-strength"]',
    '[aria-label="Select Model"]',
    '[aria-label="选择一个模型"]',
    '.modelSelectorButton',
    '.think-mode-trigger',
    '.wms-trigger',
    '[data-test-id="bard-mode-menu-button"]'
  ].join(', ');
  const MESSAGE_SELECTORS = [
    '.markdown', '.prose', '[class*="markdown"]', '[class*="Markdown"]',
    '[data-message-author-role]', '.message-content', '[class*="message-content"]',
    'model-response', 'message-content', '.ds-markdown', '.segment-content'
  ].join(', ');
  const BLIND_CSS = `
    :where(${MESSAGE_SELECTORS}), :where(${MESSAGE_SELECTORS}) :where(p, li, td, th, blockquote, span, div, h1, h2, h3, h4, h5, h6, strong, em, a) {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif !important;
      letter-spacing: normal !important;
    }
    :where(${MESSAGE_SELECTORS}) { font-size: 15px !important; line-height: 1.7 !important; }
    :where(${MESSAGE_SELECTORS}) :where(code, pre, kbd, samp) {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace !important;
      font-size: 13px !important;
    }
    :where(${MESSAGE_SELECTORS}) :where(p, ul, ol, pre, blockquote, table) { margin: 0 0 0.75em !important; }
    :where(${MESSAGE_SELECTORS}) :where(li) { margin: 0.25em 0 !important; }
    :where(${MESSAGE_SELECTORS}) :where(ul, ol) { padding-left: 1.5em !important; }
    :where(${MESSAGE_SELECTORS}) :where(h1, h2, h3, h4, h5, h6) {
      margin: 1.2em 0 0.5em !important; line-height: 1.4 !important; font-weight: 600 !important;
    }
    :where(${MESSAGE_SELECTORS}) :where(h1) { font-size: 1.5em !important; }
    :where(${MESSAGE_SELECTORS}) :where(h2) { font-size: 1.3em !important; }
    :where(${MESSAGE_SELECTORS}) :where(h3) { font-size: 1.15em !important; }
    :where(${MESSAGE_SELECTORS}) :where(h4, h5, h6) { font-size: 1em !important; }
    :where(${MESSAGE_SELECTORS}) :where(p, ul, ol, pre, blockquote, table, h1, h2, h3, h4, h5, h6):first-child { margin-top: 0 !important; }
    :where(${MESSAGE_SELECTORS}) :where(hr) { margin: 1em 0 !important; }
    html, body { background: #fff !important; color-scheme: light !important; }
    :where([data-panelize-keep]):not([data-panelize-composer], [data-panelize-composer] *, table, table *, hr) {
      background-color: transparent !important; background-image: none !important;
      box-shadow: none !important; border-color: transparent !important;
    }
    :where(${MESSAGE_SELECTORS}), :where(${MESSAGE_SELECTORS}) :where(*) { color: #1f1f1f !important; }
    :where(${MESSAGE_SELECTORS}) :where(pre) {
      background: #f5f5f5 !important; border: none !important; border-radius: 8px !important;
    }
    :where(${MESSAGE_SELECTORS}) :where(pre) :where(*) { background: transparent !important; }
    [data-panelize-composer] {
      background: #fff !important; border: 1px solid #d9d9de !important; border-radius: 20px !important;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08) !important;
    }
    :where([data-panelize-composer] *):not(button, [role="button"], button *, [role="button"] *) {
      background-color: transparent !important; border-color: transparent !important; box-shadow: none !important;
    }
    ${MODEL_LABEL_SELECTORS}, :is(${MODEL_LABEL_SELECTORS}) * { color: transparent !important; text-shadow: none !important; }
    :is(${MODEL_LABEL_SELECTORS}) :where(img, svg, picture) { opacity: 0 !important; }
    [class*="logo" i], [class*="Logo"], [class*="avatar" i], [class*="Avatar"], [data-testid*="avatar" i],
    img[alt*="logo" i], svg[aria-label*="logo" i] { display: none !important; }
    [data-panelize-hide] { display: none !important; }
    [data-panelize-collapse] {
      width: 0 !important; min-width: 0 !important; flex-basis: 0 !important;
      padding: 0 !important; margin: 0 !important; border: 0 !important; overflow: visible !important;
    }
    [data-panelize-composer] {
      position: fixed !important; left: 12px !important; right: 12px !important; bottom: 12px !important;
      top: auto !important; max-width: 760px !important; margin: 0 auto !important;
      transform: none !important; z-index: 20 !important;
    }
    [data-panelize-scroller] { padding-bottom: var(--panelize-composer-space, 160px) !important; }
    html { filter: grayscale(1) !important; }
    ::placeholder { color: transparent !important; }
    [data-placeholder]::before, [data-placeholder]::after, [class*="placeholder" i] { color: transparent !important; }
  `;
  // Names a provider gives itself in answers and page text. Latin names need
  // word boundaries so ordinary words that contain them stay intact.
  const BRAND_NAME_PATTERN = new RegExp([
    '\\b(?:ChatGPT|GPT(?:-[\\w.]+|\\d[\\w.]*)?|OpenAI|Claude|Anthropic|Gemini|Bard|Google|DeepMind|Grok|xAI',
    'DeepSeek|Kimi|Moonshot|Doubao|ByteDance|Qwen|Tongyi|Alibaba|ChatGLM|GLM(?:-[\\w.]+|\\d[\\w.]*)?|Zhipu|Z\\.ai',
    'Yuanbao|Hunyuan|Tencent|MiMo|Xiaomi|Meta AI|Llama|StepFun|Agnes)\\b',
    '深度求索|月之暗面|豆包|字节跳动|通义|千问|阿里巴巴|阿里云|智谱|元宝|混元|腾讯|小米|阶跃星辰|阶跃'
  ].join('|'), 'gi');
  const BRAND_MASK = '███';
  // Model pickers are already transparent; their real labels are kept so tier
  // recipes (e.g. "GPT-6") can still read the selected model back.
  const MASK_SKIP_SELECTOR = `textarea, input, [contenteditable]:not([contenteditable="false"]), script, style, noscript, code, pre, ${MODEL_LABEL_SELECTORS}`;

  const PROVIDER_HOSTS = [
    ['chatgpt', ['chatgpt.com', 'chat.openai.com']],
    ['claude', ['claude.ai']],
    ['gemini', ['gemini.google.com']],
    ['grok', ['grok.com']],
    ['deepseek', ['chat.deepseek.com']],
    ['kimi', ['kimi.com', 'kimi.ai']],
    ['google', ['google.com']],
    ['doubao', ['doubao.com']],
    ['qwen-cn', ['qianwen.com']],
    ['qwen-global', ['chat.qwen.ai', 'qwen.ai', 'chat.qwenlm.ai']],
    ['chatglm', ['chatglm.cn']],
    ['zai-global', ['chat.z.ai']],
    ['yuanbao', ['yuanbao.tencent.com']],
    ['mimo', ['aistudio.xiaomimimo.com']],
    ['meta-ai', ['meta.ai']],
    ['stepfun', ['studio.stepfun.com']],
    ['agnes', ['app.agnes-ai.com']],
    ['hy-aistudio', ['aistudio.tencent.com']]
  ];
  const hostname = String(window.location?.hostname || '').toLowerCase();
  const provider = PROVIDER_HOSTS.find(([, domains]) => domains.some(domain =>
    hostname === domain || hostname.endsWith(`.${domain}`)))?.[0] || null;
  // App chrome that sibling isolation misses: ChatGLM's aside holds Element
  // Plus dialog overlays (an isolation exception), and Z.ai's sidebar is not
  // always a sibling of a kept branch. New Chat falls back to the provider URL
  // when its sidebar button is hidden.
  const PROVIDER_BLIND_HIDE_SELECTORS = {
    chatglm: ['aside.aside-container'],
    'zai-global': ['#sidebar']
  };
  const providerBlindHideSelector = PROVIDER_BLIND_HIDE_SELECTORS[provider]?.join(', ') || '';
  const extensionOrigin = getExtensionOrigin();
  const state = { blind: false };
  let styleObserver = null;
  let observedHead = null;
  let maskObserver = null;
  let composerObserver = null;
  let observedComposer = null;
  let maskTimer = null;
  let isolationPending = false;
  const pendingMaskNodes = new Set();
  let visibleRoots = new Set();
  // Text node -> { original, masked }, so turning blind mode off restores
  // every node the page has not rewritten since.
  const maskedNodes = new Map();

  function getExtensionOrigin() {
    try {
      const url = new URL(chrome.runtime.getURL('/'));
      if (!['chrome-extension:', 'moz-extension:', 'safari-web-extension:'].includes(url.protocol)) return null;
      return url.origin === 'null' ? `${url.protocol}//${url.host}` : url.origin;
    } catch {
      return null;
    }
  }

  function buildCss() {
    return state.blind ? BLIND_CSS : '';
  }

  function ensureStyle() {
    const css = buildCss();
    let style = document.getElementById(STYLE_ID);
    if (!css) {
      style?.remove();
      return;
    }
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
    }
    if (style.textContent !== css) style.textContent = css;
    // Appended last so the rules win over site styles of equal specificity.
    const parent = document.head || document.documentElement;
    if (style.parentNode !== parent || style !== parent.lastElementChild) parent.appendChild(style);
  }

  function observeStyleOwner() {
    if (!styleObserver) return;
    const head = document.head;
    if (head === observedHead) return;

    styleObserver.disconnect();
    // The root observer detects a replaced or newly added <head>; the head
    // observer catches only direct stylesheet changes, not streamed page DOM.
    styleObserver.observe(document.documentElement, { childList: true });
    if (head) styleObserver.observe(head, { childList: true });
    observedHead = head;
  }

  function onStyleOwnerMutations() {
    if (document.head !== observedHead) observeStyleOwner();
    const parent = document.head || document.documentElement;
    const style = document.getElementById(STYLE_ID);
    if (!style?.isConnected || style.parentElement !== parent || style !== parent.lastElementChild) {
      ensureStyle();
    }
  }

  function maskBrandNameInTextNode(node) {
    if (!state.blind || node?.nodeType !== Node.TEXT_NODE || !node.parentElement) return;
    const text = node.nodeValue;
    if (maskedNodes.get(node)?.masked === text) return;
    BRAND_NAME_PATTERN.lastIndex = 0;
    if (!text || !BRAND_NAME_PATTERN.test(text)) {
      maskedNodes.delete(node);
      return;
    }
    if (node.parentElement.closest(MASK_SKIP_SELECTOR)) {
      maskedNodes.delete(node);
      return;
    }

    const masked = text.replace(BRAND_NAME_PATTERN, BRAND_MASK);
    if (masked === text) {
      maskedNodes.delete(node);
      return;
    }

    // Retain the latest page-authored value so turning blind mode off restores
    // an answer node that the provider updated while it was masked.
    maskedNodes.set(node, { original: text, masked });
    node.nodeValue = masked;
  }

  function isInsideVisibleRoot(node) {
    let element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    for (; element && element.nodeType === Node.ELEMENT_NODE; element = element.parentElement) {
      if (visibleRoots.has(element)) return true;
    }
    return false;
  }

  function forgetMaskedNodesInSubtree(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      if (root.isConnected) {
        // A provider may move a live answer node between containers instead
        // of replacing it. Keep its original value for a later restore.
        pendingMaskNodes.add(root);
      } else {
        maskedNodes.delete(root);
        pendingMaskNodes.delete(root);
      }
      return;
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.isConnected) {
        pendingMaskNodes.add(node);
      } else {
        maskedNodes.delete(node);
        pendingMaskNodes.delete(node);
      }
    }
  }

  function maskBrandNames() {
    if (!state.blind || !document.body) return;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      maskBrandNameInTextNode(node);
    }
  }

  function restoreBrandNames() {
    for (const [node, { original, masked }] of maskedNodes) {
      if (node.nodeValue === masked) node.nodeValue = original;
    }
    maskedNodes.clear();
  }

  function elementIsVisible(element) {
    if (!element?.isConnected || element.closest('[hidden], [aria-hidden="true"]')) return false;
    for (let current = element; current && current.nodeType === 1; current = current.parentElement) {
      const style = window.getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') {
        return false;
      }
    }
    const rect = element.getBoundingClientRect();
    return (rect.width > 0 && rect.height > 0) || element.getClientRects().length > 0;
  }

  function clearIsolation({ preserveLayout = false } = {}) {
    document.querySelectorAll('[data-panelize-keep], [data-panelize-hide], [data-panelize-collapse], [data-panelize-composer], [data-panelize-scroller]').forEach(element => {
      element.removeAttribute('data-panelize-keep');
      element.removeAttribute('data-panelize-hide');
      element.removeAttribute('data-panelize-collapse');
      if (!preserveLayout) {
        element.removeAttribute('data-panelize-composer');
        element.removeAttribute('data-panelize-scroller');
      }
    });
    if (!preserveLayout) {
      for (const element of [document.body, document.documentElement]) {
        if (element?.style.getPropertyValue('--panelize-composer-space')) {
          element.style.removeProperty('--panelize-composer-space');
        }
      }
    }
    visibleRoots = new Set();
  }

  function updateComposerSpace() {
    if (!state.blind || !observedComposer?.isConnected) return;
    const space = `${observedComposer.getBoundingClientRect().height + 24}px`;
    if (document.documentElement.style.getPropertyValue('--panelize-composer-space') !== space) {
      document.documentElement.style.setProperty('--panelize-composer-space', space);
    }
  }

  function observeComposer(composer) {
    if (composer !== observedComposer) {
      composerObserver?.disconnect();
      observedComposer = composer;
      if (composer) composerObserver?.observe(composer);
    }
    updateComposerSpace();
  }

  function findAnswerScroller() {
    const message = document.querySelector(MESSAGE_SELECTORS);
    for (let current = message; current; current = current.parentElement) {
      if (/^(auto|scroll)$/.test(window.getComputedStyle(current).overflowY)) return current;
    }
    return document.scrollingElement || document.documentElement;
  }

  function findComposerRoot(input) {
    let firstCompactAncestor = null;
    for (let current = input.parentElement; current && current !== document.body; current = current.parentElement) {
      const rect = current.getBoundingClientRect();
      const compact = rect.height > 0 && rect.height < 320;
      const form = current.tagName === 'FORM';
      if (!firstCompactAncestor && compact) firstCompactAncestor = current;
      // Continue past compact editor wrappers so a nearby send button in the
      // composer row stays visible, but never adopt a whole app shell just
      // because it contains an unrelated send action elsewhere on the page.
      if ((compact || form) && current.querySelector(SEND_CONTROL_SELECTORS)) return current;
    }
    return firstCompactAncestor || input;
  }

  function markKeepSubtree(element) {
    if (!element || element.nodeType !== 1) return;
    element.setAttribute('data-panelize-keep', '');
    element.querySelectorAll('*').forEach(descendant => descendant.setAttribute('data-panelize-keep', ''));
    for (let current = element.parentElement; current; current = current.parentElement) {
      current.setAttribute('data-panelize-keep', '');
      if (current === document.body) break;
    }
  }

  function containsIsolationException(element) {
    return element.matches(ISOLATION_EXCEPTIONS) || Boolean(element.querySelector(ISOLATION_EXCEPTIONS));
  }

  function hideUnkeptSiblings() {
    const keepElements = document.querySelectorAll('body [data-panelize-keep]');
    const visitedParents = new Set();
    for (const kept of keepElements) {
      for (let current = kept; current && current !== document.body; current = current.parentElement) {
        const parent = current.parentElement;
        if (!parent || parent === document.documentElement || visitedParents.has(parent)) continue;
        visitedParents.add(parent);
        for (const sibling of parent.children) {
          if (sibling === current || sibling.hasAttribute('data-panelize-keep') || containsIsolationException(sibling)) continue;
          sibling.setAttribute('data-panelize-hide', '');
        }
      }
    }
  }

  function hideProviderChrome() {
    if (!providerBlindHideSelector) return;
    document.querySelectorAll(providerBlindHideSelector).forEach(element => {
      // Model pickers and the composer must stay usable in blind mode.
      if (element.matches(MODEL_LABEL_SELECTORS) || element.querySelector(MODEL_LABEL_SELECTORS)) return;
      if (element.closest(MODEL_LABEL_SELECTORS) || element.closest('[data-panelize-composer]')) return;
      if (element.querySelector('[data-panelize-composer]')) return;
      hideAroundIsolationExceptions(element);
    });
  }

  // ChatGLM mounts its dialogs inside the sidebar. Hiding the sidebar would
  // hide them too, so collapse it and hide only the branches without dialogs.
  function hideAroundIsolationExceptions(element) {
    if (!containsIsolationException(element)) {
      element.setAttribute('data-panelize-hide', '');
      return;
    }
    if (element.matches(ISOLATION_EXCEPTIONS)) return;
    element.setAttribute('data-panelize-collapse', '');
    [...element.children].forEach(hideAroundIsolationExceptions);
  }

  function isolatePage() {
    if (!state.blind || !document.body) return;
    // Keep clearance in place while reading geometry. Temporarily removing
    // scroller padding can clamp scrollTop and move the last answer under the
    // fixed composer when a model menu triggers another isolation pass.
    clearIsolation({ preserveLayout: true });

    const composers = [...document.querySelectorAll(COMPOSER_SELECTORS)].filter(elementIsVisible);
    const input = composers.at(-1);
    // Some provider states have no composer. Preserve the page in that case.
    if (!input) {
      clearIsolation();
      observeComposer(null);
      visibleRoots = new Set(document.querySelectorAll(MESSAGE_SELECTORS));
      hideProviderChrome();
      return;
    }

    const markVisibleRoot = (element) => {
      if (!element || visibleRoots.has(element)) return;
      visibleRoots.add(element);
      markKeepSubtree(element);
    };

    const composer = findComposerRoot(input);
    composer.setAttribute('data-panelize-composer', '');
    markVisibleRoot(composer);
    document.querySelectorAll(MESSAGE_SELECTORS).forEach(markVisibleRoot);
    document.querySelectorAll(MODEL_LABEL_SELECTORS).forEach(markVisibleRoot);
    if (document.activeElement && document.activeElement !== document.body) markVisibleRoot(document.activeElement);
    hideUnkeptSiblings();
    hideProviderChrome();
    const scroller = findAnswerScroller();
    document.querySelectorAll('[data-panelize-composer]').forEach(element => {
      if (element !== composer) element.removeAttribute('data-panelize-composer');
    });
    document.querySelectorAll('[data-panelize-scroller]').forEach(element => {
      if (element !== scroller) element.removeAttribute('data-panelize-scroller');
    });
    scroller.setAttribute('data-panelize-scroller', '');
    observeComposer(composer);
  }

  function scanBlindPage() {
    maskTimer = null;
    if (!state.blind) return;
    const nodes = [...pendingMaskNodes];
    pendingMaskNodes.clear();
    nodes.forEach(maskBrandNameInTextNode);
    if (isolationPending) {
      isolationPending = false;
      isolatePage();
    }
  }

  function scheduleMaskScan() {
    if (maskTimer || !state.blind) return;
    maskTimer = setTimeout(() => {
      scanBlindPage();
    }, MASK_DELAY_MS);
  }

  function onBlindModeMutations(records) {
    if (!state.blind) return;
    let needsIsolation = false;

    records.forEach((record) => {
      if (record.type === 'characterData') {
        const previousMask = maskedNodes.get(record.target);
        // Masking a node creates one more characterData record. Ignore it when
        // the page still has exactly the value this extension wrote.
        if (previousMask?.masked === record.target.nodeValue) return;
        pendingMaskNodes.add(record.target);
        return;
      }

      if (record.type === 'childList') {
        record.removedNodes.forEach(forgetMaskedNodesInSubtree);
        record.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) {
            const walker = node.nodeType === Node.TEXT_NODE
              ? null
              : document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
            if (walker) {
              for (let textNode = walker.nextNode(); textNode; textNode = walker.nextNode()) {
                pendingMaskNodes.add(textNode);
              }
            } else {
              pendingMaskNodes.add(node);
            }
          }
        });
        needsIsolation = needsIsolation || !isInsideVisibleRoot(record.target);
        return;
      }

      if (record.type === 'attributes' && !isInsideVisibleRoot(record.target)) {
        needsIsolation = true;
      }
    });

    isolationPending = isolationPending || needsIsolation;
    if (pendingMaskNodes.size > 0 || isolationPending) scheduleMaskScan();
  }

  function onFocusChange() {
    isolationPending = true;
    scheduleMaskScan();
  }

  function updateObservers() {
    if (state.blind && !composerObserver) {
      composerObserver = new ResizeObserver(updateComposerSpace);
      if (observedComposer) composerObserver.observe(observedComposer);
    } else if (!state.blind && composerObserver) {
      composerObserver.disconnect();
      composerObserver = null;
      observedComposer = null;
    }
    if (state.blind && !styleObserver) {
      // Single-page apps replace <head>; follow its direct children to keep
      // the stylesheet last without watching every provider page mutation.
      styleObserver = new MutationObserver(onStyleOwnerMutations);
      observeStyleOwner();
    } else if (!state.blind && styleObserver) {
      styleObserver.disconnect();
      styleObserver = null;
      observedHead = null;
    }
    if (state.blind && !maskObserver && document.body) {
      // Streamed tokens are masked by text node; the page isolation pass only
      // runs for structural changes outside the composer and answer roots.
      maskObserver = new MutationObserver(onBlindModeMutations);
      maskObserver.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'open']
      });
      document.addEventListener('focusin', onFocusChange, true);
      document.addEventListener('focusout', onFocusChange, true);
    } else if (!state.blind && maskObserver) {
      maskObserver.disconnect();
      maskObserver = null;
      document.removeEventListener('focusin', onFocusChange, true);
      document.removeEventListener('focusout', onFocusChange, true);
      clearTimeout(maskTimer);
      maskTimer = null;
      pendingMaskNodes.clear();
      isolationPending = false;
      clearIsolation();
    }
  }

  function apply(next) {
    state.blind = next.blind === true;
    ensureStyle();
    if (state.blind) {
      maskBrandNames();
      isolatePage();
    }
    else {
      restoreBrandNames();
      clearIsolation();
    }
    updateObservers();
  }

  function onMessage(event) {
    const data = event.data;
    if (!data || data.type !== MESSAGE_TYPE || data.context !== 'multi-panel') return;
    if (!extensionOrigin || window.parent === window) return;
    if (event.source !== window.parent || event.origin !== extensionOrigin) return;
    apply(data);
  }

  // Mouse back/forward buttons would navigate the panel away from its chat.
  // Only frames under the extension page are guarded; top-level provider tabs
  // keep the browser's default navigation.
  function isUnderExtensionPage() {
    if (!extensionOrigin || window.parent === window) return false;
    const ancestors = window.location.ancestorOrigins;
    return ancestors?.length > 0 && ancestors[ancestors.length - 1] === extensionOrigin;
  }

  function blockHistoryButton(event) {
    if (event.button !== 3 && event.button !== 4) return;
    event.preventDefault();
    event.stopPropagation();
  }

  // A horizontal trackpad swipe that overscrolls the frame would also go back
  // in history (seen in Gemini), so horizontal overscroll stops at the frame.
  function blockSwipeNavigation() {
    if (document.getElementById(SWIPE_GUARD_ID)) return;
    const style = document.createElement('style');
    style.id = SWIPE_GUARD_ID;
    style.textContent = 'html, body { overscroll-behavior-x: none !important; }';
    (document.head || document.documentElement).appendChild(style);
  }

  if (isUnderExtensionPage()) {
    for (const type of ['mousedown', 'mouseup', 'auxclick']) {
      window.addEventListener(type, blockHistoryButton, true);
    }
    blockSwipeNavigation();
  }

  window.addEventListener('message', onMessage);
  window.PanelizePageStyle = { getState: () => ({ ...state }) };
})();
