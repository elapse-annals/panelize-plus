(function(runtime) {
  'use strict';

  /**
   * Owns tier config behavior and its page-local state.
   * Deferred controller getters keep composition in the entry point.
   */


  function createTierConfigController() {
    const TIER_IDS = ['fast', 'balanced', 'deep'];
    const REQUESTS = {
      GET_PROVIDER_TIER_STATE: 'PANELIZE_PROVIDER_TIER_STATE',
      SET_PROVIDER_TIER: 'PANELIZE_PROVIDER_TIER_RESULT'
    };

    const FORBIDDEN_LABEL = /\b(send|submit|agent|deep research|research|web search|search|image|upload|attach|new chat|regenerate|stop|cancel)\b|发送|提交|智能体|研究|搜索|联网|图片|上传|附件|新对话|停止|取消/i;
    const LOGIN_LABEL = /^(log in|login|sign in|continue with google|登录|注册|登录以继续|立即登录)$/i;
    const MENU_SELECTOR = '[role="menu"], [role="listbox"], [role="tree"], [data-state="open"]';
    const OPTION_SELECTOR = 'button, [role="button"], [role="menuitem"], [role="menuitemradio"], [role="option"], [role="radio"], [role="checkbox"], [role="switch"], [aria-checked], [aria-selected], [data-testid*="option"]';
    const rx = (...values) => values.map(value => new RegExp(value, 'i'));
    const DISCOVERY_CONFIG = {
      strategy: 'discover',
      selectors: ['[data-testid*="model"]', '[data-testid*="mode"]', '[aria-haspopup="listbox"]', '[role="combobox"]'],
      triggerLabels: rx('model|mode|reasoning|thinking|fast|deep|模型|模式|思考|推理|快速|深度'),
      toggleLabels: rx('^(deep.?think|think|thinking|thinking mode|reasoning|reasoning mode|fast mode|思考|思考模式|深度思考|深度推理)(\\s+.*)?$'),
      submenuLabels: rx('^(reasoning|reasoning effort|thinking level|effort|思考强度|推理强度|思考档位)$'),
      tiers: {
        fast: rx('\\b(instant|fast|quick|low|light|standard|flash|haiku)\\b', '快速|极速|低|轻量|标准'),
        balanced: rx('\\b(medium|balanced|auto|normal|sonnet)\\b', '中等|均衡|自动|常规'),
        deep: rx('\\b(high|extra high|deep|advanced|extreme|max|extended|thinking|reasoning|opus)\\b', '高|深度|深度思考|高级|极致|最大')
      }
    };

    // Keep these candidates aligned with modules/providers/provider-tiers.js. Matching
    // configuration alone never reports support; a visible UI control is also
    // required for each operation.
    const CONFIG = {
      chatgpt: {
        strategy: 'menu',
        selectors: ['[data-testid*="model-switcher"]', '[data-testid*="model-picker"]'],
        sliderLabels: rx('thinking strength', 'thinking level', 'reasoning effort', 'reasoning level', '思考强度', '推理强度'),
        effortSelectors: ['[data-testid*="reasoning-effort"]', '[data-testid*="thinking-strength"]', 'button[aria-label*="reasoning effort" i]', 'button[aria-label*="思考强度"]'],
        triggerLabels: rx('model', 'effort', 'reasoning', 'thinking level', 'instant', 'medium', 'high', '模型', '快速', '均衡', '深度'),
        submenuLabels: rx('^(reasoning effort|thinking level|effort|configure)$'),
        // Recipes from the host (GPT-6 + Instant/Medium/High) take precedence;
        // the strength slider still serves their thinking steps.
        acceptsRecipes: true,
        modelSelectors: ['[data-testid*="model-switcher"]', '[data-testid*="model-picker"]'],
        thinkingSelectors: ['[data-testid*="reasoning-effort"]', '[data-testid*="thinking-strength"]', 'button[aria-label*="reasoning effort" i]', 'button[aria-label*="思考强度"]'],
        tiers: {
          fast: rx('instant|fast|low|light|即时|快速|低'),
          balanced: rx('medium|balanced|pro standard|standard|中|中等|均衡|标准'),
          deep: rx('extra high|pro extended|extended|deep|high|深入|高|极高')
        }
      },
      claude: {
        strategy: 'menu',
        selectors: ['[data-testid*="model-selector"]', '[data-testid*="model-picker"]'],
        effortSelectors: ['[data-testid*="effort-selector"]', 'button[aria-label*="effort" i]', '[data-testid*="thinking-level"]'],
        triggerLabels: rx('model|haiku|sonnet|opus|模型'),
        submenuLabels: rx('^(effort|reasoning effort|thinking level)$'),
        tiers: { fast: rx('low|haiku'), balanced: rx('medium|sonnet'), deep: rx('high|extra high|xhigh|max|opus') },
        preferredTiers: { fast: rx('\\blow\\b|低'), balanced: rx('\\bmedium\\b|中等'), deep: rx('\\b(high|extra high|xhigh|max)\\b|高') }
      },
      gemini: {
        strategy: 'recipe',
        modelSelectors: ['button[aria-label*="模式选择器"]', 'button[aria-label*="mode picker" i]', '[data-test-id="bard-mode-menu-button"]'],
        effortSelectors: ['[data-testid*="thinking-level"]', 'button[aria-label*="thinking level" i]', 'button[aria-label*="思考等级"]']
      },
      deepseek: { strategy: 'recipe' },
      kimi: { strategy: 'recipe', modelSelectors: ['[data-testid="model-select-trigger"]'] },
      'qwen-cn': { strategy: 'recipe' },
      'qwen-global': {
        strategy: 'recipe',
        modelSelectors: ['.wms-trigger', '[aria-label="Select Model"]'],
        thinkingSelectors: ['.qwen-thinking-selector', '[aria-label="选择模式"]']
      },
      chatglm: { strategy: 'recipe', modelSelectors: ['.think-mode-trigger'], thinkingSelectors: ['.think-mode-trigger'] },
      'zai-global': { strategy: 'recipe', modelSelectors: ['.modelSelectorButton', '[aria-label="选择一个模型"]'] },
      yuanbao: {
        strategy: 'recipe',
        modelSelectors: ['.ybc-model-select-button'],
        // The trigger always reads "元宝"; only its tracking id names the model.
        modelAttribute: { name: 'dt-model-id', labels: [[/deep_?seek/i, 'DeepSeek'], [/hunyuan/i, 'Hy3']] },
        // Clicks on the dropdown <li> are ignored; the inner item takes them.
        optionClickSelector: '.ybc-model-select-dropdown-item',
        toggleSelectors: ['[dt-button-id="deep_think"]']
      },
      'meta-ai': { strategy: 'recipe' },
      grok: { strategy: 'unsupported' },
      doubao: { ...DISCOVERY_CONFIG },
      mimo: { ...DISCOVERY_CONFIG },
      stepfun: { ...DISCOVERY_CONFIG },
      agnes: { ...DISCOVERY_CONFIG },
      'hy-aistudio': { ...DISCOVERY_CONFIG },
      perplexity: { ...DISCOVERY_CONFIG },
      copilot: { ...DISCOVERY_CONFIG },
      wenxin: { ...DISCOVERY_CONFIG }
    };

    const hostname = String(window.location?.hostname || '').toLowerCase();
    const PROVIDER_HOSTS = [
      ['chatgpt', ['chatgpt.com', 'chat.openai.com']],
      ['claude', ['claude.ai']],
      ['gemini', ['gemini.google.com']],
      ['grok', ['grok.com', 'x.com']],
      ['deepseek', ['chat.deepseek.com']],
      ['kimi', ['kimi.com', 'kimi.ai']],
      ['google', ['google.com', 'google.co.uk', 'google.ca', 'google.com.au']],
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
      ['hy-aistudio', ['aistudio.tencent.com']],
      ['perplexity', ['perplexity.ai']],
      ['copilot', ['copilot.com', 'copilot.microsoft.com']],
      ['wenxin', ['wenxin.baidu.com']]
    ];

    function hostMatches(host, domain) {
      return host === domain || host.endsWith(`.${domain}`);
    }

    const provider = PROVIDER_HOSTS.find(([, domains]) => domains.some(domain => hostMatches(hostname, domain)))?.[0] || null;
    const config = provider ? CONFIG[provider] : null;
    const extensionOrigin = getExtensionOrigin();

    function getExtensionOrigin() {
      try {
        const url = new URL(chrome.runtime.getURL('/'));
        if (!['chrome-extension:', 'moz-extension:', 'safari-web-extension:'].includes(url.protocol)) return null;
        // URL.origin is "null" for browser extension schemes in several engines.
        return url.origin === 'null' ? `${url.protocol}//${url.host}` : url.origin;
      } catch {
        return null;
      }
    }

    // ===== Recipe strategy =====
    // The host sends, per tier, the visible labels to pick in order: a model,
    // then a thinking level (or the DeepThink toggle). Every step is verified
    // against what the page shows before the next one runs.

    const RECIPE_FORBIDDEN_LABEL = /\b(send|submit|upload|attach|new chat|regenerate|stop)\b|发送|提交|上传|附件|新对话|停止/i;
    const SUBMENU_LABEL = /^(思考强度|思考等级|思考模式|推理强度|thinking level|thinking effort|reasoning effort|reasoning|effort)(\s|$)/i;
    const LOOSE_OPTION_SELECTOR = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"], [role="radio"], li, [class*="item" i], [class*="option" i]';
    const ASCII_WORD = /[a-z0-9]/i;
    const LABEL_CHAR = /[a-z0-9._-]/i;
    const CJK_CHAR = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;

    return {
      get ASCII_WORD() { return ASCII_WORD; },
      get CJK_CHAR() { return CJK_CHAR; },
      get FORBIDDEN_LABEL() { return FORBIDDEN_LABEL; },
      get LABEL_CHAR() { return LABEL_CHAR; },
      get LOGIN_LABEL() { return LOGIN_LABEL; },
      get LOOSE_OPTION_SELECTOR() { return LOOSE_OPTION_SELECTOR; },
      get MENU_SELECTOR() { return MENU_SELECTOR; },
      get OPTION_SELECTOR() { return OPTION_SELECTOR; },
      get RECIPE_FORBIDDEN_LABEL() { return RECIPE_FORBIDDEN_LABEL; },
      get REQUESTS() { return REQUESTS; },
      get SUBMENU_LABEL() { return SUBMENU_LABEL; },
      get TIER_IDS() { return TIER_IDS; },
      get config() { return config; },
      get extensionOrigin() { return extensionOrigin; },
      get provider() { return provider; },
    };
  }

  runtime.factories.createTierConfigController = createTierConfigController;
})(globalThis.PanelizeContent);
