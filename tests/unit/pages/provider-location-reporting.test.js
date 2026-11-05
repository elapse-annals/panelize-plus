import { readContentScriptSource } from '../../helpers/content-scripts.js';
import { resolve } from 'node:path';
import { Window } from 'happy-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const contentScriptSource = readContentScriptSource(
  resolve(process.cwd(), 'content-scripts/text-injection-all-providers.js'),
  'utf8'
);

function getLocationReports(postMessageSpy) {
  return postMessageSpy.mock.calls
    .map(call => call[0])
    .filter(payload => payload?.type === 'PANELIZE_PROVIDER_LOCATION' && payload?.context === 'multi-panel-provider-status');
}

describe('provider location reporting content script', () => {
  let testWindow;

  beforeEach(() => {
    testWindow = new Window({ url: 'https://chatgpt.com/c/initial' });
    Object.defineProperty(testWindow, 'parent', {
      configurable: true,
      value: { postMessage: vi.fn() },
    });
    testWindow.eval(contentScriptSource);
  });

  it('reports location on load', () => {
    const reports = getLocationReports(testWindow.parent.postMessage);

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      provider: 'chatgpt',
      url: 'https://chatgpt.com/c/initial',
    });
  });

  it.each([
    ['https://www.perplexity.ai/', 'perplexity'],
    ['https://copilot.com/chat', 'copilot'],
    ['https://copilot.microsoft.com/', 'copilot'],
    ['https://wenxin.baidu.com/', 'wenxin']
  ])('detects the provider on %s', (url, provider) => {
    const frame = new Window({ url });
    Object.defineProperty(frame, 'parent', {
      configurable: true,
      value: { postMessage: vi.fn() }
    });
    frame.eval(contentScriptSource);

    expect(getLocationReports(frame.parent.postMessage)).toContainEqual(expect.objectContaining({ provider, url }));
  });

  it('reports location after pushState', async () => {
    testWindow.history.pushState({}, '', '/c/pushed');
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(getLocationReports(testWindow.parent.postMessage)).toContainEqual(expect.objectContaining({
      provider: 'chatgpt',
      url: 'https://chatgpt.com/c/pushed',
    }));
  });

  it('reports location after replaceState', async () => {
    testWindow.history.replaceState({}, '', '/c/replaced');
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(getLocationReports(testWindow.parent.postMessage)).toContainEqual(expect.objectContaining({
      provider: 'chatgpt',
      url: 'https://chatgpt.com/c/replaced',
    }));
  });

  it('reports location after hashchange', async () => {
    testWindow.location.hash = 'thread';
    testWindow.dispatchEvent(new testWindow.HashChangeEvent('hashchange'));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(getLocationReports(testWindow.parent.postMessage)).toContainEqual(expect.objectContaining({
      provider: 'chatgpt',
      url: 'https://chatgpt.com/c/initial#thread',
    }));
  });

  it('reports location after popstate', async () => {
    testWindow.happyDOM.setURL('https://chatgpt.com/c/popstate-target');
    testWindow.parent.postMessage.mockClear();

    testWindow.dispatchEvent(new testWindow.PopStateEvent('popstate'));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(getLocationReports(testWindow.parent.postMessage)).toContainEqual(expect.objectContaining({
      provider: 'chatgpt',
      url: 'https://chatgpt.com/c/popstate-target',
    }));
  });
});
