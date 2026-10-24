function createContentScript(id, matches, enterBehaviorScript) {
  return {
    id,
    matches,
    js: [
      'content-scripts/button-finder-utils.js',
      'content-scripts/enter-behavior-utils.js',
      enterBehaviorScript,
      'content-scripts/text-injection-all-providers.js',
      'content-scripts/keyboard-shortcuts.js',
      'content-scripts/provider-tiers.js',
      'content-scripts/page-style.js',
      'content-scripts/focus-toggle.js'
    ],
    runAt: 'document_start',
    allFrames: true,
    persistAcrossSessions: true
  };
}

function createFrameRule(id, urlFilter) {
  // Installed only for enabled providers and scoped to their embedded subframes.
  return {
    id,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      responseHeaders: [
        { header: 'X-Frame-Options', operation: 'remove' },
        { header: 'Content-Security-Policy', operation: 'remove' }
      ]
    },
    condition: {
      urlFilter,
      resourceTypes: ['sub_frame']
    }
  };
}

function createDomainFrameRule(id, requestDomains) {
  // For providers whose embedded flow spans several hosts, such as a separate sign-in host.
  const rule = createFrameRule(id, null);
  delete rule.condition.urlFilter;
  rule.condition.requestDomains = requestDomains;
  return rule;
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function valuesEqual(left, right) {
  if (left === right) {
    return true;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => valuesEqual(value, right[index]));
  }

  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return arraysEqual(leftKeys, rightKeys)
      && leftKeys.every((key) => valuesEqual(left[key], right[key]));
  }

  return false;
}

function normalizeContentScript(script) {
  return {
    matches: script.matches || [],
    excludeMatches: script.excludeMatches || [],
    includeGlobs: script.includeGlobs || [],
    excludeGlobs: script.excludeGlobs || [],
    css: script.css || [],
    js: script.js || [],
    allFrames: script.allFrames ?? false,
    matchAboutBlank: script.matchAboutBlank ?? false,
    matchOriginAsFallback: script.matchOriginAsFallback ?? false,
    runAt: script.runAt || 'document_idle',
    world: script.world || 'ISOLATED',
    persistAcrossSessions: script.persistAcrossSessions ?? true
  };
}

function normalizeFrameRule(rule) {
  return {
    id: rule.id,
    priority: rule.priority ?? 1,
    action: {
      type: rule.action.type,
      responseHeaders: [...(rule.action.responseHeaders || [])]
        .map(({ header, operation, value }) => ({ header, operation, value }))
        .sort((left, right) => (left.header || '').localeCompare(right.header || ''))
    },
    condition: {
      urlFilter: rule.condition.urlFilter,
      requestDomains: [...(rule.condition.requestDomains || [])].sort(),
      resourceTypes: [...(rule.condition.resourceTypes || [])].sort()
    }
  };
}

