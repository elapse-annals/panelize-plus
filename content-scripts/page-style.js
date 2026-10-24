// Page style adapter for provider panels. The multi-panel host asks for two
// independent looks: "wide" lets the conversation column use the whole panel,
// and "blind" gives every provider one neutral text style and hides branding
// so answers cannot be told apart by look. Only the extension frame that
// embeds this page may switch them; top-level provider tabs are never styled.
(function() {
  'use strict';

  if (window.PanelizePageStyle) return;

  const MESSAGE_TYPE = 'PANELIZE_PAGE_STYLE';
  const STYLE_ID = 'panelize-page-style';
  const WIDE_ATTRIBUTE = 'data-panelize-wide';
  const MIN_COLUMN_WIDTH = 480;
  const MAX_COLUMN_WIDTH = 1600;
  const SCAN_DELAY_MS = 600;

  // Conversation columns found on each site. Columns not listed here are
  // still widened by the ancestor walk in markWideColumns().
  const WIDE_RULES = {
    chatgpt: '* { --thread-content-max-width: 100% !important; }',
    kimi: '.chat-editor-wrap, .chat-content-list, .chat-content-container { max-width: none !important; }',
    'zai-global': '[class*="max-w-[768px]"], [class*="max-w-[712px]"], [class*="max-w-[854px]"] { max-width: none !important; }',
    'qwen-global': '.message-input-wrapper, .chat-messages-container, .chat-container { max-width: none !important; }'
  };
  // Model pickers stay in the page so tier switching keeps working; only
  // their text and icons are made invisible.
  const MODEL_LABEL_SELECTORS = [
    '[data-testid="model-switcher-dropdown-button"]',
    '[data-testid*="model-select"]',
    '[data-testid*="model-switcher"]',
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
    :where(${MESSAGE_SELECTORS}) :where(h1, h2, h3, h4) { font-weight: 600 !important; }
    ${MODEL_LABEL_SELECTORS}, :is(${MODEL_LABEL_SELECTORS}) * { color: transparent !important; text-shadow: none !important; }
    :is(${MODEL_LABEL_SELECTORS}) :where(img, svg, picture) { opacity: 0 !important; }
    [class*="logo" i], [class*="Logo"], [class*="avatar" i], [class*="Avatar"], [data-testid*="avatar" i],
    img[alt*="logo" i], svg[aria-label*="logo" i] { visibility: hidden !important; }
  `;

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
    ['meta-ai', ['meta.ai']]
  ];
  const hostname = String(window.location?.hostname || '').toLowerCase();
  const provider = PROVIDER_HOSTS.find(([, domains]) => domains.some(domain =>
    hostname === domain || hostname.endsWith(`.${domain}`)))?.[0] || null;
  const extensionOrigin = getExtensionOrigin();
  const state = { wide: false, blind: false };
  let styleObserver = null;
  let contentObserver = null;
  let scanTimer = null;

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
    const parts = [];
    if (state.wide) {
      parts.push(`[${WIDE_ATTRIBUTE}] { max-width: none !important; }`);
      if (WIDE_RULES[provider]) parts.push(WIDE_RULES[provider]);
    }
    if (state.blind) parts.push(BLIND_CSS);
    return parts.join('\n');
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

  function pixelMaxWidth(element) {
    let style;
    try { style = window.getComputedStyle(element); } catch { return null; }
    const value = style.maxWidth;
    if (!value || !value.endsWith('px')) return null;
    const width = parseFloat(value);
    return width >= MIN_COLUMN_WIDTH && width <= MAX_COLUMN_WIDTH ? width : null;
  }

  /**
   * Walks up from the composer and the latest messages and marks the fixed
   * pixel max-width that centres the conversation column. Bounded to those
   * few ancestor chains so long chats stay cheap to scan.
   */
  function markWideColumns() {
    if (!state.wide || !document.body) return;
    const starts = [
      document.querySelector('textarea, [contenteditable="true"]'),
      ...Array.from(document.querySelectorAll(MESSAGE_SELECTORS)).slice(-3)
    ].filter(Boolean);
    for (const start of starts) {
      for (let element = start; element && element !== document.body; element = element.parentElement) {
        if (element.hasAttribute(WIDE_ATTRIBUTE)) continue;
        if (pixelMaxWidth(element) !== null) element.setAttribute(WIDE_ATTRIBUTE, '');
      }
    }
  }

  function clearWideColumns() {
    document.querySelectorAll(`[${WIDE_ATTRIBUTE}]`).forEach(element => element.removeAttribute(WIDE_ATTRIBUTE));
  }

  function scheduleScan() {
    if (scanTimer || !state.wide) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      markWideColumns();
    }, SCAN_DELAY_MS);
  }

  function updateObservers() {
    const active = state.wide || state.blind;
    if (active && !styleObserver) {
      // Single-page apps rewrite <head>; put the style back when it goes.
      styleObserver = new MutationObserver(() => {
        if (document.getElementById(STYLE_ID)?.isConnected !== true) ensureStyle();
      });
      styleObserver.observe(document.documentElement, { childList: true, subtree: true });
    } else if (!active && styleObserver) {
      styleObserver.disconnect();
      styleObserver = null;
    }
    if (state.wide && !contentObserver && document.body) {
      contentObserver = new MutationObserver(scheduleScan);
      contentObserver.observe(document.body, { childList: true, subtree: true });
    } else if (!state.wide && contentObserver) {
      contentObserver.disconnect();
      contentObserver = null;
    }
  }

  function apply(next) {
    state.wide = next.wide === true;
    state.blind = next.blind === true;
    ensureStyle();
    if (state.wide) markWideColumns();
    else clearWideColumns();
    updateObservers();
  }

  function onMessage(event) {
    const data = event.data;
    if (!data || data.type !== MESSAGE_TYPE || data.context !== 'multi-panel') return;
    if (!extensionOrigin || window.parent === window) return;
    if (event.source !== window.parent || event.origin !== extensionOrigin) return;
    apply(data);
  }

  window.addEventListener('message', onMessage);
  window.PanelizePageStyle = { getState: () => ({ ...state }) };
})();
