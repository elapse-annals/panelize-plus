// Self-contained tier adapter. This script is added after the provider page's
// existing content scripts and only accepts messages from the extension frame.
(function() {
  'use strict';

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
  // Keep these candidates aligned with modules/provider-tiers.js. Matching
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
    agnes: { ...DISCOVERY_CONFIG }
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
    ['agnes', ['app.agnes-ai.com']]
  ];

  function hostMatches(host, domain) {
    return host === domain || host.endsWith(`.${domain}`);
  }

  const provider = PROVIDER_HOSTS.find(([, domains]) => domains.some(domain => hostMatches(hostname, domain)))?.[0] || null;
  const config = provider ? CONFIG[provider] : null;
  const extensionOrigin = getExtensionOrigin();
  const inFlight = new Map();
  const completed = new Map();
  let lastVerifiedSelection = null;
  let operationQueue = Promise.resolve();

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
    if (FORBIDDEN_LABEL.test(label)) return true;
    return Boolean(element.closest('form [type="submit"], [data-testid*="send"], [aria-label*="send" i], [aria-label*="agent" i]'));
  }

  function matchesAny(label, patterns = []) {
    const value = normalize(label);
    return Boolean(value) && patterns.some(pattern => {
      pattern.lastIndex = 0;
      return pattern.test(value);
    });
  }

  function matchesTier(label, tier) {
    return matchesAny(label, config?.preferredTiers?.[tier]) || matchesAny(label, config?.tiers?.[tier]);
  }

  function isEnabled(element) {
    if (!element || element.disabled || element.getAttribute('disabled') !== null) return false;
    if (element.getAttribute('aria-disabled') === 'true') return false;
    if (element.closest('[aria-disabled="true"], :disabled')) return false;
    if (/\b(locked|upgrade|subscribe|unavailable|not available|requires? plan)\b|锁定|升级套餐|暂不可用/i.test(elementLabel(element))) return false;
    return true;
  }

  function allVisible(selector, root = document) {
    try {
      return Array.from(root.querySelectorAll(selector)).filter(isVisible);
    } catch {
      return [];
    }
  }

  function isInteractive(element) {
    if (!element) return false;
    if (element.matches('button, input, select, [role="button"], [role="combobox"], [role="switch"], [role="checkbox"], [role="menuitem"], [role="menuitemradio"], [role="option"], [role="radio"], [aria-pressed], [aria-checked]')) return true;
    return element.tabIndex >= 0;
  }

  function getTriggerSelectors() {
    const models = config?.selectors || [];
    const efforts = config?.effortSelectors || [];
    // ChatGPT may expose a model picker alongside an independent strength
    // menu. Changing strength must keep using that menu after slider probing.
    return provider === 'chatgpt' ? [...efforts, ...models] : [...models, ...efforts];
  }

  function getTriggerCandidates() {
    if (!config) return [];
    const selectors = getTriggerSelectors();
    const selectorMatches = selectors.flatMap(selector => allVisible(selector));
    const genericMatches = allVisible('button, [role="button"], [role="combobox"], [aria-haspopup], [tabindex]');
    const unique = [...new Set([...selectorMatches, ...genericMatches])];
    return unique
      .map(element => ({ element, label: elementLabel(element) }))
      .filter(({ element, label }) => label && !isForbidden(element, label)
        && isInteractive(element)
        && (matchesAny(label, config.triggerLabels) || selectors.some(selector => element.matches(selector))));
  }

  function findTrigger() {
    const candidates = getTriggerCandidates();
    const currentSelected = candidates.find(({ element }) => element.getAttribute('aria-expanded') === 'true');
    if (currentSelected) return currentSelected;
    for (const selector of getTriggerSelectors()) {
      const match = candidates.find(candidate => candidate.element.matches(selector));
      if (match) return match;
    }
    return candidates[0] || null;
  }

  function getOpenMenus() {
    return allVisible(MENU_SELECTOR);
  }

  function relatedMenuRoots(trigger, roots = getOpenMenus()) {
    if (!trigger) return [];
    const controls = normalize(trigger.getAttribute('aria-controls')).split(' ').filter(Boolean);
    const controlled = controls
      .map(id => document.getElementById(id))
      .filter(root => root && isVisible(root));
    if (controlled.length) return controlled;

    const triggerId = trigger.id;
    const labelled = roots.filter(root => triggerId && (
      root.getAttribute('aria-labelledby')?.split(/\s+/).includes(triggerId)
      || root.getAttribute('data-trigger-id') === triggerId
      || root.getAttribute('aria-owner') === triggerId
    ));
    if (labelled.length) return labelled;
    if (trigger.getAttribute('aria-expanded') === 'true' && roots.length === 1) return roots;
    return [];
  }

  function getMenuOptions(roots = getOpenMenus()) {
    const options = roots.flatMap(root => [
      ...(root.matches(OPTION_SELECTOR) ? [root] : []),
      ...Array.from(root.querySelectorAll(OPTION_SELECTOR))
    ]);
    return [...new Set(options)]
      .filter(isVisible)
      .map(element => ({ element, label: elementLabel(element) }))
      .filter(({ element, label }) => label && !isForbidden(element, label));
  }

  function isSelected(element) {
    if (element.getAttribute('aria-selected') === 'true'
      || element.getAttribute('aria-checked') === 'true'
      || element.getAttribute('aria-pressed') === 'true'
      || element.getAttribute('data-state') === 'checked') return true;
    if (element instanceof HTMLInputElement && element.checked) return true;
    return false;
  }

  function getToggle() {
    if (!['toggle', 'discover'].includes(config?.strategy)) return null;
    const candidateSelectors = [...config.selectors, 'button', '[role="button"]', '[role="switch"]', '[role="checkbox"]', 'input[type="checkbox"]', 'label'];
    const candidates = [...new Set(candidateSelectors.flatMap(selector => allVisible(selector)))];
    for (const candidate of candidates) {
      const isLabel = candidate.tagName === 'LABEL';
      const control = isLabel ? candidate.control : candidate;
      const label = elementLabel(candidate);
      if (!control || !isInteractive(control) || !label || isForbidden(candidate, label)) continue;
      if (!matchesAny(label, config.toggleLabels || config.triggerLabels)) continue;
      return { element: control, label };
    }
    return null;
  }

  function readToggle(toggle = getToggle()) {
    if (!toggle) return null;
    const { element, label } = toggle;
    let enabled = null;
    if (element.getAttribute('aria-pressed') === 'true' || element.getAttribute('aria-checked') === 'true' || element.getAttribute('data-state') === 'checked') enabled = true;
    if (element.getAttribute('aria-pressed') === 'false' || element.getAttribute('aria-checked') === 'false' || element.getAttribute('data-state') === 'unchecked') enabled = false;
    if (element instanceof HTMLInputElement && element.type === 'checkbox') enabled = element.checked;
    if (enabled == null) {
      const state = normalize(element.getAttribute('aria-label') || element.textContent);
      if (/\b(on|enabled)\b|已开启|开启/i.test(state)) enabled = true;
      if (/\b(off|disabled)\b|未开启|关闭/i.test(state)) enabled = false;
    }
    return enabled == null ? null : {
      enabled,
      label: `${label} ${enabled ? 'on' : 'off'}`,
      tier: enabled ? 'deep' : 'fast',
      supportedTiers: ['fast', 'balanced', 'deep'],
      matchedTiers: enabled ? ['balanced', 'deep'] : ['fast']
    };
  }

  function tierMatchesForLabel(label) {
    const preferred = TIER_IDS.filter(tier => matchesAny(label, config?.preferredTiers?.[tier]));
    if (preferred.length) return preferred;
    return TIER_IDS.filter(tier => matchesAny(label, config?.tiers?.[tier]));
  }

  function getMenuSupport(options) {
    const support = new Set();
    const mapped = options.filter(({ element, label }) => isEnabled(element) && tierMatchesForLabel(label).length);
    for (const { label } of mapped) tierMatchesForLabel(label).forEach(tier => support.add(tier));
    // Kimi K2.6 offers Standard and Advanced without Extreme. Reuse Advanced
    // for the deep tier only when the account's visible menu has no higher item.
    const lockedDeep = options.some(({ element, label }) => !isEnabled(element) && matchesTier(label, 'deep'));
    if (provider === 'kimi' && support.has('balanced') && !support.has('deep') && !lockedDeep) support.add('deep');
    return { supportedTiers: TIER_IDS.filter(tier => support.has(tier)), mapped };
  }

  function currentMenuSelection(options) {
    return options.find(({ element }) => isSelected(element)) || null;
  }

  function matchesForCurrentLabel(label, options) {
    const matched = tierMatchesForLabel(label);
    if (provider === 'kimi' && options.length && matched.includes('balanced')) {
      const deepVisible = options.some(({ element, label: optionLabel }) => isEnabled(element)
        && matchesAny(optionLabel, config?.preferredTiers?.deep));
      const deepLocked = options.some(({ element, label: optionLabel }) => !isEnabled(element)
        && matchesAny(optionLabel, config?.preferredTiers?.deep));
      if (!deepVisible && !deepLocked) matched.push('deep');
    }
    return TIER_IDS.filter(tier => matched.includes(tier));
  }

  function readCurrentState() {
    const toggle = ['toggle', 'discover'].includes(config.strategy) ? getToggle() : null;
    if (toggle) {
      const state = readToggle(toggle);
      if (!state) return { status: 'unavailable', reason: 'toggle_state_not_readable', tier: null, actualLabel: toggle.label, supportedTiers: [], matchedTiers: [] };
      if (!isEnabled(toggle.element)) return { status: 'unavailable', reason: 'toggle_disabled', tier: state.tier, actualLabel: state.label, supportedTiers: [], matchedTiers: [] };
      return { status: 'success', reason: null, tier: state.tier, actualLabel: state.label, supportedTiers: state.supportedTiers, matchedTiers: state.matchedTiers };
    }

    const trigger = findTrigger();
    const options = getMenuOptions();
    const selected = currentMenuSelection(options) || null;
    const triggerLabel = trigger?.label || '';
    const effortLabel = getCurrentEffortLabel(trigger, options);
    const currentLabel = effortLabel || selected?.label || triggerLabel;
    const currentTiers = effortLabel
      ? TIER_IDS.filter(tier => matchesAny(effortLabel, config?.preferredTiers?.[tier]))
      : tierMatchesForLabel(currentLabel);
    // For Claude and Gemini, a model name is not evidence of the active
    // reasoning level. Only a separately readable effort setting can confirm
    // a current tier. The model fallback is available only immediately after
    // this adapter itself selected and verified that model.
    const requiresEffortEvidence = ['claude', 'gemini'].includes(provider);
    const modelFallback = requiresEffortEvidence && !effortLabel;
    const menuSupport = getMenuSupport(options).supportedTiers;
    const supportedTiers = menuSupport.length ? menuSupport : currentTiers;
    if (!trigger && !selected) {
      if (hasLoginGate()) return { status: 'unavailable', reason: 'not_logged_in', tier: null, actualLabel: null, supportedTiers: [], matchedTiers: [] };
      if (config.strategy === 'discover') return { status: 'unsupported', reason: 'no_detectable_tier_control', tier: null, actualLabel: null, supportedTiers: [], matchedTiers: [] };
      return { status: 'unavailable', reason: 'selector_not_visible', tier: null, actualLabel: null, supportedTiers: [], matchedTiers: [] };
    }
    if (trigger && !isEnabled(trigger.element)) {
      return { status: 'unavailable', reason: 'selector_disabled', tier: currentTiers[0] || null, actualLabel: currentLabel || null, supportedTiers: [], matchedTiers: [] };
    }
    const remembered = modelFallback && lastVerifiedSelection?.mappingPath === 'model'
      && lastVerifiedSelection?.provider === provider && lastVerifiedSelection.rawLabel === currentLabel
      ? lastVerifiedSelection
      : null;
    const currentTier = effortLabel
      ? currentTiers[0] || null
      : remembered?.tier || (modelFallback ? null : currentTiers[0] || null);
    if (!currentTier) {
      return {
        status: 'unavailable',
        reason: 'current_tier_unknown',
        tier: null,
        actualLabel: remembered?.actualLabel || (modelFallback ? `Model: ${currentLabel}` : currentLabel) || null,
        supportedTiers: remembered?.supportedTiers || supportedTiers,
        matchedTiers: []
      };
    }
    return {
      status: 'success',
      reason: options.length ? null : 'options_not_visible',
      tier: currentTier,
      actualLabel: remembered?.actualLabel || (modelFallback ? `Model: ${currentLabel}` : currentLabel) || null,
      supportedTiers: remembered?.supportedTiers || supportedTiers,
      matchedTiers: remembered?.matchedTiers || matchesForCurrentLabel(currentLabel, options)
    };
  }

  function isThinkingSlider(element) {
    if (!element || !(element.matches('input[type="range"], [role="slider"]'))) return false;
    const labelledBy = normalize(element.getAttribute('aria-labelledby')).split(' ').filter(Boolean)
      .map(id => elementLabel(document.getElementById(id)))
      .join(' ');
    const directLabel = normalize(element.getAttribute('aria-label') || element.getAttribute('title') || labelledBy);
    if (matchesAny(directLabel, config?.sliderLabels)) return true;
    for (let ancestor = element.parentElement, depth = 0; ancestor && ancestor !== document.body && depth < 6; ancestor = ancestor.parentElement, depth++) {
      const label = normalize(ancestor.innerText || ancestor.textContent);
      if (label.length <= 180 && matchesAny(label, config?.sliderLabels)) return true;
    }
    return false;
  }

  function findThinkingSlider() {
    if (!config?.sliderLabels?.length) return null;
    const visibleSliders = allVisible('input[type="range"], [role="slider"]');
    return visibleSliders.find(isThinkingSlider) || null;
  }

  function findThinkingSliderTrigger() {
    if (!config?.sliderLabels?.length) return null;
    const selectors = config.effortSelectors || [];
    const elements = [...new Set([
      ...selectors.flatMap(selector => allVisible(selector)),
      ...allVisible('button, [role="button"], [aria-haspopup], [aria-expanded]')
    ])];
    return elements.map(element => ({ element, label: elementLabel(element) }))
      .find(({ element, label }) => label && !isForbidden(element, label)
        && isInteractive(element) && matchesAny(label, config.sliderLabels)) || null;
  }

  function sliderBounds(slider) {
    if (!slider) return null;
    const nativeRange = slider instanceof HTMLInputElement && slider.type === 'range';
    const parse = (attribute, fallback) => {
      const value = slider.getAttribute(attribute);
      return value !== null && value.trim() ? Number(value) : fallback;
    };
    const min = parse('aria-valuemin', parse('min', nativeRange ? 0 : null));
    const max = parse('aria-valuemax', parse('max', nativeRange ? 100 : null));
    const value = parse('aria-valuenow', nativeRange ? Number(slider.value) : null);
    const step = parse('aria-valuestep', parse('step', 1));
    if (![min, max, value, step].every(Number.isFinite) || max <= min || step <= 0) return null;
    const intervals = Math.round((max - min) / step);
    if (intervals < 1) return null;
    const levels = intervals + 1;
    if (levels < 3) {
      return { min, max, value, step, levels, stops: [{ tier: 'fast', value: min }, { tier: 'deep', value: max }] };
    }
    const middleIndex = Math.round(intervals / 2);
    const stops = [
      { tier: 'fast', value: min },
      { tier: 'balanced', value: min + middleIndex * step },
      { tier: 'deep', value: min + intervals * step }
    ];
    return { min, max, value, step, levels, stops };
  }

  function sliderTier(slider) {
    if (!slider) return null;
    const labelledTier = sliderLabelTier(slider);
    const bounds = sliderBounds(slider);
    const tolerance = bounds ? Math.max(bounds.step / 2, (bounds.max - bounds.min) * 0.01) : 0;
    const numericTier = bounds
      ? bounds.stops.find(stop => Math.abs(stop.value - bounds.value) <= tolerance)?.tier || null
      : null;
    if (labelledTier && numericTier && labelledTier !== numericTier) return null;
    return labelledTier || numericTier;
  }

  function sliderLabelTier(slider) {
    if (!slider) return null;
    const valueText = normalize(slider.getAttribute('aria-valuetext') || slider.getAttribute('data-value-label'));
    const valueTier = TIER_IDS.find(tier => matchesAny(valueText, config?.tiers?.[tier]));
    if (valueTier) return valueTier;
    const trigger = findThinkingSliderTrigger();
    return trigger ? TIER_IDS.find(tier => matchesTier(trigger.label, tier)) || null : null;
  }

  function sliderState(slider) {
    if (!slider) return null;
    const bounds = sliderBounds(slider);
    const tier = sliderTier(slider);
    if (!bounds) return { status: 'unavailable', reason: 'slider_range_not_readable', tier: null, actualLabel: null, supportedTiers: [], matchedTiers: [] };
    const supportedTiers = bounds.stops.map(stop => stop.tier);
    const actualLabel = normalize(slider.getAttribute('aria-valuetext')) || findThinkingSliderTrigger()?.label || `思考强度 ${bounds.value}`;
    if (!tier) return { status: 'unavailable', reason: 'current_tier_unknown', tier: null, actualLabel, supportedTiers, matchedTiers: [] };
    return { status: 'success', reason: null, tier, actualLabel, supportedTiers, matchedTiers: [tier] };
  }

  async function readThinkingSliderState({ openIfNeeded = false } = {}) {
    let slider = findThinkingSlider();
    const trigger = findThinkingSliderTrigger();
    let openedByUs = false;
    try {
      if (!slider && trigger && openIfNeeded && isEnabled(trigger.element)) {
        trigger.element.click();
        openedByUs = true;
        slider = await waitFor(findThinkingSlider, 700, 35);
      }
      if (slider) return sliderState(slider);
      if (trigger) {
        return {
          status: 'unavailable',
          reason: isEnabled(trigger.element) ? 'slider_not_visible' : 'slider_disabled',
          tier: null,
          actualLabel: trigger.label || null,
          supportedTiers: [],
          matchedTiers: []
        };
      }
      return null;
    } finally {
      if (openedByUs) closeMenuIfOpened(true);
    }
  }

  function dispatchRangeInput(slider, value) {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(slider), 'value')?.set;
    if (setter) setter.call(slider, String(value));
    else slider.value = String(value);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function setAccessibleSliderValue(slider, target, bounds) {
    const deadline = Date.now() + 3000;
    const tolerance = Math.max(bounds.step / 2, (bounds.max - bounds.min) * 0.01);
    if (Math.abs(bounds.value - target.value) <= tolerance) return slider;
    const originalActiveElement = document.activeElement;
    const dispatchKey = (element, key) => {
      element.focus();
      element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      element.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }));
    };
    let current = slider;
    let currentBounds = bounds;
    try {
      const endpointKey = target.value === bounds.min ? 'Home' : target.value === bounds.max ? 'End' : null;
      if (endpointKey) {
        dispatchKey(current, endpointKey);
        const updated = await waitFor(() => {
          const candidate = findThinkingSlider();
          const value = sliderBounds(candidate)?.value;
          return candidate && value !== currentBounds.value ? candidate : null;
        }, Math.min(100, Math.max(0, deadline - Date.now())), 10);
        if (updated) {
          current = updated;
          currentBounds = sliderBounds(current);
          if (!currentBounds) return null;
        }
      }

      const delta = Math.round((target.value - currentBounds.value) / currentBounds.step);
      if (delta === 0) return current;
      if (Math.abs(delta) > 128) return null;
      const key = delta > 0 ? 'ArrowRight' : 'ArrowLeft';
      for (let index = 0; index < Math.abs(delta); index++) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) return null;
        const previous = currentBounds.value;
        dispatchKey(current, key);
        const updated = await waitFor(() => {
          const candidate = findThinkingSlider();
          const value = sliderBounds(candidate)?.value;
          return candidate && value !== previous ? candidate : null;
        }, Math.min(100, remaining), 10);
        if (!updated) return null;
        current = updated;
        currentBounds = sliderBounds(current);
        if (!currentBounds) return null;
      }
      return Math.abs(currentBounds.value - target.value) <= tolerance ? current : null;
    } finally {
      const activeElement = document.activeElement;
      if (activeElement === current && current?.isConnected && current.matches('[role="slider"]')
        && originalActiveElement?.isConnected && originalActiveElement !== document.body
        && typeof originalActiveElement.focus === 'function') {
        originalActiveElement.focus();
      }
    }
  }

  async function setThinkingSliderTier(tier) {
    let slider = findThinkingSlider();
    const trigger = findThinkingSliderTrigger();
    let openedByUs = false;
    try {
      if (!slider && trigger && isEnabled(trigger.element)) {
        trigger.element.click();
        openedByUs = true;
        slider = await waitFor(findThinkingSlider, 700, 35);
      }
      if (!slider) {
        return {
          status: trigger && !isEnabled(trigger.element) ? 'unavailable' : 'unsupported',
          reason: trigger && !isEnabled(trigger.element) ? 'selector_disabled' : 'slider_not_visible',
          tier: null, requestedTier: tier, actualLabel: trigger?.label || null,
          supportedTiers: [], matchedTiers: []
        };
      }

      const bounds = sliderBounds(slider);
      if (!bounds) return { status: 'unavailable', reason: 'slider_range_not_readable', tier: null, requestedTier: tier, actualLabel: null, supportedTiers: [], matchedTiers: [] };
      const target = bounds.stops.find(stop => stop.tier === tier);
      const supportedTiers = bounds.stops.map(stop => stop.tier);
      if (!isEnabled(slider)) {
        return { status: 'unavailable', reason: 'slider_disabled', tier: null, requestedTier: tier, actualLabel: slider.getAttribute('aria-valuetext') || null, supportedTiers, matchedTiers: [] };
      }
      if (!target) {
        return { status: 'unsupported', reason: 'tier_unavailable', tier: null, requestedTier: tier, actualLabel: null, supportedTiers, matchedTiers: [] };
      }
      const tolerance = Math.max(bounds.step / 2, (bounds.max - bounds.min) * 0.01);
      let sliderToVerify = slider;
      if (Math.abs(bounds.value - target.value) > tolerance) {
        if (slider instanceof HTMLInputElement && slider.type === 'range') {
          dispatchRangeInput(slider, target.value);
        } else if (slider.matches('[role="slider"]')) {
          sliderToVerify = await setAccessibleSliderValue(slider, target, bounds);
        }
        if (!sliderToVerify) {
          return { status: 'unavailable', reason: 'slider_not_writable', tier: null, requestedTier: tier, actualLabel: null, supportedTiers, matchedTiers: [] };
        }
      }
      // Let React or another UI framework process its input event and replace
      // the slider before reading back the value. Checking the mutated input
      // immediately can mistake a DOM-only change for an applied setting.
      await new Promise(resolve => setTimeout(resolve, 90));
      const verified = await waitFor(() => {
        const current = findThinkingSlider();
        const value = sliderBounds(current)?.value;
        const labelTier = sliderLabelTier(current);
        return current && Math.abs(value - target.value) <= tolerance
          && sliderTier(current) === tier && (!labelTier || labelTier === tier) ? current : null;
      }, 1100, 50);
      if (!verified) return { status: 'error', reason: 'verification_failed', tier: null, requestedTier: tier, actualLabel: null, supportedTiers, matchedTiers: [] };
      const state = sliderState(verified);
      return { ...state, requestedTier: tier };
    } finally {
      if (openedByUs) closeMenuIfOpened(true);
    }
  }

  function getCurrentEffortLabel(modelTrigger, menuOptions) {
    if (!['claude', 'gemini'].includes(provider)) return null;

    for (const selector of config?.effortSelectors || []) {
      const indicator = allVisible(selector).find(element => !isForbidden(element, elementLabel(element)));
      const accessible = normalize(indicator?.getAttribute('aria-label') || indicator?.getAttribute('title'));
      const label = accessible && /(effort|thinking level|reasoning level|思考强度|推理强度)/i.test(accessible)
        ? accessible
        : elementLabel(indicator);
      if (label && TIER_IDS.some(tier => matchesAny(label, config?.preferredTiers?.[tier]))) {
        return label;
      }
    }

    // A checked Low/Medium/High item counts only inside a menu rooted at the
    // visible Effort/Thinking control. A checked model option with a similar
    // label never stands in for reasoning strength.
    const roots = getOpenMenus();
    const effortControls = menuOptions.filter(({ label }) => matchesAny(label, config?.submenuLabels));
    const selectedEffort = menuOptions.find(({ element, label }) => isSelected(element)
      && TIER_IDS.some(tier => matchesAny(label, config?.preferredTiers?.[tier])));
    if (selectedEffort) {
      const selectedRoot = roots.find(root => root === selectedEffort.element || root.contains(selectedEffort.element));
      if (selectedRoot && effortControls.some(({ element }) => relatedMenuRoots(element, roots).includes(selectedRoot))) {
        return selectedEffort.label;
      }

      const labelledBy = (selectedRoot?.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
      if (labelledBy.some(id => {
        const labelElement = document.getElementById(id);
        return labelElement && matchesAny(elementLabel(labelElement), config?.submenuLabels);
      })) {
        return selectedEffort.label;
      }
    }

    // Some pages expose the active model and effort in one accessible picker
    // label. Require an explicit effort word along with the selected level.
    const triggerLabel = modelTrigger?.label || '';
    if (/(effort|thinking level|reasoning level|思考强度|推理强度)/i.test(triggerLabel)
      && TIER_IDS.some(tier => matchesAny(triggerLabel, config?.preferredTiers?.[tier]))) {
      return triggerLabel;
    }
    return null;
  }

  // A model-only fallback is verified by this script, but it cannot observe
  // an external effort change on the same model. Drop that cache as soon as
  // the user interacts with the provider page.
  function invalidateModelFallback() {
    if (lastVerifiedSelection?.mappingPath === 'model') lastVerifiedSelection = null;
  }

  document.addEventListener('click', invalidateModelFallback, true);
  document.addEventListener('change', invalidateModelFallback, true);

  function hasLoginGate() {
    if (document.querySelector('[contenteditable="true"], [role="textbox"], textarea')) return false;
    if (document.querySelector('input[type="password"], [data-testid*="login" i], [data-testid*="sign-in" i]')) return true;
    const bodyText = normalize(document.body?.innerText || document.body?.textContent).slice(0, 5000);
    if (/sign in to continue|log in to continue|登录后继续|请先登录/i.test(bodyText)) return true;
    return Array.from(document.querySelectorAll('button, a, [role="button"]')).some(element => isVisible(element) && LOGIN_LABEL.test(elementLabel(element)));
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

  async function openMenu(trigger = findTrigger(), { optionFallback = false } = {}) {
    if (!trigger) return { error: 'selector_not_visible' };
    if (!isEnabled(trigger.element)) return { error: 'selector_disabled' };
    const currentRoots = getOpenMenus();
    const associatedRoots = relatedMenuRoots(trigger.element, currentRoots);
    if (associatedRoots.length) {
      const options = getMenuOptions(associatedRoots);
      return options.length ? { roots: associatedRoots, options, openedByUs: false } : { error: 'menu_empty' };
    }
    if (currentRoots.length) return { error: 'unrelated_menu_visible' };

    const rootsBefore = new Set(currentRoots);
    const optionsBefore = optionFallback ? new Set(visibleOptionCandidates()) : null;
    trigger.element.click();
    const roots = await waitFor(() => {
      const currentRootsAfterClick = getOpenMenus();
      const controlled = relatedMenuRoots(trigger.element, currentRootsAfterClick);
      if (controlled.length) return controlled;
      const added = currentRootsAfterClick.filter(root => !rootsBefore.has(root));
      if (added.length === 1) return added;
      if (trigger.element.getAttribute('aria-expanded') === 'true' && currentRootsAfterClick.length === 1) return currentRootsAfterClick;
      return null;
    }, optionFallback ? 700 : 1400);
    if (!roots && optionsBefore) {
      // Popovers without a menu role: the options are what the click revealed.
      const options = await waitFor(() => {
        const added = outermost(visibleOptionCandidates().filter(element => !optionsBefore.has(element)));
        return added.length ? added : null;
      }, 700);
      return options
        ? { roots: [], options: options.map(element => ({ element, label: elementLabel(element) })).filter(({ label }) => label), openedByUs: true }
        : { error: 'menu_timeout' };
    }
    if (!roots) return { error: 'menu_timeout' };
    const options = getMenuOptions(roots);
    return options.length ? { roots, options, openedByUs: true } : { error: 'menu_empty' };
  }

  function closeMenuIfOpened(openedByUs) {
    if (!openedByUs) return;
    const active = document.activeElement || document.body;
    active.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }

  function optionForTier(options, tier) {
    const enabled = options.filter(({ element }) => isEnabled(element));
    const lockedPreferred = options.find(({ element, label }) => !isEnabled(element)
      && matchesAny(label, config?.preferredTiers?.[tier]));
    if (lockedPreferred) return { ...lockedPreferred, locked: true };
    const locked = options.find(({ element, label }) => !isEnabled(element) && matchesTier(label, tier));
    if (locked) return { ...locked, locked: true };
    let selected = enabled.find(({ label }) => matchesAny(label, config?.preferredTiers?.[tier]));
    const usedPreferred = Boolean(selected);
    if (!selected) selected = enabled.find(({ label }) => matchesTier(label, tier));
    if (!selected && provider === 'kimi' && tier === 'deep') {
      selected = enabled.find(({ label }) => matchesTier(label, 'balanced'));
    }
    if (!selected) return null;
    const matchedTiers = matchesForCurrentLabel(selected.label, options);
    const mappingPath = ['claude', 'gemini'].includes(provider)
      ? (usedPreferred ? 'effort' : 'model')
      : config?.preferredTiers ? 'effort' : 'mode';
    return { ...selected, matchedTiers, shared: matchedTiers.length > 1, mappingPath };
  }

  function findSubmenuTrigger(options) {
    if (!config?.submenuLabels?.length) return null;
    return options.find(({ element, label }) => isEnabled(element) && matchesAny(label, config.submenuLabels)) || null;
  }

  async function openTierMenu(tier) {
    const opened = await openMenu();
    if (!opened || opened.error) return opened;
    const preferredVisible = options => options.some(({ element, label }) => isEnabled(element)
      && matchesAny(label, config?.preferredTiers?.[tier]));
    const directOption = optionForTier(opened.options, tier);
    const submenu = findSubmenuTrigger(opened.options);
    const shouldOpenSubmenu = submenu && !preferredVisible(opened.options)
      && (config?.preferredTiers || !directOption);
    if (!shouldOpenSubmenu) return opened;

    const previousRoots = new Set(getOpenMenus());
    const previousLabels = new Map(opened.options.map(option => [option.element, option.label]));
    submenu.element.click();
    const submenuRoots = await waitFor(() => {
      const roots = getOpenMenus();
      const controlled = relatedMenuRoots(submenu.element, roots);
      if (controlled.length) return controlled;
      const added = roots.filter(root => !previousRoots.has(root));
      if (added.length === 1) return added;
      if (added.length > 1) {
        const labelled = added.filter(root => root.getAttribute('aria-labelledby') === submenu.element.id);
        if (labelled.length === 1) return labelled;
      }
      return null;
    }, 900);
    if (!submenuRoots) return { error: 'submenu_not_detected' };
    const newOptions = getMenuOptions(submenuRoots).filter(option => !previousLabels.has(option.element)
      || previousLabels.get(option.element) !== option.label);
    const scopedOptions = newOptions.length ? newOptions : getMenuOptions(submenuRoots);
    return {
      roots: submenuRoots,
      options: scopedOptions,
      openedByUs: true
    };
  }

  function labelMatchesTierPath(label, tier, mappingPath = 'mode') {
    if (mappingPath === 'effort') return matchesAny(label, config?.preferredTiers?.[tier]);
    if (mappingPath === 'model') {
      const preferred = TIER_IDS.some(candidate => matchesAny(label, config?.preferredTiers?.[candidate]));
      return !preferred && matchesAny(label, config?.tiers?.[tier]);
    }
    return tierMatchesForLabel(label).includes(tier);
  }

  function selectionLabelForTier(tier, mappingPath = 'mode') {
    const toggle = readToggle();
    if (toggle) return toggle.matchedTiers.includes(tier) ? toggle.label : null;
    const options = getMenuOptions();
    const selected = currentMenuSelection(options);
    const trigger = findTrigger();
    const label = selected?.label || trigger?.label || '';
    if (labelMatchesTierPath(label, tier, mappingPath)) return label;
    if (provider === 'kimi' && tier === 'deep' && matchesTier(label, 'balanced') && mappingPath !== 'model') return label;
    return null;
  }

  async function verifyTier(tier, openedMenuByUs, mappingPath = 'mode') {
    let actualLabel = selectionLabelForTier(tier, mappingPath);
    if (actualLabel) return actualLabel;
    closeMenuIfOpened(openedMenuByUs);

    const opened = await openTierMenu(tier);
    if (!opened || opened.error) return null;
    const selected = currentMenuSelection(opened.options);
    const selectedLabel = selected?.label || selectionLabelForTier(tier, mappingPath);
    const actualMatches = selectedLabel && (
      labelMatchesTierPath(selectedLabel, tier, mappingPath)
      || (provider === 'kimi' && tier === 'deep' && matchesTier(selectedLabel, 'balanced') && !getMenuSupport(opened.options).supportedTiers.includes('deep'))
    );
    closeMenuIfOpened(opened.openedByUs);
    return actualMatches ? selectedLabel : null;
  }

  function responseFor(data, responseType, result) {
    const matchedTiers = Array.isArray(result.matchedTiers)
      ? result.matchedTiers.filter(tier => TIER_IDS.includes(tier))
      : result.status === 'success' && TIER_IDS.includes(result.tier) ? [result.tier] : [];
    return {
      type: responseType,
      requestId: data.requestId,
      context: 'multi-panel',
      provider,
      tier: result.tier ?? null,
      requestedTier: result.requestedTier ?? (data.type === 'SET_PROVIDER_TIER' ? data.tier : null),
      actualLabel: result.actualLabel ?? null,
      supportedTiers: Array.isArray(result.supportedTiers) ? result.supportedTiers.filter(tier => TIER_IDS.includes(tier)) : [],
      matchedTiers,
      status: result.status,
      ...(result.reason ? { reason: result.reason } : {})
    };
  }

  function postResponse(message) {
    if (!extensionOrigin || window.parent === window) return;
    try {
      window.parent.postMessage(message, extensionOrigin);
    } catch {
      // A navigation may have replaced the extension host while the request ran.
    }
  }

  async function setToggleTier(tier) {
    const toggle = getToggle();
    if (!toggle) {
      const loginGate = hasLoginGate();
      return { status: loginGate ? 'unavailable' : 'unsupported', reason: loginGate ? 'not_logged_in' : 'toggle_not_visible', tier: null, requestedTier: tier, actualLabel: null, supportedTiers: [] };
    }
    if (!isEnabled(toggle.element)) return { status: 'unavailable', reason: 'toggle_disabled', tier: null, requestedTier: tier, actualLabel: toggle.label, supportedTiers: [] };
    const shouldEnable = tier !== 'fast';
    const state = readToggle(toggle);
    if (!state) return { status: 'unavailable', reason: 'toggle_state_not_readable', tier: null, requestedTier: tier, actualLabel: toggle.label, supportedTiers: [] };
    if (state.enabled !== shouldEnable) toggle.element.click();
    const verified = await waitFor(() => {
      const current = readToggle(getToggle());
      return current && current.enabled === shouldEnable ? current : null;
    }, 1100);
    if (!verified) return { status: 'error', reason: 'verification_failed', tier: null, requestedTier: tier, actualLabel: null, supportedTiers: ['fast', 'balanced', 'deep'] };
    const label = `${verified.label}${verified.matchedTiers.length > 1 ? ' (balanced/deep share this toggle)' : ''}`;
    return {
      status: 'success',
      reason: null,
      tier: verified.tier,
      requestedTier: tier,
      actualLabel: label,
      supportedTiers: verified.supportedTiers,
      matchedTiers: verified.matchedTiers
    };
  }

  async function setMenuTier(tier) {
    const opened = await openTierMenu(tier);
    if (!opened || opened.error) {
      if (hasLoginGate()) return { status: 'unavailable', reason: 'not_logged_in', tier: null, requestedTier: tier, actualLabel: null, supportedTiers: [], matchedTiers: [] };
      if (opened?.error === 'selector_disabled') return { status: 'unavailable', reason: opened.error, tier: null, requestedTier: tier, actualLabel: findTrigger()?.label || null, supportedTiers: [], matchedTiers: [] };
      if (opened?.error === 'selector_not_visible' && config.strategy === 'discover') return { status: 'unsupported', reason: 'no_detectable_tier_control', tier: null, requestedTier: tier, actualLabel: null, supportedTiers: [], matchedTiers: [] };
      if (opened?.error === 'selector_not_visible') return { status: 'unavailable', reason: opened.error, tier: null, requestedTier: tier, actualLabel: null, supportedTiers: [], matchedTiers: [] };
      if (opened?.error === 'unrelated_menu_visible') return { status: 'unavailable', reason: opened.error, tier: null, requestedTier: tier, actualLabel: null, supportedTiers: [], matchedTiers: [] };
      return { status: 'timeout', reason: 'menu_timeout', tier: null, requestedTier: tier, actualLabel: null, supportedTiers: [], matchedTiers: [] };
    }

    const support = getMenuSupport(opened.options).supportedTiers;
    const option = optionForTier(opened.options, tier);
    if (!option || option.locked || !isEnabled(option.element)) {
      closeMenuIfOpened(opened.openedByUs);
      const matching = opened.options.find(({ label }) => matchesTier(label, tier));
      return {
        status: matching ? 'unavailable' : 'unsupported',
        reason: matching ? 'option_locked' : 'tier_unavailable',
        tier: null,
        requestedTier: tier,
        actualLabel: matching?.label || null,
        supportedTiers: support,
        matchedTiers: []
      };
    }

    const alreadySelected = isSelected(option.element) && matchesTier(option.label, tier);
    if (!alreadySelected) option.element.click();
    let actualLabel = await waitFor(() => selectionLabelForTier(tier, option.mappingPath), 1300, 70);
    if (!actualLabel) actualLabel = await verifyTier(tier, opened.openedByUs, option.mappingPath);
    if (!actualLabel) {
      closeMenuIfOpened(opened.openedByUs);
      return { status: 'error', reason: 'verification_failed', tier: null, requestedTier: tier, actualLabel: null, supportedTiers: support, matchedTiers: [] };
    }
    closeMenuIfOpened(opened.openedByUs);
    const matchedTiers = option.matchedTiers || matchesForCurrentLabel(option.label, opened.options);
    const actualTier = matchedTiers[0] || tier;
    const shared = matchedTiers.length > 1;
    const pathLabel = option.mappingPath === 'model' ? `Model: ${actualLabel} (tier fallback)` : actualLabel;
    const actualLabelWithMapping = shared ? `${pathLabel} (shared mapping: ${matchedTiers.join('/')})` : pathLabel;
    lastVerifiedSelection = {
      provider,
      rawLabel: option.label,
      mappingPath: option.mappingPath,
      tier: actualTier,
      actualLabel: actualLabelWithMapping,
      supportedTiers: support,
      matchedTiers
    };
    return {
      status: 'success',
      reason: null,
      tier: actualTier,
      requestedTier: tier,
      actualLabel: actualLabelWithMapping,
      supportedTiers: support,
      matchedTiers
    };
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

  function lower(value) {
    return normalize(value).toLowerCase();
  }

  function labelAlternatives(label) {
    return String(label || '').split('|').map(lower).filter(Boolean);
  }

  /**
   * 3 = whole label, 2 = label starts the text, 1 = label inside the text.
   * A label must not run into a neighbouring word of the same script, so
   * "Qwen3.7" never matches "Qwen3.7-Max", "hy3" never matches "hy3-preview"
   * and "高" never matches "高级推理", while "极致" still matches "GLM-Flash极致".
   */
  function labelScore(text, label) {
    const value = lower(text);
    let best = 0;
    for (const alternative of labelAlternatives(label)) {
      if (value === alternative) return 3;
      let index = value.indexOf(alternative);
      while (index !== -1) {
        const before = value[index - 1];
        const after = value[index + alternative.length];
        const leftOk = index === 0 || !joins(alternative[0], before);
        const rightOk = after === undefined || !joins(alternative.at(-1), after);
        if (leftOk && rightOk) {
          best = Math.max(best, index === 0 ? 2 : 1);
          break;
        }
        index = value.indexOf(alternative, index + 1);
      }
    }
    return best;
  }

  function joins(edge, neighbour) {
    if (ASCII_WORD.test(edge)) return LABEL_CHAR.test(neighbour);
    if (CJK_CHAR.test(edge)) return CJK_CHAR.test(neighbour);
    return false;
  }

  function normalizeRecipes(value) {
    if (!value || typeof value !== 'object') return null;
    const recipes = {};
    for (const tier of TIER_IDS) {
      const steps = Array.isArray(value[tier]) ? value[tier] : [];
      recipes[tier] = steps.slice(0, 4).map(item => {
        if (!item || typeof item !== 'object' || !['model', 'thinking', 'toggle'].includes(item.kind)) return null;
        const label = typeof item.label === 'string' ? item.label.trim().slice(0, 120) : '';
        if (!label) return null;
        return item.kind === 'toggle' ? { kind: 'toggle', label, on: item.on === true } : { kind: item.kind, label };
      }).filter(Boolean);
    }
    return recipes;
  }

  function kindLabels(recipes, kind) {
    return [...new Set(TIER_IDS.flatMap(tier => (recipes[tier] || [])
      .filter(item => item.kind === kind)
      .map(item => item.label)))];
  }

  /** A step shows in `text` unless a different label of the same kind fits better. */
  function stepShownIn(text, step, recipes) {
    if (!text) return false;
    const score = labelScore(text, step.label);
    if (!score) return false;
    return !kindLabels(recipes, step.kind)
      .some(label => lower(label) !== lower(step.label) && labelScore(text, label) > score);
  }

  function isRecipeForbidden(element, label) {
    if (RECIPE_FORBIDDEN_LABEL.test(label)) return true;
    return Boolean(element.closest('form [type="submit"], [data-testid*="send"], [aria-label*="send" i], [aria-label*="发送"]'));
  }

  function isInsideOpenMenu(element) {
    return getOpenMenus().some(root => root !== element && root.contains(element));
  }

  function visibleOptionCandidates() {
    return allVisible(LOOSE_OPTION_SELECTOR).filter(element => normalize(elementLabel(element)).length <= 80);
  }

  function outermost(elements) {
    const set = new Set(elements);
    return elements.filter(element => {
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (set.has(parent)) return false;
      }
      return true;
    });
  }

  function isChosen(element) {
    if (isSelected(element)) return true;
    return Array.from(element.classList || []).some(name => /^(selected|checked|active|is-selected|is-checked|is-active)$|--(selected|checked|active)$/i.test(name));
  }

  function findStepTrigger(kind, recipes) {
    const selectors = kind === 'model' ? config.modelSelectors : config.thinkingSelectors;
    for (const selector of selectors || []) {
      const element = allVisible(selector).find(candidate => !isInsideOpenMenu(candidate));
      if (element) return { element, label: stepTriggerLabel(kind, element) };
    }
    // Without a known selector, only popup buttons showing one of the
    // recipe's labels qualify, so no ordinary page button is ever clicked.
    const labels = kindLabels(recipes, kind);
    if (!labels.length) return null;
    return allVisible('button[aria-haspopup], [role="button"][aria-haspopup], [role="combobox"], button[aria-expanded], [role="button"][aria-expanded]')
      .filter(element => !isInsideOpenMenu(element) && isInteractive(element))
      .map(element => ({ element, label: elementLabel(element) }))
      .find(({ element, label }) => label && label.length <= 60 && !isRecipeForbidden(element, label)
        && labels.some(candidate => labelScore(label, candidate) > 0)) || null;
  }

  function stepTriggerLabel(kind, element) {
    const attribute = kind === 'model' ? config.modelAttribute : null;
    const value = attribute ? element.getAttribute(attribute.name) || '' : '';
    return attribute?.labels.find(([pattern]) => pattern.test(value))?.[1] || elementLabel(element);
  }

  function thinkingTrigger(recipes) {
    return findStepTrigger('thinking', recipes) || findStepTrigger('model', recipes);
  }

  function isKnownToggle(element) {
    return (config.toggleSelectors || []).some(selector => element.matches(selector));
  }

  function findRecipeToggle(step) {
    const candidates = [...new Set([...(config.toggleSelectors || []), 'button', '[role="button"]', '[role="switch"]', '[role="checkbox"]', 'input[type="checkbox"]', 'label']
      .flatMap(selector => allVisible(selector)))];
    for (const candidate of candidates) {
      const control = candidate.tagName === 'LABEL' ? candidate.control : candidate;
      const label = elementLabel(candidate);
      if (!control || !(isKnownToggle(control) || isInteractive(control)) || !label || label.length > 40 || isRecipeForbidden(candidate, label)) continue;
      if (labelScore(label, step.label) > 0) return { element: control, label };
    }
    return null;
  }

  function readRecipeToggle(toggle) {
    const state = readToggle(toggle);
    if (state) return state.enabled;
    const classes = Array.from(toggle.element.classList || []);
    if (classes.some(name => /--(selected|active|checked|on)$|^(selected|active|checked|is-active|is-selected)$|_(selected|active|checked)__/i.test(name))) return true;
    if (isKnownToggle(toggle.element) || classes.some(name => /toggle|switch/i.test(name))) return false;
    return null;
  }

  function closeOpenedMenus(opened) {
    if (!opened?.openedByUs) return;
    closeMenuIfOpened(true);
  }

  function pickOption(options, label, { excludeSubmenus = true } = {}) {
    let best = null;
    let bestScore = 0;
    for (const option of options) {
      if (excludeSubmenus && SUBMENU_LABEL.test(option.label)) continue;
      const score = labelScore(option.label, label);
      if (score > bestScore) {
        best = option;
        bestScore = score;
      }
    }
    return best;
  }

  async function openSubmenu(row, previousOptions, previousRoots) {
    const previous = new Map(previousOptions.map(option => [option.element, option.label]));
    const initialRoots = new Set(previousRoots);
    const before = new Set(visibleOptionCandidates());
    row.element.click();

    const roots = await waitFor(() => {
      const visibleRoots = getOpenMenus();
      const controlled = relatedMenuRoots(row.element, visibleRoots)
        .filter(root => !previousRoots.includes(root));
      if (controlled.length === 1) return controlled;

      const added = visibleRoots.filter(root => !initialRoots.has(root));
      if (added.length === 1) return added;
      if (added.length > 1 && row.element.id) {
        const labelled = added.filter(root => (root.getAttribute('aria-labelledby') || '')
          .split(/\s+/).includes(row.element.id));
        if (labelled.length === 1) return labelled;
      }
      return null;
    }, 900);

    if (roots?.length === 1) {
      const options = getMenuOptions(roots);
      const newlyAdded = options.filter(option => !previous.has(option.element)
        || previous.get(option.element) !== option.label);
      return newlyAdded.length ? newlyAdded : options;
    }

    // A framework may reuse the containing menu node for a nested picker.
    // Read only options newly rendered inside that same associated root.
    const containingRoot = previousRoots.find(root => root.contains(row.element));
    if (containingRoot) {
      const options = getMenuOptions([containingRoot]);
      const newlyAdded = options.filter(option => !previous.has(option.element)
        || previous.get(option.element) !== option.label);
      if (newlyAdded.length) return newlyAdded;
    }

    // Roleless nested popovers are accepted only when their new options share
    // one identifiable menu/list container. If unrelated menus appear at the
    // same time, the selection is ambiguous and the step fails closed.
    const addedCandidates = visibleOptionCandidates().filter(element => !before.has(element));
    const addedContainers = [...new Set(addedCandidates.map(element => {
      let current = element.parentElement;
      while (current && current !== document.body) {
        if (current.matches('ul, [data-menu-root], [data-popover], [class*="menu" i], [class*="popover" i], [class*="dropdown" i]')) return current;
        current = current.parentElement;
      }
      return null;
    }).filter(Boolean))];
    if (addedContainers.length !== 1) return null;
    return visibleOptionCandidates()
      .filter(element => addedContainers[0].contains(element))
      .map(element => ({ element, label: elementLabel(element) }))
      .filter(option => option.label);
  }

  async function readStepFromMenu(step, recipes) {
    const trigger = step.kind === 'model' ? findStepTrigger('model', recipes) : thinkingTrigger(recipes);
    if (!trigger) return null;
    const opened = await openMenu(trigger, { optionFallback: true });
    if (!opened || opened.error) return null;
    let label = null;
    const row = opened.options.find(option => SUBMENU_LABEL.test(option.label));
    if (step.kind === 'thinking' && row && stepShownIn(row.label.replace(SUBMENU_LABEL, ''), step, recipes)) label = row.label;
    if (!label) {
      const chosen = opened.options.find(option => isChosen(option.element) && !SUBMENU_LABEL.test(option.label));
      if (chosen && stepShownIn(chosen.label, step, recipes)) label = chosen.label;
    }
    closeOpenedMenus(opened);
    return label;
  }

  function readStepFromTriggers(step, recipes) {
    const trigger = step.kind === 'model' ? findStepTrigger('model', recipes) : thinkingTrigger(recipes);
    return trigger && stepShownIn(trigger.label, step, recipes) ? trigger.label : null;
  }

  async function runToggleStep(step) {
    const toggle = findRecipeToggle(step);
    if (!toggle) return { error: 'toggle_not_visible' };
    if (!isEnabled(toggle.element)) return { error: 'toggle_disabled', locked: true };
    const enabled = readRecipeToggle(toggle);
    if (enabled === null) return { error: 'toggle_state_not_readable' };
    if (enabled !== step.on) toggle.element.click();
    const verified = await waitFor(() => {
      const current = findRecipeToggle(step);
      return current && readRecipeToggle(current) === step.on ? current : null;
    }, 1100);
    return verified ? { label: `${toggle.label} ${step.on ? 'on' : 'off'}` } : { error: 'verification_failed' };
  }

  async function runMenuStep(step, recipes) {
    const shown = readStepFromTriggers(step, recipes);
    if (shown) return { label: shown };
    const trigger = step.kind === 'model' ? findStepTrigger('model', recipes) : thinkingTrigger(recipes);
    if (!trigger) return { error: 'selector_not_visible' };
    if (!isEnabled(trigger.element)) return { error: 'selector_disabled', locked: true };
    const opened = await openMenu(trigger, { optionFallback: true });
    if (!opened || opened.error) return { error: opened?.error || 'menu_timeout' };
    let option = pickOption(opened.options, step.label);
    const row = step.kind === 'thinking' && !option ? opened.options.find(candidate => SUBMENU_LABEL.test(candidate.label)) : null;
    if (row) {
      const submenuOptions = await openSubmenu(row, opened.options, opened.roots || []);
      option = submenuOptions ? pickOption(submenuOptions, step.label, { excludeSubmenus: false }) : null;
    }
    if (!option) {
      closeOpenedMenus(opened);
      return { error: 'option_not_found' };
    }
    if (!isEnabled(option.element)) {
      closeOpenedMenus(opened);
      return { error: 'option_locked', locked: true, label: option.label };
    }
    if (!isChosen(option.element)) {
      const target = (config.optionClickSelector && option.element.querySelector(config.optionClickSelector)) || option.element;
      target.click();
    }
    let label = await waitFor(() => readStepFromTriggers(step, recipes), 1300, 70);
    if (getOpenMenus().length && opened.openedByUs) closeOpenedMenus(opened);
    if (!label) label = await readStepFromMenu(step, recipes);
    return label ? { label } : { error: 'verification_failed' };
  }

  /**
   * A thinking step on a page with a strength slider (ChatGPT) moves the
   * slider to the stop of the tier its label names. Returns null when no
   * slider is shown, so the step falls back to picking a menu option.
   */
  async function runSliderStep(step) {
    if (!findThinkingSlider() && !findThinkingSliderTrigger()) return null;
    const tier = stepTier(step);
    if (!tier) return null;
    const result = await setThinkingSliderTier(tier);
    if (result.reason === 'slider_not_visible') return null;
    if (result.status === 'success') return { label: result.actualLabel };
    return { error: result.reason || 'verification_failed', locked: result.status === 'unavailable', label: result.actualLabel };
  }

  function stepTier(step) {
    return TIER_IDS.find(tier => labelAlternatives(step.label).some(label => matchesTier(label, tier))) || null;
  }

  function recipeKey(steps) {
    return JSON.stringify((steps || []).map(item => [item.kind, lower(item.label), item.on === true]));
  }

  function tiersSharing(recipes, tier) {
    return TIER_IDS.filter(candidate => recipes[candidate]?.length && recipeKey(recipes[candidate]) === recipeKey(recipes[tier]));
  }

  function supportedRecipeTiers(recipes) {
    return TIER_IDS.filter(tier => recipes[tier]?.length);
  }

  function currentReadings(recipes) {
    const model = findStepTrigger('model', recipes);
    const thinking = findStepTrigger('thinking', recipes);
    const toggleSteps = TIER_IDS.flatMap(tier => recipes[tier] || []).filter(item => item.kind === 'toggle');
    const toggle = toggleSteps.length ? findRecipeToggle(toggleSteps[0]) : null;
    const thinkingLabels = kindLabels(recipes, 'thinking');
    const thinkingLabel = thinking && thinkingLabels.some(label => labelScore(thinking.label, label) > 0)
      ? thinking.label
      : model && thinkingLabels.some(label => labelScore(model.label, label) > 0)
        ? model.label
        : null;
    return {
      model: model?.label || null,
      thinking: thinkingLabel,
      toggle: toggle ? readRecipeToggle(toggle) : null,
      toggleLabel: toggle?.label || null
    };
  }

  function readingsLabel(readings) {
    const parts = [readings.model, readings.thinking !== readings.model ? readings.thinking : null,
      readings.toggleLabel && readings.toggle !== null ? `${readings.toggleLabel} ${readings.toggle ? 'on' : 'off'}` : null];
    return parts.filter(Boolean).join(' · ') || null;
  }

  function stepMatchesReadings(step, readings, recipes) {
    if (step.kind === 'toggle') return readings.toggle === null ? null : readings.toggle === step.on;
    const text = step.kind === 'model' ? readings.model : readings.thinking;
    // A strength slider names its own stops ("Thinking strength Low"), so
    // compare tiers instead of the recipe's labels.
    if (step.kind === 'thinking' && text && matchesAny(text, config.sliderLabels)) {
      const tier = stepTier(step);
      return Boolean(tier) && TIER_IDS.every(candidate => matchesTier(text, candidate) === (candidate === tier));
    }
    return text ? stepShownIn(text, step, recipes) : null;
  }

  function readRecipeState(recipes) {
    const readings = currentReadings(recipes);
    const actualLabel = readingsLabel(readings);
    const supportedTiers = supportedRecipeTiers(recipes);
    if (!actualLabel) {
      if (hasLoginGate()) return { status: 'unavailable', reason: 'not_logged_in', tier: null, actualLabel: null, supportedTiers: [], matchedTiers: [] };
      return { status: 'unavailable', reason: 'selector_not_visible', tier: null, actualLabel: null, supportedTiers, matchedTiers: [] };
    }
    const matchedTiers = supportedTiers.filter(tier => {
      const results = recipes[tier].map(item => stepMatchesReadings(item, readings, recipes));
      return results.every(result => result === true);
    });
    const remembered = lastVerifiedSelection?.provider === provider && lastVerifiedSelection.rawLabel === actualLabel
      && matchedTiers.includes(lastVerifiedSelection.tier) ? lastVerifiedSelection : null;
    const tier = remembered?.tier || matchedTiers[0] || null;
    if (!tier) {
      return { status: 'unavailable', reason: 'current_tier_unknown', tier: null, actualLabel, supportedTiers, matchedTiers: [] };
    }
    return {
      status: 'success',
      reason: null,
      tier,
      actualLabel: remembered?.actualLabel || actualLabel,
      supportedTiers,
      matchedTiers: remembered?.matchedTiers || matchedTiers
    };
  }

  async function setRecipeTier(tier, recipes) {
    const steps = recipes[tier] || [];
    const supportedTiers = supportedRecipeTiers(recipes);
    const failure = (status, reason, actualLabel = null) => ({
      status, reason, tier: null, requestedTier: tier, actualLabel, supportedTiers, matchedTiers: []
    });
    if (!steps.length) return failure('unsupported', 'tier_not_mapped');
    const confirmed = [];
    for (const item of steps) {
      const result = item.kind === 'toggle' ? await runToggleStep(item)
        : (item.kind === 'thinking' && await runSliderStep(item)) || await runMenuStep(item, recipes);
      if (result.error) {
        const partial = [...confirmed, '?'].join(' · ');
        if (result.error === 'selector_not_visible' && hasLoginGate()) return failure('unavailable', 'not_logged_in');
        if (result.locked) return failure('unavailable', result.error, result.label || partial);
        if (result.error === 'menu_timeout') return failure('timeout', `step_failed:${item.kind}`, partial);
        if (result.error === 'unrelated_menu_visible') return failure('unavailable', result.error, partial);
        return failure('error', `step_failed:${item.kind}`, partial);
      }
      confirmed.push(result.label);
    }
    const finalReadings = currentReadings(recipes);
    const finalResults = steps.map(item => stepMatchesReadings(item, finalReadings, recipes));
    if (finalResults.some(result => result === false)) {
      return failure('error', 'verification_failed', readingsLabel(finalReadings));
    }
    const matchedTiers = tiersSharing(recipes, tier);
    const label = [...new Set(confirmed)].join(' · ');
    const actualLabel = matchedTiers.length > 1 ? `${label} (shared mapping: ${matchedTiers.join('/')})` : label;
    lastVerifiedSelection = {
      provider,
      rawLabel: readingsLabel(finalReadings),
      tier,
      actualLabel,
      supportedTiers,
      matchedTiers
    };
    return { status: 'success', reason: null, tier, requestedTier: tier, actualLabel, supportedTiers, matchedTiers };
  }

  async function processRecipeRequest(data) {
    const recipes = normalizeRecipes(data.recipes);
    if (!recipes || !supportedRecipeTiers(recipes).length) {
      return { status: 'unsupported', reason: 'missing_recipes', tier: null, requestedTier: data.tier || null, actualLabel: null, supportedTiers: [] };
    }
    if (data.type === 'GET_PROVIDER_TIER_STATE') return readRecipeState(recipes);
    return setRecipeTier(data.tier, recipes);
  }

  async function processRequest(data) {
    if (!provider || !config || config.strategy === 'unsupported') {
      return { status: 'unsupported', reason: 'provider_not_supported', tier: null, requestedTier: data.tier || null, actualLabel: null, supportedTiers: [] };
    }
    if (config.strategy === 'recipe' || (config.acceptsRecipes && data.recipes)) return processRecipeRequest(data);
    if (provider === 'chatgpt') {
      const slider = findThinkingSlider();
      const sliderTrigger = findThinkingSliderTrigger();
      if (data.type === 'GET_PROVIDER_TIER_STATE') {
        const state = await readThinkingSliderState({ openIfNeeded: true });
        if (state?.reason === 'slider_not_visible') return readCurrentState();
        if (state) return state;
      } else if (slider || sliderTrigger) {
        const result = await setThinkingSliderTier(data.tier);
        if (result.reason !== 'slider_not_visible') return result;
        return setMenuTier(data.tier);
      }
    }
    if (data.type === 'SET_PROVIDER_TIER' && getToggle()) return setToggleTier(data.tier);
    if (data.type === 'GET_PROVIDER_TIER_STATE') return readCurrentState();
    return setMenuTier(data.tier);
  }

  function isValidHostMessage(event, data) {
    if (!extensionOrigin || window.parent === window) return false;
    if (event.source !== window.parent || event.origin !== extensionOrigin) return false;
    if (!data || data.context !== 'multi-panel' || !REQUESTS[data.type]) return false;
    if (typeof data.requestId !== 'string' || data.requestId.length < 1 || data.requestId.length > 160) return false;
    if (data.provider && data.provider !== provider) return false;
    if (data.type === 'SET_PROVIDER_TIER' && !TIER_IDS.includes(data.tier)) return false;
    return true;
  }

  function onMessage(event) {
    const data = event.data;
    if (!isValidHostMessage(event, data)) return;
    const responseType = REQUESTS[data.type];
    const key = `${data.type}:${data.requestId}`;
    if (completed.has(key)) {
      postResponse(completed.get(key));
      return;
    }
    if (inFlight.has(key)) return;

    const task = operationQueue.then(() => processRequest(data)).catch(() => ({
      status: 'error', reason: 'operation_failed', tier: data.tier || null, actualLabel: null, supportedTiers: []
    }));
    operationQueue = task.then(() => undefined, () => undefined);
    inFlight.set(key, task);
    task.then(result => {
      const message = responseFor(data, responseType, result);
      completed.set(key, message);
      if (completed.size > 100) completed.delete(completed.keys().next().value);
      postResponse(message);
    }).finally(() => inFlight.delete(key));
  }

  window.addEventListener('message', onMessage);
})();
