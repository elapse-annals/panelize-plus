import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearPerplexityServiceWorker } from '../../../modules/providers/perplexity-service-worker.js';

const pageScriptSource = readFileSync(
  resolve(process.cwd(), 'content-scripts/providers/perplexity/no-service-worker.js'),
  'utf8'
);

function runPageScript({ embedded }) {
  const register = vi.fn(() => Promise.resolve({}));
  const serviceWorker = { register };
  const window = { self: {}, top: null };
  window.top = embedded ? {} : window.self;
  const context = { window, navigator: { serviceWorker }, DOMException, Promise };
  vm.createContext(context);
  vm.runInContext(pageScriptSource, context);
  return { serviceWorker, register };
}

describe('Perplexity service worker handling', () => {
  afterEach(() => {
    delete chrome.browsingData;
  });

  it('refuses service worker registration inside panels', async () => {
    const { serviceWorker, register } = runPageScript({ embedded: true });

    await expect(serviceWorker.register('/service-worker.js')).rejects.toMatchObject({ name: 'SecurityError' });
    expect(register).not.toHaveBeenCalled();
  });

  it('leaves top-level Perplexity pages alone', () => {
    const { serviceWorker, register } = runPageScript({ embedded: false });

    expect(serviceWorker.register).toBe(register);
  });

  it('clears only the Perplexity service worker', async () => {
    chrome.browsingData = { remove: vi.fn(() => Promise.resolve()) };

    await clearPerplexityServiceWorker();

    expect(chrome.browsingData.remove).toHaveBeenCalledWith(
      { origins: ['https://www.perplexity.ai'] },
      { serviceWorkers: true }
    );
  });

  it('does not block the panel when clearing fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    chrome.browsingData = { remove: vi.fn(() => Promise.reject(new Error('denied'))) };

    await expect(clearPerplexityServiceWorker()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
