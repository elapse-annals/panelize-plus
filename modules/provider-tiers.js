export const PROVIDER_TIER_IDS = Object.freeze(['fast', 'balanced', 'deep']);

export const PROVIDER_TIER_LABELS = Object.freeze({
  fast: '快速',
  balanced: '均衡',
  deep: '深度'
});

export const TIER_STEP_KINDS = Object.freeze(['model', 'thinking', 'toggle']);
export const TIER_RECIPE_LIMITS = Object.freeze({ steps: 4, label: 120 });

const step = (kind, label) => ({ kind, label });
const recipe = (model, thinking) => [
  ...(model ? [step('model', model)] : []),
  ...(thinking ? [step('thinking', thinking)] : [])
];
const deepThink = on => [{ kind: 'toggle', label: '深度思考|思考|DeepThink|Think', on }];

/**
 * Built-in tier recipes: the visible labels to pick, in order, on each page.
 * Labels hold `|`-separated alternatives (for localized pages) and match the
 * start of a menu item, so "K2.8" also picks "K2.8 Preview · …". Users can
 * override any provider's recipes in the options page.
 */
export const DEFAULT_TIER_RECIPES = Object.freeze({
  chatgpt: {
    fast: recipe('GPT-6', 'Instant|即时'),
    balanced: recipe('GPT-6', 'Medium|中等'),
    deep: recipe('GPT-6', 'High|高')
  },
  gemini: {
    fast: recipe('3.5 Flash-Lite', 'High|高'),
    balanced: recipe('3.8 Flash', 'High|高'),
    deep: recipe('4 Argon', 'High|高')
  },
  deepseek: { fast: deepThink(false), balanced: deepThink(true), deep: deepThink(true) },
  kimi: {
    fast: recipe('快速|Fast', '进阶|Advanced'),
    balanced: recipe('K2.8', '进阶|Advanced'),
    deep: recipe('K3.1', '进阶|Advanced')
  },
  'qwen-cn': {
    fast: recipe('Qwen3.6-flash', '快速'),
    balanced: recipe('Qwen3.7', '思考研究'),
    deep: recipe('Qwen3.7-Max', '快速')
  },
  'qwen-global': {
    fast: recipe('Qwen3.6-flash', '快速|Fast'),
    balanced: recipe('Qwen3.7', '思考研究|Thinking'),
    deep: recipe('Qwen3.7-Max', '快速|Fast')
  },
  chatglm: {
    fast: recipe('GLM-FLASH', '快速'),
    balanced: recipe('GLM-FLASH', '极致'),
    deep: recipe('GLM-5.3', '极致')
  },
  'zai-global': {
    fast: recipe('GLM-FLASH|GLM-5.3-Flash', '快速|Fast'),
    balanced: recipe('GLM-FLASH|GLM-5.3-Flash', '极致|Max'),
    deep: recipe('GLM-5.3', '极致|Max')
  },
  'meta-ai': {
    fast: recipe('即时|Instant'),
    balanced: recipe('即时|Instant'),
    deep: recipe('思考|Thinking')
  },
  yuanbao: {
    fast: [step('model', 'Hy3'), { kind: 'toggle', label: '深度思考', on: false }],
    balanced: [step('model', 'Hy3'), { kind: 'toggle', label: '深度思考', on: true }],
    deep: [step('model', 'DeepSeek'), { kind: 'toggle', label: '深度思考', on: true }]
  }
});

export const TIER_RECIPE_PROVIDERS = Object.freeze(Object.keys(DEFAULT_TIER_RECIPES));

function normalizeStep(value) {
  if (!value || typeof value !== 'object' || !TIER_STEP_KINDS.includes(value.kind)) return null;
  const label = typeof value.label === 'string' ? value.label.trim().slice(0, TIER_RECIPE_LIMITS.label) : '';
  if (!label) return null;
  return value.kind === 'toggle' ? { kind: 'toggle', label, on: value.on === true } : { kind: value.kind, label };
}

/**
 * Validates one tier's steps. Returns null for anything that is not a list,
 * so a broken override falls back to the built-in recipe; an empty list is
 * kept and means "do not switch this provider for that tier".
 */
