export const LEGACY_DEFAULT_PROVIDER_IDS = [
  'chatgpt',
  'claude',
  'gemini',
  'grok',
  'deepseek',
  'kimi',
  'google',
];

// Target of the one-time update migration from LEGACY_DEFAULT_PROVIDER_IDS.
export const DOUBAO_MIGRATION_PROVIDER_IDS = [
  ...LEGACY_DEFAULT_PROVIDER_IDS,
  'doubao',
];

export const DEFAULT_PROVIDER_IDS = [
  'chatgpt',
  'gemini',
  'deepseek',
  'meta-ai',
  'mimo',
  'doubao',
  'yuanbao',
  'grok',
  'qwen-global',
  'zai-global',
  'google',
  'chatglm',
];

export const DEFAULT_PROVIDER_ORDER = [
  'chatgpt',
  'claude',
  'gemini',
  'deepseek',
  'google',
  'qwen-cn',
  'qwen-global',
  'chatglm',
  'zai-global',
  'meta-ai',
  'mimo',
  'doubao',
  'stepfun',
  'agnes',
  'yuanbao',
  'grok',
  'kimi',
  'hy-aistudio',
];

export const DEFAULT_STARTUP_PROVIDER_IDS = [
  'meta-ai',
  'mimo',
  'yuanbao',
  'gemini',
  'grok',
  'deepseek',
  'kimi',
  'doubao',
  'qwen-cn',
  'chatglm',
  'chatgpt',
  'stepfun',
  'agnes',
  'hy-aistudio',
  'google',
  'qwen-global',
  'zai-global',
];

export function migrateEnabledProvidersOnUpdate(enabledProviders, providerOrder) {
  const nextEnabledProviders = Array.isArray(enabledProviders)
    ? [...enabledProviders]
    : null;
  const nextProviderOrder = Array.isArray(providerOrder)
    ? [...providerOrder]
    : null;

  const enabledProvidersAreLegacyDefault =
    nextEnabledProviders === null ||
    arraysContainSameIds(nextEnabledProviders, LEGACY_DEFAULT_PROVIDER_IDS);

  if (!enabledProvidersAreLegacyDefault) {
    return null;
  }

  const migratedProviderIds = buildMigratedProviderOrder(nextProviderOrder || nextEnabledProviders);

  return {
    enabledProviders: migratedProviderIds,
    providerOrder: migratedProviderIds,
  };
}

function arraysContainSameIds(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }

  const leftIds = new Set(left);
  const rightIds = new Set(right);
  return leftIds.size === rightIds.size && left.every((value) => rightIds.has(value));
}

function buildMigratedProviderOrder(providerOrder) {
  if (!Array.isArray(providerOrder) || providerOrder.length === 0) {
    return DOUBAO_MIGRATION_PROVIDER_IDS;
  }

  const filteredExistingOrder = providerOrder.filter((providerId) =>
    LEGACY_DEFAULT_PROVIDER_IDS.includes(providerId)
  );
  const uniqueExistingOrder = [...new Set(filteredExistingOrder)];
  const missingLegacyProviders = LEGACY_DEFAULT_PROVIDER_IDS.filter(
    (providerId) => !uniqueExistingOrder.includes(providerId)
  );

  return [...uniqueExistingOrder, ...missingLegacyProviders, 'doubao'];
}