export const OPTIONAL_PROVIDER_CONFIGS = Object.freeze({
  'qwen-cn': Object.freeze({
    origins: Object.freeze(['https://www.qianwen.com/*']),
    contentScript: Object.freeze(createContentScript(
      'qwen-cn-scripts',
      ['https://www.qianwen.com/*'],
      'content-scripts/enter-behavior-qwen-cn.js'
    )),
    frameRule: Object.freeze(createFrameRule(1001, 'https://www.qianwen.com/*'))
  }),
  'qwen-global': Object.freeze({
    // Qwen refreshes its session on a separate origin. Host access lets its
    // embedded requests carry the same-site authentication cookies there.
    origins: Object.freeze(['https://chat.qwen.ai/*', 'https://auth.qwen.ai/*']),
    contentScript: Object.freeze(createContentScript(
      'qwen-global-scripts',
      ['https://chat.qwen.ai/*'],
      'content-scripts/enter-behavior-qwen-global.js'
    )),
    frameRule: Object.freeze(createFrameRule(1002, 'https://chat.qwen.ai/*'))
  }),
  chatglm: Object.freeze({
    origins: Object.freeze(['https://chatglm.cn/*']),
    contentScript: Object.freeze(createContentScript(
      'chatglm-scripts',
      ['https://chatglm.cn/*'],
      'content-scripts/enter-behavior-chatglm.js'
    )),
    frameRule: Object.freeze(createFrameRule(1003, 'https://chatglm.cn/*'))
  }),
  'zai-global': Object.freeze({
    origins: Object.freeze(['https://chat.z.ai/*']),
    contentScript: Object.freeze(createContentScript(
      'zai-global-scripts',
      ['https://chat.z.ai/*'],
      'content-scripts/enter-behavior-zai-global.js'
    )),
    frameRule: Object.freeze(createFrameRule(1004, 'https://chat.z.ai/*'))
  }),
  yuanbao: Object.freeze({
    origins: Object.freeze(['https://yuanbao.tencent.com/*']),
    contentScript: Object.freeze(createContentScript(
      'yuanbao-scripts',
      ['https://yuanbao.tencent.com/*'],
      'content-scripts/enter-behavior-yuanbao.js'
    ))
  }),
  mimo: Object.freeze({
    // MiMo signs in through Xiaomi Account, which refuses to be framed by default.
    // Its parent-domain session cookies also require access to xiaomimimo.com.
    origins: Object.freeze([
      'https://aistudio.xiaomimimo.com/*',
      'https://xiaomimimo.com/*',
      'https://account.xiaomi.com/*'
    ]),
    contentScript: Object.freeze(createContentScript(
      'mimo-scripts',
      ['https://aistudio.xiaomimimo.com/*'],
      'content-scripts/enter-behavior-mimo.js'
    )),
    frameRule: Object.freeze(createDomainFrameRule(1005, ['aistudio.xiaomimimo.com', 'account.xiaomi.com']))
  }),
  'meta-ai': Object.freeze({
    origins: Object.freeze(['https://www.meta.ai/*']),
    contentScript: Object.freeze(createContentScript(
      'meta-ai-scripts',
      ['https://www.meta.ai/*'],
      'content-scripts/enter-behavior-meta-ai.js'
    )),
    frameRule: Object.freeze(createFrameRule(1006, 'https://www.meta.ai/*'))
  })
});

export function getOptionalProviderConfig(providerId) {
  return OPTIONAL_PROVIDER_CONFIGS[providerId] || null;
}

export async function hasOptionalProviderPermission(providerId) {
  const config = getOptionalProviderConfig(providerId);
  if (!config) {
    return true;
  }

  return chrome.permissions.contains({ origins: [...config.origins] });
}

export function requestOptionalProviderPermission(providerId) {
  const config = getOptionalProviderConfig(providerId);
  if (!config) {
    return Promise.resolve(true);
  }

  return chrome.permissions.request({ origins: [...config.origins] });
}

export async function filterProvidersWithGrantedAccess(providerIds) {
  if (!Array.isArray(providerIds)) {
    return [];
  }

  const accessChecks = await Promise.all(providerIds.map(async (providerId) => ({
    providerId,
    granted: await hasOptionalProviderPermission(providerId)
  })));

  return accessChecks
    .filter(({ granted }) => granted)
    .map(({ providerId }) => providerId);
}

export async function syncOptionalProviderAccess(enabledProviderIds) {
  const enabledIds = new Set(Array.isArray(enabledProviderIds) ? enabledProviderIds : []);
  const configs = Object.entries(OPTIONAL_PROVIDER_CONFIGS);
  const desiredConfigs = [];

  for (const [providerId, config] of configs) {
    if (enabledIds.has(providerId) && await hasOptionalProviderPermission(providerId)) {
      desiredConfigs.push(config);
    }
  }

  await syncContentScripts(configs.map(([, config]) => config), desiredConfigs);
  await syncFrameRules(configs.map(([, config]) => config), desiredConfigs);
}

