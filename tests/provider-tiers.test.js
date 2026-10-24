import { describe, expect, it, vi } from 'vitest';
import { PROVIDERS } from '../modules/providers.js';
import {
  DEFAULT_TIER_RECIPES,
  PROVIDER_TIER_CONFIG,
  PROVIDER_TIER_IDS,
  PROVIDER_TIER_LABELS,
  PROVIDER_TIER_STATUSES,
  TIER_RECIPE_PROVIDERS,
  buildTierRecipeOverrides,
  getEffectiveTierRecipes,
  isProviderTierResponse,
  normalizeTierRecipe,
  tierRecipeFromFields,
  tierRecipeToFields,
  requestProviderTierState,
  runProviderTierBatch,
  waitForProviderTierResult
} from '../modules/provider-tiers.js';

function createEventTarget() {
  const listeners = new Set();
  return {
    addEventListener: vi.fn((type, listener) => type === 'message' && listeners.add(listener)),
    removeEventListener: vi.fn((type, listener) => type === 'message' && listeners.delete(listener)),
    dispatchMessage(event) {
      for (const listener of listeners) listener(event);
    }
  };
}

function tierMessage({ type = 'PANELIZE_PROVIDER_TIER_STATE', requestId, provider, ...fields }) {
  return {
    type,
    context: 'multi-panel',
    requestId,
    provider,
    status: 'success',
    tier: 'balanced',
    actualLabel: 'Medium',
    supportedTiers: ['fast', 'balanced', 'deep'],
    matchedTiers: ['balanced'],
    ...fields
  };
}