export function normalizeTierRecipe(steps) {
  if (!Array.isArray(steps)) return null;
  return steps.slice(0, TIER_RECIPE_LIMITS.steps).map(normalizeStep).filter(Boolean);
}

/**
 * The recipes to run for a provider: built-in defaults with the user's
 * per-tier overrides applied, or null for providers without recipes.
 * @param {string} providerId
 * @param {Record<string, Record<string, Array<object>>>|null} [overrides]
 */
export function getEffectiveTierRecipes(providerId, overrides = null) {
  const defaults = DEFAULT_TIER_RECIPES[providerId];
  if (!defaults) return null;
  const custom = overrides && typeof overrides === 'object' ? overrides[providerId] : null;
  return Object.fromEntries(PROVIDER_TIER_IDS.map(tier => {
    const override = custom && typeof custom === 'object' ? normalizeTierRecipe(custom[tier]) : null;
    return [tier, override ?? defaults[tier].map(item => ({ ...item }))];
  }));
}

const pattern = (...values) => values.map(value => new RegExp(value, 'i'));
const DISCOVERY_CONFIG = {
  strategy: 'discover',
  selectors: ['[data-testid*="model"]', '[data-testid*="mode"]', '[aria-haspopup="listbox"]', '[role="combobox"]'],
  selectorLabels: pattern('model', 'mode', 'reasoning', 'thinking', 'fast', 'deep', '模型', '模式', '思考', '推理', '快速', '深度'),
  toggleLabels: pattern('^(deep.?think|think|thinking|thinking mode|reasoning|reasoning mode|fast mode|思考|思考模式|深度思考|深度推理)$'),
  submenuLabels: pattern('^(reasoning|reasoning effort|thinking level|effort|思考强度|推理强度|思考档位)$'),
  tiers: {
    fast: pattern('\\b(instant|fast|quick|low|light|standard|flash|haiku)\\b', '快速|极速|低|轻量|标准'),
    balanced: pattern('\\b(medium|balanced|auto|normal|sonnet)\\b', '中等|均衡|自动|常规'),
    deep: pattern('\\b(high|extra high|deep|advanced|extreme|max|extended|thinking|reasoning|opus)\\b', '高|深度|深度思考|高级|极致|最大')
  },
  evidence: 'visible-ui-discovery-only'
};

/**
 * Web UI capability candidates, not API model capabilities. A candidate only
 * becomes available at runtime after the content script sees an enabled,
 * visible control with a matching label in that provider's page.
 */
