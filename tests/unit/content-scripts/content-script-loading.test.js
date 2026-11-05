import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import {
  TEXT_INJECTION_FILES,
  PROVIDER_TIER_FILES,
  expandContentScriptFiles
} from '../../../modules/providers/content-script-files.js';
import { OPTIONAL_PROVIDER_CONFIGS } from '../../../modules/providers/optional-provider-access.js';
import { PACKAGE_INCLUDE_PATHS } from '../../../scripts/release/release-utils.js';
import { PROJECT_ROOT } from '../../helpers/project-sources.js';
import { readContentScriptSource } from '../../helpers/content-scripts.js';

const manifest = JSON.parse(readFileSync(path.join(PROJECT_ROOT, 'manifest.json'), 'utf8'));

function assertOrder(files, bundle) {
  const ordered = bundle.filter(file => files.includes(file));
  expect(ordered).toEqual(bundle);
  expect(ordered.map(file => files.indexOf(file))).toEqual(
    ordered.map(file => files.indexOf(file)).sort((left, right) => left - right)
  );
  expect(new Set(files).size).toBe(files.length);
}

describe('classic content-script loading', () => {
  it('loads prerequisites before each static entry, in the same order as dynamic registration', () => {
    for (const script of manifest.content_scripts) {
      if (!script.js.includes(TEXT_INJECTION_FILES.at(-1))) continue;
      assertOrder(script.js, TEXT_INJECTION_FILES);
      assertOrder(script.js, PROVIDER_TIER_FILES);
    }
    for (const provider of Object.values(OPTIONAL_PROVIDER_CONFIGS)) {
      assertOrder(provider.contentScript.js, TEXT_INJECTION_FILES);
      assertOrder(provider.contentScript.js, PROVIDER_TIER_FILES);
    }
  });

  it('ships every prerequisite under a packaged runtime root', () => {
    for (const file of new Set([...TEXT_INJECTION_FILES, ...PROVIDER_TIER_FILES])) {
      expect(existsSync(path.join(PROJECT_ROOT, file)), file).toBe(true);
      expect(PACKAGE_INCLUDE_PATHS).toContain(file.split('/')[0]);
    }
  });

  it('expands stable entry names once while preserving surrounding helper order', () => {
    const files = expandContentScriptFiles(['before.js', TEXT_INJECTION_FILES.at(-1), PROVIDER_TIER_FILES.at(-1), 'after.js']);
    expect(files[0]).toBe('before.js');
    expect(files.at(-1)).toBe('after.js');
    assertOrder(files, TEXT_INJECTION_FILES);
    assertOrder(files, PROVIDER_TIER_FILES);
    expect(expandContentScriptFiles(files)).toEqual(files);
  });

  it('does not start another set of listeners when injected twice into one document', () => {
    const win = new Window({ url: 'https://chatgpt.com/' });
    const source = readContentScriptSource(path.join(PROJECT_ROOT, TEXT_INJECTION_FILES.at(-1)));
    const addListener = win.addEventListener.bind(win);
    let messageListeners = 0;
    win.addEventListener = (type, ...args) => {
      if (type === 'message') messageListeners += 1;
      return addListener(type, ...args);
    };
    try {
      win.eval(source);
      expect(messageListeners).toBeGreaterThan(0);
      const initialCount = messageListeners;
      win.eval(source);
      expect(messageListeners).toBe(initialCount);
    } finally {
      win.happyDOM.abort();
      win.close();
    }
  });
});
