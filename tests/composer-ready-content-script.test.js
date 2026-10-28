import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Window } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(resolve('content-scripts/text-injection-all-providers.js'), 'utf8');

function readyReports(parent) {
  return parent.postMessage.mock.calls
    .map(call => call[0])
    .filter(payload => payload?.type === 'PANELIZE_COMPOSER_READY'
      && payload?.context === 'multi-panel-provider-status');
}

describe('composer ready reporting content script', () => {
  let frame;

  afterEach(() => {
    frame?.dispatchEvent(new frame.Event('pagehide'));
    frame?.happyDOM.abort();
    frame = null;
  });

  function createFrame(url, { inPanel = true, body = '' } = {}) {
    frame = new Window({ url });
    const parent = { postMessage: vi.fn() };
    Object.defineProperty(frame, 'parent', { configurable: true, value: parent });
    Object.defineProperty(frame, 'top', { configurable: true, value: inPanel ? parent : {} });
    frame.document.body.innerHTML = body;
    frame.eval(source);
    return parent;
  }

  it('reports right away when the question box already exists', () => {
    const parent = createFrame('https://claude.ai/new', {
      body: '<div class="ProseMirror" contenteditable="true"></div>'
    });

    expect(readyReports(parent)).toEqual([expect.objectContaining({ provider: 'claude' })]);
  });

  it('reports once the question box appears', async () => {
    const parent = createFrame('https://claude.ai/new');
    expect(readyReports(parent)).toHaveLength(0);

    frame.document.body.innerHTML = '<div class="ProseMirror" contenteditable="true"></div>';
    await new Promise(done => setTimeout(done, 400));

    expect(readyReports(parent)).toHaveLength(1);

    frame.document.body.appendChild(frame.document.createElement('p'));
    await new Promise(done => setTimeout(done, 400));
    expect(readyReports(parent)).toHaveLength(1);
  });

  it('does not report outside a Multi-Panel frame', () => {
    const parent = createFrame('https://claude.ai/new', {
      inPanel: false,
      body: '<div class="ProseMirror" contenteditable="true"></div>'
    });

    expect(readyReports(parent)).toHaveLength(0);
  });
});