export const PROVIDER_TIER_CONFIG = Object.freeze({
  chatgpt: {
    strategy: 'menu',
    sliderLabels: pattern('thinking strength', 'thinking level', 'reasoning effort', 'reasoning level', '思考强度', '推理强度'),
    effortSelectors: ['[data-testid*="reasoning-effort"]', '[data-testid*="thinking-strength"]', 'button[aria-label*="reasoning effort" i]', 'button[aria-label*="思考强度"]'],
    submenuLabels: pattern('^(reasoning effort|thinking level|effort|configure)$'),
    selectorLabels: pattern('model', 'effort', 'reasoning', 'thinking level', 'instant', 'medium', 'high', '模型', '快速', '均衡', '深度'),
    selectors: ['[data-testid*="model-switcher"]', '[data-testid*="model-picker"]'],
    tiers: {
      fast: pattern('^(instant|fast|low|light|即时|快速|低)$'),
      balanced: pattern('^(medium|balanced|pro standard|standard|中|中等|均衡|标准)$'),
      deep: pattern('^(high|extra high|pro extended|extended|deep|深入|高|极高)$')
    },
    // Recipes (GPT-6 + Instant/Medium/High) take precedence; the slider and
    // menu matching above remain for hosts that send no recipes.
    acceptsRecipes: true,
    evidence: 'user-mapping-needs-logged-in-dom-confirmation',
    source: 'https://help.openai.com/en/articles/6825453-chatgpt-release-notes'
  },
  claude: {
    strategy: 'menu',
    submenuLabels: pattern('^(effort|reasoning effort|thinking level)$'),
    selectorLabels: pattern('model', 'haiku', 'sonnet', 'opus', '模型'),
    selectors: ['[data-testid*="model-selector"]', '[data-testid*="model-picker"]'],
    tiers: {
      fast: pattern('low', 'haiku'),
      balanced: pattern('medium', 'sonnet'),
      deep: pattern('high', 'extra high', 'xhigh', 'max', 'opus')
    },
    preferredTiers: {
      fast: pattern('^(low|低)$'),
      balanced: pattern('^(medium|中等)$'),
      deep: pattern('^(high|高)$')
    },
    evidence: 'documented-ui-model-selector',
    source: 'https://support.claude.com/en/articles/8664678-change-the-model-effort-and-thinking-settings'
  },
  gemini: { strategy: 'recipe', evidence: 'live-ui-probe-2026-10-24-model-menu', source: 'https://support.google.com/gemini/answer/18648722' },
  grok: { strategy: 'unsupported', evidence: 'user-mapping-not-supported' },
  deepseek: {
    strategy: 'recipe',
    sharedTiers: ['balanced', 'deep'],
    evidence: 'official-app-feature-ui-needs-live-dom-confirmation',
    source: 'https://api-docs.deepseek.com/news/news250115/'
  },
  kimi: { strategy: 'recipe', evidence: 'live-ui-probe-2026-10-24-model-menu-effort-submenu', source: 'https://www.kimi.com/en/help/others/model-mode-selection' },
  google: { strategy: 'unsupported', evidence: 'search-ui-has-no-documented-reasoning-tiers' },
  doubao: { ...DISCOVERY_CONFIG, evidence: 'visible-ui-discovery-only', source: 'https://www.doubao.com/' },
  'qwen-cn': { strategy: 'recipe', evidence: 'live-ui-probe-2026-10-24-model-and-mode-buttons', source: 'https://www.qianwen.com/' },
  'qwen-global': { strategy: 'recipe', evidence: 'live-ui-probe-2026-10-24-model-and-mode-buttons', source: 'https://chat.qwen.ai/' },
  chatglm: { strategy: 'recipe', evidence: 'live-ui-probe-2026-10-24-think-mode-trigger', source: 'https://chatglm.cn/' },
  'zai-global': { strategy: 'recipe', evidence: 'live-ui-probe-2026-10-24-model-menu-effort-submenu', source: 'https://chat.z.ai/' },
  yuanbao: { strategy: 'recipe', evidence: 'live-ui-probe-2026-10-25-model-menu-deep-think-toggle', source: 'https://yuanbao.tencent.com/' },
  mimo: { ...DISCOVERY_CONFIG, evidence: 'visible-ui-discovery-only', source: 'https://aistudio.xiaomimimo.com/' },
  'meta-ai': { strategy: 'recipe', evidence: 'user-mapping-needs-logged-in-dom-confirmation', source: 'https://www.meta.ai/' },
  stepfun: { ...DISCOVERY_CONFIG, evidence: 'visible-ui-discovery-only', source: 'https://studio.stepfun.com/' },
  agnes: { ...DISCOVERY_CONFIG, evidence: 'visible-ui-discovery-only', source: 'https://app.agnes-ai.com/' },
  'hy-aistudio': { ...DISCOVERY_CONFIG, evidence: 'visible-ui-discovery-only', source: 'https://aistudio.tencent.com/' }
});

const MENU_EFFORT_LEVELS = Object.freeze({ fast: 'Low', balanced: 'Medium', deep: 'High' });

/**
 * What a tier is configured to pick on one provider, for display only:
 * `recipe` (steps, with the other tiers that share identical steps),
 * `skipped` (an empty recipe), `effort` (menu providers' reasoning effort),
 * `detect` (visible-UI discovery) or `unsupported`.
 * @param {string} providerId
 * @param {string} tier
 * @param {Record<string, Record<string, Array<object>>>|null} [overrides]
 */
export function describeTierMapping(providerId, tier, overrides = null) {
  if (!PROVIDER_TIER_IDS.includes(tier)) return null;
  const recipes = getEffectiveTierRecipes(providerId, overrides);
  if (recipes) {
    const steps = recipes[tier];
    if (!steps.length) return { type: 'skipped', steps, sharedWith: [] };
    const key = JSON.stringify(steps);
    const sharedWith = PROVIDER_TIER_IDS.filter(other => other !== tier && JSON.stringify(recipes[other]) === key);
    return { type: 'recipe', steps, sharedWith };
  }
  const strategy = PROVIDER_TIER_CONFIG[providerId]?.strategy;
  if (strategy === 'menu') return { type: 'effort', level: MENU_EFFORT_LEVELS[tier], steps: [], sharedWith: [] };
  if (strategy === 'discover') return { type: 'detect', steps: [], sharedWith: [] };
  return { type: 'unsupported', steps: [], sharedWith: [] };
}

