import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';

const source = readFileSync(resolve(process.cwd(), 'content-scripts/page-style.js'), 'utf8');
const extensionOrigin = 'chrome-extension://panelize-test';
const windows = new Set();

function createFrame({ url = 'https://chatgpt.com/', html = '', embedded = true } = {}) {
  const win = new Window({ url });
  const parent = { postMessage() {} };
  win.chrome = { runtime: { getURL: () => `${extensionOrigin}/` } };
  if (embedded) Object.defineProperty(win, 'parent', { configurable: true, value: parent });
  win.document.body.innerHTML = html;
  win.eval(source);
  windows.add(win);
  return { win, parent };
}

function send(frame, data, { origin = extensionOrigin, sourceWindow = frame.parent } = {}) {
  const event = new frame.win.Event('message');
  Object.assign(event, { data: { type: 'PANELIZE_PAGE_STYLE', context: 'multi-panel', ...data }, origin, source: sourceWindow });
  frame.win.dispatchEvent(event);
}

const styleText = frame => frame.win.document.getElementById('panelize-page-style')?.textContent || '';

afterEach(() => {
  for (const win of windows) win.happyDOM.abort();
  windows.clear();
});

describe('page style content script', () => {
  it('adds and removes the wide and blind styles on request from the extension frame', () => {
    const frame = createFrame();
    send(frame, { wide: true, blind: false });
    expect(styleText(frame)).toContain('--thread-content-max-width: 100%');
    expect(styleText(frame)).not.toContain('font-family');

    send(frame, { wide: true, blind: true });
    expect(styleText(frame)).toContain('font-family');
    expect(frame.win.PanelizePageStyle.getState()).toEqual({ wide: true, blind: true });

    send(frame, { wide: false, blind: false });
    expect(frame.win.document.getElementById('panelize-page-style')).toBeNull();
  });

  it('marks fixed-width ancestors of the composer as wide columns', () => {
    const frame = createFrame({
      url: 'https://chat.z.ai/',
      html: '<div id="column" style="max-width: 768px"><div id="inner"><textarea></textarea></div></div><div id="other" style="max-width: 768px"></div>'
    });
    send(frame, { wide: true });
    const doc = frame.win.document;
    expect(doc.getElementById('column').hasAttribute('data-panelize-wide')).toBe(true);
    expect(doc.getElementById('inner').hasAttribute('data-panelize-wide')).toBe(false);
    expect(doc.getElementById('other').hasAttribute('data-panelize-wide')).toBe(false);

    send(frame, { wide: false });
    expect(doc.getElementById('column').hasAttribute('data-panelize-wide')).toBe(false);
  });

  it('puts the style back when the page removes it', async () => {
    const frame = createFrame();
    send(frame, { blind: true });
    frame.win.document.getElementById('panelize-page-style').remove();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(styleText(frame)).toContain('font-family');
  });

  it('ignores messages from other origins, other windows and top-level pages', () => {
    const frame = createFrame();
    send(frame, { blind: true }, { origin: 'https://attacker.example' });
    send(frame, { blind: true }, { sourceWindow: {} });
    expect(styleText(frame)).toBe('');

    const topLevel = createFrame({ embedded: false });
    send(topLevel, { blind: true }, { sourceWindow: topLevel.win });
    expect(styleText(topLevel)).toBe('');
  });
});