/**
 * Reconcile device-local scripts and frame rules with the synced provider preference.
 * Missing device permissions must never overwrite the user's synced preference.
 */
export async function reconcileOptionalProviderAccess() {
  try {
    const settings = await chrome.storage.sync.get({ enabledProviders: [] });
    const enabledProviderIds = Array.isArray(settings.enabledProviders)
      ? settings.enabledProviders
      : [];

    await syncOptionalProviderAccess(enabledProviderIds);
  } catch (error) {
    console.error('[Background] Failed to synchronize optional provider access:', error);
  }
}

async function syncContentScripts(allConfigs, desiredConfigs) {
  if (!chrome.scripting?.getRegisteredContentScripts) {
    return;
  }

  const managedScriptIds = new Set(allConfigs.map(({ contentScript }) => contentScript.id));
  const desiredScriptIds = new Set(desiredConfigs.map(({ contentScript }) => contentScript.id));
  const registeredScripts = await chrome.scripting.getRegisteredContentScripts();
  const registeredManagedScripts = registeredScripts
    .filter(({ id }) => managedScriptIds.has(id));
  const registeredById = new Map(registeredManagedScripts.map((script) => [script.id, script]));
  const registeredManagedIds = registeredManagedScripts.map(({ id }) => id);
  const scriptIdsToRemove = registeredManagedIds.filter((id) => !desiredScriptIds.has(id));

  if (scriptIdsToRemove.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: scriptIdsToRemove });
  }

  const scriptsToRegister = [];
  const scriptsToUpdate = [];
  for (const { contentScript } of desiredConfigs) {
    const registeredScript = registeredById.get(contentScript.id);
    if (!registeredScript) {
      scriptsToRegister.push(contentScript);
    } else if (!valuesEqual(
      normalizeContentScript(registeredScript),
      normalizeContentScript(contentScript)
    )) {
      scriptsToUpdate.push(contentScript);
    }
  }

  if (scriptsToUpdate.length > 0 && chrome.scripting.updateContentScripts) {
    await chrome.scripting.updateContentScripts(scriptsToUpdate);
  } else if (scriptsToUpdate.length > 0) {
    await chrome.scripting.unregisterContentScripts({
      ids: scriptsToUpdate.map(({ id }) => id)
    });
    scriptsToRegister.push(...scriptsToUpdate);
  }

  if (scriptsToRegister.length > 0) {
    await chrome.scripting.registerContentScripts(scriptsToRegister);
  }
}

async function syncFrameRules(allConfigs, desiredConfigs) {
  if (!chrome.declarativeNetRequest?.getDynamicRules) {
    return;
  }

  const allFrameRules = allConfigs
    .map(({ frameRule }) => frameRule)
    .filter(Boolean);
  const desiredFrameRules = desiredConfigs
    .map(({ frameRule }) => frameRule)
    .filter(Boolean);
  const managedRuleIds = new Set(allFrameRules.map(({ id }) => id));
  const desiredRuleIds = new Set(desiredFrameRules.map(({ id }) => id));
  const dynamicRules = await chrome.declarativeNetRequest.getDynamicRules();
  const installedManagedRules = dynamicRules
    .filter(({ id }) => managedRuleIds.has(id));
  const installedById = new Map(installedManagedRules.map((rule) => [rule.id, rule]));
  const installedManagedRuleIds = installedManagedRules.map(({ id }) => id);
  const removeRuleIds = installedManagedRuleIds.filter((id) => !desiredRuleIds.has(id));
  const addRules = [];
  for (const desiredRule of desiredFrameRules) {
    const installedRule = installedById.get(desiredRule.id);
    if (!installedRule) {
      addRules.push(desiredRule);
    } else if (!valuesEqual(
      normalizeFrameRule(installedRule),
      normalizeFrameRule(desiredRule)
    )) {
      removeRuleIds.push(desiredRule.id);
      addRules.push(desiredRule);
    }
  }

  if (removeRuleIds.length > 0 || addRules.length > 0) {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
  }
}