const REQUEST_TO_RESPONSE = Object.freeze({
  GET_PROVIDER_TIER_STATE: 'PANELIZE_PROVIDER_TIER_STATE',
  SET_PROVIDER_TIER: 'PANELIZE_PROVIDER_TIER_RESULT'
});

export const PROVIDER_TIER_STATUSES = Object.freeze(['success', 'unsupported', 'unavailable', 'timeout', 'error']);
const VALID_STATUSES = new Set(PROVIDER_TIER_STATUSES);

let requestSequence = 0;

export function createProviderTierRequestId(provider = 'provider') {
  requestSequence += 1;
  const randomPart = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${requestSequence.toString(36)}`;
  return `panelize-tier-${provider}-${randomPart}`;
}

export function isProviderTierResponse(data, {
  type,
  requestId,
  provider
} = {}) {
  if (!data || typeof data !== 'object') return false;
  if (type && data.type !== type) return false;
  if (requestId && data.requestId !== requestId) return false;
  if (provider && data.provider !== provider) return false;
  if (data.context !== 'multi-panel') return false;
  if (!VALID_STATUSES.has(data.status)) return false;
  if (!Array.isArray(data.supportedTiers)) return false;
  if (data.supportedTiers.some(tier => !PROVIDER_TIER_IDS.includes(tier))) return false;
  if (!Array.isArray(data.matchedTiers)) return false;
  if (data.matchedTiers.some(tier => !PROVIDER_TIER_IDS.includes(tier))) return false;
  return true;
}

function resolvePanel(panel) {
  const targetWindow = panel?.window || panel?.iframe?.contentWindow || panel?.contentWindow;
  let origin = panel?.origin;
  if (!origin) {
    const src = panel?.iframe?.src || panel?.src;
    try {
      origin = new URL(src).origin;
    } catch {
      origin = null;
    }
  }
  if (!targetWindow || !panel?.provider || !origin || origin === 'null') return null;
  return {
    targetWindow,
    origin,
    provider: panel.provider,
    panelId: panel.panelId ?? panel.id ?? panel.provider,
    recipes: panel.recipes && typeof panel.recipes === 'object' ? panel.recipes : null
  };
}

function failureResult(panel, status, reason, tier = null, requestedTier = null) {
  return {
    panelId: panel?.panelId ?? panel?.id ?? panel?.provider ?? null,
    provider: panel?.provider ?? null,
    status,
    reason,
    tier,
    requestedTier,
    actualLabel: null,
    supportedTiers: [],
    matchedTiers: []
  };
}

export function waitForProviderTierResult({
  target = globalThis.window,
  source,
  origin,
  provider,
  requestId,
  responseType,
  timeoutMs = 2500,
  panelId = provider,
  signal
} = {}) {
  if (!target?.addEventListener || !source || !origin || !provider || !requestId || !responseType) {
    return Promise.resolve(failureResult({ panelId, provider }, 'error', 'invalid_request'));
  }

  return new Promise(resolve => {
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      target.removeEventListener('message', onMessage);
      signal?.removeEventListener('abort', onAbort);
      resolve({ panelId, ...result });
    };
    const onAbort = () => finish(failureResult({ panelId, provider }, 'error', 'request_cancelled'));
    const onMessage = event => {
      if (event.source !== source || event.origin !== origin) return;
      if (!isProviderTierResponse(event.data, {
        type: responseType,
        requestId,
        provider
      })) return;

      const { type: _type, requestId: _requestId, context: _context, ...result } = event.data;
      finish(result);
    };
    const timer = setTimeout(() => {
      finish(failureResult({ panelId, provider }, 'timeout', 'request_timeout'));
    }, Math.max(0, timeoutMs));
    target.addEventListener('message', onMessage);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

async function requestProviderTier(panel, {
  target = globalThis.window,
  type,
  tier = null,
  timeoutMs = 2500
} = {}) {
  const resolved = resolvePanel(panel);
  if (!resolved) return failureResult(panel, 'error', 'invalid_panel', null, tier);
  if (!REQUEST_TO_RESPONSE[type]) return failureResult(panel, 'error', 'invalid_request_type', null, tier);
  if (type === 'SET_PROVIDER_TIER' && !PROVIDER_TIER_IDS.includes(tier)) {
    return failureResult(panel, 'error', 'invalid_tier', null, tier);
  }

  const requestId = createProviderTierRequestId(resolved.provider);
  const abortController = new AbortController();
  const responsePromise = waitForProviderTierResult({
    target,
    source: resolved.targetWindow,
    origin: resolved.origin,
    provider: resolved.provider,
    requestId,
    responseType: REQUEST_TO_RESPONSE[type],
    timeoutMs,
    panelId: resolved.panelId,
    signal: abortController.signal
  });

  try {
    resolved.targetWindow.postMessage({
      type,
      requestId,
      provider: resolved.provider,
      ...(tier ? { tier } : {}),
      // Recipe providers learn the labels to pick from the host, so options
      // page edits apply without reloading the provider page.
      ...(resolved.recipes ? { recipes: resolved.recipes } : {}),
      context: 'multi-panel'
    }, resolved.origin);
  } catch {
    abortController.abort();
    return failureResult(panel, 'error', 'post_message_failed', null, tier);
  }

  const response = await responsePromise;
  return {
    ...response,
    requestedTier: type === 'SET_PROVIDER_TIER' ? tier : null
  };
}

export function requestProviderTierState(panel, options = {}) {
  return requestProviderTier(panel, { ...options, type: 'GET_PROVIDER_TIER_STATE' });
}

export async function runProviderTierBatch({
  panels = [],
  tier,
  target = globalThis.window,
  timeoutMs = 3500
} = {}) {
  if (!PROVIDER_TIER_IDS.includes(tier)) {
    return panels.map(panel => failureResult(panel, 'error', 'invalid_tier', null, tier));
  }

  return Promise.all(panels.map(panel => requestProviderTier(panel, {
    target,
    type: 'SET_PROVIDER_TIER',
    tier,
    timeoutMs
  })));
}

/** The editable fields the options page shows for one tier's steps. */
export function tierRecipeToFields(steps = []) {
  const toggle = steps.find(item => item.kind === 'toggle');
  return {
    model: steps.find(item => item.kind === 'model')?.label || '',
    thinking: steps.find(item => item.kind === 'thinking')?.label || '',
    toggleOn: toggle ? toggle.on === true : null
  };
}

/**
 * Steps from the options page fields. Toggle providers keep their built-in
 * toggle label and only change on/off; empty fields drop that step.
 */
export function tierRecipeFromFields(providerId, tier, fields = {}) {
  const toggle = DEFAULT_TIER_RECIPES[providerId]?.[tier]?.find(item => item.kind === 'toggle');
  if (toggle) {
    return normalizeTierRecipe([
      { kind: 'model', label: fields.model },
      { kind: 'toggle', label: toggle.label, on: fields.toggleOn === true }
    ]);
  }
  return normalizeTierRecipe([
    { kind: 'model', label: fields.model },
    { kind: 'thinking', label: fields.thinking }
  ]);
}

/**
 * Keeps only the tiers that differ from the built-in recipes, so later
 * changes to the defaults still reach users who never edited that tier.
 * @returns {Record<string, Record<string, Array<object>>>|null}
 */
export function buildTierRecipeOverrides(recipesByProvider = {}) {
  const overrides = {};
  for (const providerId of TIER_RECIPE_PROVIDERS) {
    for (const tier of PROVIDER_TIER_IDS) {
      const steps = normalizeTierRecipe(recipesByProvider?.[providerId]?.[tier]);
      if (!steps || JSON.stringify(steps) === JSON.stringify(DEFAULT_TIER_RECIPES[providerId][tier])) continue;
      overrides[providerId] = { ...overrides[providerId], [tier]: steps };
    }
  }
  return Object.keys(overrides).length ? overrides : null;
}
