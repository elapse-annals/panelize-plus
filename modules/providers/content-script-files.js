/** Ordered classic scripts shared by registration, packaging and tests. */
export const TEXT_INJECTION_FILES = Object.freeze([
  'content-scripts/runtime/namespace.js',
  'content-scripts/runtime/config.js',
  'content-scripts/runtime/dom.js',
  'content-scripts/runtime/protocol.js',
  'content-scripts/runtime/security.js',
  'content-scripts/providers/chatglm/adapter.js',
  'content-scripts/providers/chatgpt/adapter.js',
  'content-scripts/providers/claude/adapter.js',
  'content-scripts/providers/deepseek/adapter.js',
  'content-scripts/providers/doubao/adapter.js',
  'content-scripts/providers/gemini/adapter.js',
  'content-scripts/providers/google/adapter.js',
  'content-scripts/providers/grok/adapter.js',
  'content-scripts/providers/kimi/adapter.js',
  'content-scripts/providers/mimo/adapter.js',
  'content-scripts/providers/qwen/adapter.js',
  'content-scripts/providers/yuanbao/adapter.js',
  'content-scripts/providers/zai-global/adapter.js',
  'content-scripts/features/answers.js',
  'content-scripts/features/composer.js',
  'content-scripts/features/focus.js',
  'content-scripts/features/messages.js',
  'content-scripts/features/new-chat.js',
  'content-scripts/features/readiness.js',
  'content-scripts/features/reporting.js',
  'content-scripts/features/sending.js',
  'content-scripts/features/snapshots/geometry.js',
  'content-scripts/features/snapshots/session.js',
  'content-scripts/features/snapshots/styles.js',
  'content-scripts/features/uploads.js',
  'content-scripts/text-injection-all-providers.js'
]);

export const PROVIDER_TIER_FILES = Object.freeze([
  'content-scripts/runtime/namespace.js',
  'content-scripts/features/tiers/config.js',
  'content-scripts/features/tiers/discovery.js',
  'content-scripts/features/tiers/dom.js',
  'content-scripts/features/tiers/menu.js',
  'content-scripts/features/tiers/recipes.js',
  'content-scripts/features/tiers/requests.js',
  'content-scripts/features/tiers/slider.js',
  'content-scripts/provider-tiers.js'
]);

/** Expand stable entry filenames while keeping each prerequisite once. */
export function expandContentScriptFiles(files) {
  const bundles = new Map([
    [TEXT_INJECTION_FILES.at(-1), TEXT_INJECTION_FILES],
    [PROVIDER_TIER_FILES.at(-1), PROVIDER_TIER_FILES]
  ]);
  return [...new Set(files.flatMap(file => bundles.get(file) || [file]))];
}