describe('provider tier contract', () => {
  it('declares three shared tiers and a mapping entry for each registered provider', () => {
    expect(PROVIDER_TIER_IDS).toEqual(['fast', 'balanced', 'deep']);
    expect(PROVIDER_TIER_LABELS).toEqual({ fast: '快速', balanced: '均衡', deep: '深度' });
    expect(Object.keys(PROVIDER_TIER_CONFIG).sort()).toEqual(PROVIDERS.map(provider => provider.id).sort());
    expect(PROVIDER_TIER_STATUSES).toEqual(['success', 'unsupported', 'unavailable', 'timeout', 'error']);
    expect(PROVIDER_TIER_CONFIG.google.strategy).toBe('unsupported');
    expect(PROVIDER_TIER_CONFIG.deepseek.sharedTiers).toEqual(['balanced', 'deep']);
    expect(PROVIDER_TIER_CONFIG['qwen-global'].strategy).toBe('recipe');
    expect(PROVIDER_TIER_CONFIG.grok.strategy).toBe('unsupported');
  });

  it('gives every recipe provider the recipe strategy and three tiers of steps', () => {
    expect(TIER_RECIPE_PROVIDERS).toEqual(expect.arrayContaining(['gemini', 'deepseek', 'kimi', 'qwen-cn', 'qwen-global', 'chatglm', 'zai-global', 'meta-ai', 'yuanbao']));
    for (const provider of TIER_RECIPE_PROVIDERS) {
      expect(PROVIDER_TIER_CONFIG[provider].strategy).toBe('recipe');
      expect(Object.keys(DEFAULT_TIER_RECIPES[provider])).toEqual(PROVIDER_TIER_IDS);
    }
    expect(DEFAULT_TIER_RECIPES['qwen-cn'].deep).toEqual([
      { kind: 'model', label: 'Qwen3.7-Max' },
      { kind: 'thinking', label: '快速' }
    ]);
    expect(DEFAULT_TIER_RECIPES.deepseek.fast[0]).toMatchObject({ kind: 'toggle', on: false });
  });

  it('applies valid per-tier overrides and ignores broken ones', () => {
    const overrides = {
      kimi: {
        fast: [{ kind: 'model', label: ' K2.9 ' }, { kind: 'bogus', label: 'x' }, { kind: 'thinking', label: '' }],
        balanced: 'not a list',
        deep: []
      }
    };
    const recipes = getEffectiveTierRecipes('kimi', overrides);
    expect(recipes.fast).toEqual([{ kind: 'model', label: 'K2.9' }]);
    expect(recipes.balanced).toEqual(DEFAULT_TIER_RECIPES.kimi.balanced);
    expect(recipes.deep).toEqual([]);
    expect(getEffectiveTierRecipes('chatgpt', overrides)).toBeNull();
    expect(normalizeTierRecipe([{ kind: 'toggle', label: 'DeepThink', on: 'yes' }])).toEqual([{ kind: 'toggle', label: 'DeepThink', on: false }]);
    expect(normalizeTierRecipe(new Array(9).fill({ kind: 'model', label: 'm' }))).toHaveLength(4);
  });

  it('round-trips options page fields and stores only tiers that differ from the defaults', () => {
    expect(tierRecipeToFields(DEFAULT_TIER_RECIPES.yuanbao.balanced)).toEqual({ model: 'hy3-preview', thinking: '专家模式', toggleOn: null });
    expect(tierRecipeToFields(DEFAULT_TIER_RECIPES.deepseek.fast)).toEqual({ model: '', thinking: '', toggleOn: false });
    expect(tierRecipeFromFields('deepseek', 'fast', { toggleOn: true })).toEqual([
      { kind: 'toggle', label: DEFAULT_TIER_RECIPES.deepseek.fast[0].label, on: true }
    ]);
    expect(tierRecipeFromFields('kimi', 'fast', { model: 'K2.9', thinking: '' })).toEqual([{ kind: 'model', label: 'K2.9' }]);

    const edited = Object.fromEntries(TIER_RECIPE_PROVIDERS.map(provider => [provider, DEFAULT_TIER_RECIPES[provider]]));
    expect(buildTierRecipeOverrides(edited)).toBeNull();
    const overrides = buildTierRecipeOverrides({
      ...edited,
      kimi: { ...edited.kimi, deep: [{ kind: 'model', label: 'K3.2' }] },
      chatgpt: { fast: [{ kind: 'model', label: 'ignored' }] }
    });
    expect(overrides).toEqual({ kimi: { deep: [{ kind: 'model', label: 'K3.2' }] } });
  });

  it('rejects responses with a wrong context, unsupported tier, or unknown status', () => {
    const base = tierMessage({ requestId: 'req-1', provider: 'chatgpt' });
    expect(isProviderTierResponse(base, { requestId: 'req-1', provider: 'chatgpt' })).toBe(true);
    expect(isProviderTierResponse({ ...base, context: 'other' })).toBe(false);
    expect(isProviderTierResponse({ ...base, supportedTiers: ['fast', 'instant'] })).toBe(false);
    expect(isProviderTierResponse({ ...base, status: 'ok' })).toBe(false);
  });

  it('sends a GET request to the exact frame origin and validates its reply source', async () => {
    const target = createEventTarget();
    const providerWindow = { postMessage: vi.fn() };
    const panel = { panelId: 'panel-a', provider: 'chatgpt', window: providerWindow, origin: 'https://chatgpt.com' };

    const resultPromise = requestProviderTierState(panel, { target, timeoutMs: 100 });
    const request = providerWindow.postMessage.mock.calls[0][0];
    const targetOrigin = providerWindow.postMessage.mock.calls[0][1];
    expect(request).toMatchObject({ type: 'GET_PROVIDER_TIER_STATE', context: 'multi-panel' });
    expect(targetOrigin).toBe('https://chatgpt.com');

    const response = tierMessage({ requestId: request.requestId, provider: 'chatgpt' });
    target.dispatchMessage({ source: {}, origin: 'https://chatgpt.com', data: response });
    target.dispatchMessage({ source: providerWindow, origin: 'https://other.example', data: response });
    target.dispatchMessage({ source: providerWindow, origin: 'https://chatgpt.com', data: { ...response, provider: 'claude' } });
    target.dispatchMessage({ source: providerWindow, origin: 'https://chatgpt.com', data: response });

    await expect(resultPromise).resolves.toMatchObject({
      panelId: 'panel-a',
      provider: 'chatgpt',
      status: 'success',
      tier: 'balanced',
      actualLabel: 'Medium',
      requestedTier: null,
      matchedTiers: ['balanced']
    });
    expect(target.removeEventListener).toHaveBeenCalledTimes(1);
  });

  it('uses each panel origin and returns one result per panel in a batch', async () => {
    const target = createEventTarget();
    const providers = [
      { panelId: 'a', provider: 'gemini', window: { postMessage: vi.fn() }, origin: 'https://gemini.google.com' },
      { panelId: 'b', provider: 'kimi', window: { postMessage: vi.fn() }, origin: 'https://www.kimi.com', recipes: DEFAULT_TIER_RECIPES.kimi }
    ];
    const resultsPromise = runProviderTierBatch({ panels: providers, tier: 'deep', target, timeoutMs: 100 });

    providers.forEach(panel => {
      const [request] = panel.window.postMessage.mock.calls[0];
      expect(request).toMatchObject({ type: 'SET_PROVIDER_TIER', tier: 'deep', context: 'multi-panel' });
      // Only panels that carry recipes send them along.
      expect(request.recipes).toEqual(panel.recipes);
      target.dispatchMessage({
        source: panel.window,
        origin: panel.origin,
        data: tierMessage({
          type: 'PANELIZE_PROVIDER_TIER_RESULT',
          requestId: request.requestId,
          provider: panel.provider,
          tier: 'deep',
          requestedTier: 'deep',
          actualLabel: panel.provider === 'gemini' ? 'High' : 'Extreme',
          matchedTiers: ['deep']
        })
      });
    });

    await expect(resultsPromise).resolves.toEqual([
      expect.objectContaining({ panelId: 'a', provider: 'gemini', status: 'success', tier: 'deep', requestedTier: 'deep', actualLabel: 'High' }),
      expect.objectContaining({ panelId: 'b', provider: 'kimi', status: 'success', tier: 'deep', requestedTier: 'deep', actualLabel: 'Extreme' })
    ]);
  });

  it('reports timeout and cleans up the listener when a frame does not reply', async () => {
    vi.useFakeTimers();
    try {
      const target = createEventTarget();
      const source = { postMessage: vi.fn() };
      const pending = waitForProviderTierResult({
        target,
        source,
        origin: 'https://chatgpt.com',
        provider: 'chatgpt',
        requestId: 'missing-response',
        responseType: 'PANELIZE_PROVIDER_TIER_STATE',
        timeoutMs: 45
      });
      await vi.advanceTimersByTimeAsync(45);
      await expect(pending).resolves.toMatchObject({
        provider: 'chatgpt',
        status: 'timeout',
        reason: 'request_timeout',
        tier: null
      });
      expect(target.removeEventListener).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('settles immediately and removes the waiter if postMessage throws', async () => {
    const target = createEventTarget();
    const panel = {
      panelId: 'broken',
      provider: 'chatgpt',
      origin: 'https://chatgpt.com',
      window: { postMessage: () => { throw new Error('frame is navigating'); } }
    };
    await expect(requestProviderTierState(panel, { target, timeoutMs: 5000 })).resolves.toMatchObject({
      panelId: 'broken',
      provider: 'chatgpt',
      status: 'error',
      reason: 'post_message_failed',
      tier: null
    });
    expect(target.removeEventListener).toHaveBeenCalledTimes(1);
  });
});
