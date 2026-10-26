import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createPatchedExtensionCopy } from './extension-harness.js';

const PROVIDERS_EXPORT_MARKER = '  }\n];\n\nexport function getProviderIcon';
const PROVIDER_HOSTS_MARKER = "  agnes: new Set(['app.agnes-ai.com'])";

export function syntheticProviderIds(count) {
  return Array.from({ length: count }, (_, index) => `e2e-provider-${String(index + 1).padStart(2, '0')}`);
}

/**
 * Adds providers only to a disposable extension copy so capacity tests can
 * cover more providers than the product currently ships.
 * @param {object} options
 * @param {number} options.syntheticProviderCount
 * @param {(manifest: object) => void} [options.patchManifest]
 */
export async function createPanelCapacityExtensionCopy({ syntheticProviderCount, patchManifest } = {}) {
  const extensionCopy = await createPatchedExtensionCopy(patchManifest || (() => {}));

  try {
    const providerIds = syntheticProviderIds(syntheticProviderCount || 0);
    if (providerIds.length === 0) return { ...extensionCopy, providerIds };

    const providersPath = path.join(extensionCopy.extensionPath, 'modules/providers.js');
    const providerSource = await readFile(providersPath, 'utf8');
    if (!providerSource.includes(PROVIDERS_EXPORT_MARKER)) {
      throw new Error('Could not find the providers array in the patched extension copy');
    }

    const providerEntries = providerIds.map((id) => `  {
    id: '${id}',
    name: 'E2E Provider ${id.slice(-2)}',
    url: 'https://chatgpt.com/?synthetic=${id}',
    topLevelUrl: 'https://chatgpt.com/?synthetic=${id}',
    icon: '/icons/providers/chatgpt.png',
    iconDark: '/icons/providers/dark/chatgpt.png',
    enabled: true
  }`).join(',\n');
    await writeFile(providersPath, providerSource.replace(
      PROVIDERS_EXPORT_MARKER,
      `  },\n${providerEntries}\n];\n\nexport function getProviderIcon`
    ));

    // The startup snapshot URL allowlist is keyed by provider id. In this
    // test-only copy, synthetic providers deliberately share ChatGPT's host.
    const openUrlPath = path.join(extensionCopy.extensionPath, 'modules/provider-open-url.js');
    const openUrlSource = await readFile(openUrlPath, 'utf8');
    if (!openUrlSource.includes(PROVIDER_HOSTS_MARKER)) {
      throw new Error('Could not find the provider host allowlist in the patched extension copy');
    }
    const syntheticHosts = providerIds
      .map((id) => `  '${id}': new Set(['chatgpt.com'])`)
      .join(',\n');
    await writeFile(
      openUrlPath,
      openUrlSource.replace(PROVIDER_HOSTS_MARKER, `${PROVIDER_HOSTS_MARKER},\n${syntheticHosts}`)
    );

    return { ...extensionCopy, providerIds };
  } catch (error) {
    await extensionCopy.cleanup();
    throw error;
  }
}
