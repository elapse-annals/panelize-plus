import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';

const source = readFileSync(resolve(process.cwd(), 'content-scripts/page-style.js'), 'utf8');
const extensionOrigin = 'chrome-extension://panelize-test';
const windows = new Set();

function createFrame({ url = 'https://chatgpt.com/', html = '', embedded = true, ancestorOrigins, ResizeObserver: ResizeObserverClass } = {}) {
  const win = new Window({ url });
  if (ancestorOrigins) Object.defineProperty(win.location, 'ancestorOrigins', { configurable: true, value: ancestorOrigins });
  const parent = { postMessage() {} };
  win.chrome = { runtime: { getURL: () => `${extensionOrigin}/` } };
  if (ResizeObserverClass) win.ResizeObserver = ResizeObserverClass;
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

function setVisibleGeometry(element, { width = 400, height = 100 } = {}) {
  const geometry = { width, height };
  element.getBoundingClientRect = () => ({
    width: geometry.width,
    height: geometry.height,
    top: 0,
    right: geometry.width,
    bottom: geometry.height,
    left: 0,
    x: 0,
    y: 0
  });
  element.getClientRects = () => [{ width: geometry.width, height: geometry.height }];
  return { resize: next => Object.assign(geometry, next) };
}

function createResizeObserverMock() {
  const observers = [];
  class MockResizeObserver {
    constructor(callback) {
      this.callback = callback;
      this.targets = new Set();
      this.disconnectCalls = 0;
      observers.push(this);
    }

    observe(target) { this.targets.add(target); }
    unobserve(target) { this.targets.delete(target); }
    disconnect() {
      this.disconnectCalls += 1;
      this.targets.clear();
    }
  }

  return { ResizeObserverClass: MockResizeObserver, observers };
}

afterEach(() => {
  for (const win of windows) win.happyDOM.abort();
  windows.clear();
});

function pressMouseButton(frame, button) {
  const event = new frame.win.MouseEvent('mouseup', { button, bubbles: true, cancelable: true });
  frame.win.document.body.dispatchEvent(event);
  return event.defaultPrevented;
}

function wheel(frame, { deltaX = 0, deltaY = 0, deltaMode = 0, ctrlKey = false, timeStamp = 0, target } = {}) {
  const event = new frame.win.WheelEvent('wheel', { deltaX, deltaY, deltaMode, ctrlKey, bubbles: true });
  Object.defineProperty(event, 'timeStamp', { value: timeStamp });
  Object.defineProperty(event, 'ctrlKey', { value: ctrlKey });
  (target || frame.win.document.body).dispatchEvent(event);
}

function recordPosts(frame) {
  const posts = [];
  frame.parent.postMessage = (message, origin) => posts.push({ message, origin });
  return posts;
}

describe('page style content script', () => {
  it('hands horizontal swipes to the extension page so the panel row scrolls', () => {
    const panel = createFrame({ ancestorOrigins: [extensionOrigin] });
    const posts = recordPosts(panel);
    wheel(panel, { deltaX: 30, deltaY: 2, timeStamp: 1000 });
    // Momentum in the same gesture keeps going to the host.
    wheel(panel, { deltaX: 8, deltaY: 9, timeStamp: 1050 });
    expect(posts).toEqual([
      { message: { type: 'PANELIZE_PANEL_WHEEL', context: 'multi-panel', deltaX: 30 }, origin: extensionOrigin },
      { message: { type: 'PANELIZE_PANEL_WHEEL', context: 'multi-panel', deltaX: 8 }, origin: extensionOrigin }
    ]);

    posts.length = 0;
    wheel(panel, { deltaX: 2, deltaY: 40, timeStamp: 2000 });
    wheel(panel, { deltaX: 30, deltaY: 0, timeStamp: 2050 });
    wheel(panel, { deltaX: 30, ctrlKey: true, timeStamp: 3000 });
    expect(posts).toEqual([]);

    wheel(panel, { deltaX: -2, deltaMode: 1, timeStamp: 4000 });
    expect(posts.at(-1).message.deltaX).toBe(-32);
  });

  it('leaves horizontal swipes to an inner element that can still scroll that way', () => {
    const panel = createFrame({
      ancestorOrigins: [extensionOrigin],
      html: '<pre id="code" style="overflow-x: auto"><code id="line">wide line</code></pre>'
    });
    const posts = recordPosts(panel);
    const code = panel.win.document.getElementById('code');
    Object.defineProperty(code, 'scrollWidth', { configurable: true, value: 800 });
    Object.defineProperty(code, 'clientWidth', { configurable: true, value: 300 });
    code.scrollLeft = 0;
    const target = panel.win.document.getElementById('line');

    wheel(panel, { deltaX: 20, timeStamp: 1000, target });
    expect(posts).toEqual([]);
    // At its start edge the block cannot scroll further left, so the row does.
    wheel(panel, { deltaX: -20, timeStamp: 2000, target });
    expect(posts).toHaveLength(1);
  });

  it('only forwards swipes from a direct child frame of the extension page', () => {
    for (const options of [
      { ancestorOrigins: ['https://chatgpt.com', extensionOrigin] },
      { ancestorOrigins: ['https://attacker.test'] },
      { embedded: false }
    ]) {
      const frame = createFrame(options);
      const posts = recordPosts(frame);
      wheel(frame, { deltaX: 30, timeStamp: 1000 });
      expect(posts).toEqual([]);
    }
  });

  it('blocks mouse back and forward buttons only in frames under the extension page', () => {
    const panel = createFrame({ ancestorOrigins: [extensionOrigin] });
    expect(pressMouseButton(panel, 3)).toBe(true);
    expect(pressMouseButton(panel, 4)).toBe(true);
    expect(pressMouseButton(panel, 0)).toBe(false);

    const nested = createFrame({ ancestorOrigins: ['https://chatgpt.com', extensionOrigin] });
    expect(pressMouseButton(nested, 3)).toBe(true);

    const foreign = createFrame({ ancestorOrigins: ['https://attacker.test'] });
    expect(pressMouseButton(foreign, 3)).toBe(false);

    const topLevel = createFrame({ embedded: false });
    expect(pressMouseButton(topLevel, 3)).toBe(false);
  });

  it('adds and removes the blind style on request from the extension frame and ignores wide', () => {
    const frame = createFrame();
    send(frame, { wide: true, blind: false });
    expect(frame.win.document.getElementById('panelize-page-style')).toBeNull();

    send(frame, { wide: true, blind: true });
    expect(styleText(frame)).toContain('font-family');
    expect(frame.win.PanelizePageStyle.getState()).toEqual({ blind: true });

    send(frame, { blind: false });
    expect(frame.win.document.getElementById('panelize-page-style')).toBeNull();
  });

  it('includes the fixed composer and normalized answer spacing rules in blind CSS', () => {
    const frame = createFrame();
    send(frame, { blind: true });
    const css = styleText(frame);

    expect(css).toContain('[data-panelize-composer] {');
    expect(css).toContain('position: fixed !important; left: 12px !important; right: 12px !important; bottom: 12px !important;');
    expect(css).toContain('[data-panelize-scroller] { padding-bottom: var(--panelize-composer-space, 160px) !important; }');
    expect(css).toContain(':where(p, ul, ol, pre, blockquote, table) { margin: 0 0 0.75em !important; }');
    expect(css).toContain(':where(li) { margin: 0.25em 0 !important; }');
    expect(css).toContain(':where(ul, ol) { padding-left: 1.5em !important; }');
    expect(css).toContain(':where(h1, h2, h3, h4, h5, h6) {');
    expect(css).toContain('margin: 1.2em 0 0.5em !important; line-height: 1.4 !important;');
    expect(css).toContain(':where(h1) { font-size: 1.5em !important; }');
    expect(css).toContain(':where(h2) { font-size: 1.3em !important; }');
    expect(css).toContain(':where(h3) { font-size: 1.15em !important; }');
    expect(css).toContain(':where(h4, h5, h6) { font-size: 1em !important; }');
    expect(css).toContain(':where(hr) { margin: 1em 0 !important; }');
  });

  it('gives every provider page one background, composer shell and code block look in blind CSS', () => {
    const frame = createFrame();
    send(frame, { blind: true });
    const css = styleText(frame);

    expect(css).toContain('html, body { background: #fff !important; color-scheme: light !important; }');
    expect(css).toContain(':where([data-panelize-keep]):not([data-panelize-composer], [data-panelize-composer] *, table, table *, hr) {');
    expect(css).toContain('background: transparent !important; border-color: transparent !important; box-shadow: none !important;');
    expect(css).toContain('[data-panelize-composer] > * { opacity: 0 !important; }');
    expect(css).toContain('[data-panelize-composer]::after {');
    expect(css).toContain('height: 56px !important;');
    expect(css).toContain('background: #fff !important; border: 1px solid #d9d9de !important;');
    expect(css).toContain(':where([data-panelize-composer] *):not(button, [role="button"], button *, [role="button"] *) {');
    expect(css).toContain('background: #f5f5f5 !important; border: none !important; border-radius: 8px !important;');
    // Shared rules come before the model-label rule so its transparent text still wins.
    expect(css.indexOf('color: #1f1f1f')).toBeLessThan(css.indexOf('color: transparent !important; text-shadow'));
  });

  it('greys the page, hides placeholders and masks provider names outside inputs and code', async () => {
    const frame = createFrame({
      html: '<p id="answer">I am ChatGPT, made by OpenAI. 我是豆包。Googleplex stays.</p><textarea id="input">ask Claude</textarea><pre id="code">import openai # Claude</pre>'
    });
    send(frame, { blind: true });
    const doc = frame.win.document;
    expect(styleText(frame)).toContain('filter: grayscale(1)');
    expect(styleText(frame)).toContain('::placeholder');
    expect(doc.getElementById('answer').textContent).toBe('I am ███, made by ███. 我是███。Googleplex stays.');
    expect(doc.getElementById('input').value).toBe('ask Claude');
    expect(doc.getElementById('code').textContent).toBe('import openai # Claude');

    doc.getElementById('answer').append(' Gemini here');
    await new Promise(resolve => setTimeout(resolve, 260));
    expect(doc.getElementById('answer').textContent).toContain('███ here');

    send(frame, { blind: false });
    expect(doc.getElementById('answer').textContent).toBe('I am ChatGPT, made by OpenAI. 我是豆包。Googleplex stays. Gemini here');
  });

  it('does not rescan the whole page for its own masked text or stream changes inside an answer', async () => {
    const frame = createFrame({
      html: '<main><article class="prose" id="answer">ChatGPT answer</article><form id="composer-form"><textarea id="composer"></textarea><button aria-label="Send">Send</button></form></main>'
    });
    const { document } = frame.win;
    setVisibleGeometry(document.getElementById('composer'));
    setVisibleGeometry(document.getElementById('composer-form'), { height: 80 });

    const treeWalkerRoots = [];
    const createTreeWalker = document.createTreeWalker.bind(document);
    document.createTreeWalker = (root, ...args) => {
      treeWalkerRoots.push(root);
      return createTreeWalker(root, ...args);
    };
    const nativeQuerySelectorAll = document.querySelectorAll.bind(document);
    let isolationPasses = 0;
    document.querySelectorAll = (selector, ...args) => {
      if (selector === '[data-panelize-keep], [data-panelize-hide], [data-panelize-collapse], [data-panelize-composer], [data-panelize-scroller]') isolationPasses += 1;
      return nativeQuerySelectorAll(selector, ...args);
    };

    send(frame, { blind: true });
    await new Promise(resolve => setTimeout(resolve, 260));
    expect(treeWalkerRoots).toEqual([document.body]);
    expect(isolationPasses).toBe(1);

    const answer = document.getElementById('answer');
    answer.firstChild.nodeValue = 'OpenAI is streaming';
    await new Promise(resolve => setTimeout(resolve, 260));
    expect(answer.textContent).toBe('███ is streaming');
    expect(treeWalkerRoots).toEqual([document.body]);
    expect(isolationPasses).toBe(1);

    send(frame, { blind: false });
    expect(answer.textContent).toBe('OpenAI is streaming');

    send(frame, { blind: true });
    const movedRoot = document.createElement('section');
    document.body.append(movedRoot);
    movedRoot.append(answer);
    await new Promise(resolve => setTimeout(resolve, 260));
    expect(answer.textContent).toBe('███ is streaming');
    send(frame, { blind: false });
    expect(answer.textContent).toBe('OpenAI is streaming');
  });

  it('isolates the composer, answers, model picker and menu portals', async () => {
    const frame = createFrame({
      html: '<header id="welcome">Provider home</header><aside id="sidebar">Chat history</aside><main id="app"><section id="conversation" style="overflow-y:auto"><article class="prose" id="answer">Answer content</article></section><form id="composer-root"><textarea id="composer"></textarea><button aria-label="Send">Send</button><button data-testid="model-switcher-dropdown-button" id="model-picker">Model</button></form></main><div id="menu-wrapper"><div role="menu" id="menu">Menu item</div></div><footer id="footer">Provider footer</footer>'
    });
    const { document } = frame.win;
    for (const element of document.querySelectorAll('textarea, [contenteditable="true"]')) setVisibleGeometry(element);
    setVisibleGeometry(document.getElementById('composer-root'), { height: 90 });
    document.getElementById('composer').focus();

    send(frame, { blind: true });
    expect(styleText(frame)).toContain('[data-panelize-hide] { display: none !important; }');
    expect(styleText(frame)).toContain('img[alt*="logo" i]');
    expect(styleText(frame)).toContain('{ display: none !important; }');
    for (const id of ['welcome', 'sidebar', 'footer']) {
      expect(document.getElementById(id).hasAttribute('data-panelize-hide')).toBe(true);
    }
    for (const id of ['composer-root', 'composer', 'answer', 'model-picker']) {
      expect(document.getElementById(id).hasAttribute('data-panelize-keep')).toBe(true);
      expect(document.getElementById(id).hasAttribute('data-panelize-hide')).toBe(false);
    }
    expect(document.getElementById('composer-root').hasAttribute('data-panelize-composer')).toBe(true);
    expect(document.getElementById('conversation').hasAttribute('data-panelize-scroller')).toBe(true);
    expect(document.getElementById('menu-wrapper').hasAttribute('data-panelize-hide')).toBe(false);
    expect(document.getElementById('menu').hasAttribute('data-panelize-hide')).toBe(false);

    const dynamicMenu = document.createElement('div');
    dynamicMenu.innerHTML = '<div role="listbox" id="dynamic-menu">Choice</div>';
    dynamicMenu.id = 'dynamic-menu-wrapper';
    document.body.append(dynamicMenu);
    await new Promise(resolve => setTimeout(resolve, 260));
    expect(document.getElementById('dynamic-menu-wrapper').hasAttribute('data-panelize-hide')).toBe(false);

    send(frame, { blind: false });
    expect(document.querySelectorAll('[data-panelize-keep], [data-panelize-hide]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-panelize-composer], [data-panelize-scroller]')).toHaveLength(0);
    expect(document.documentElement.style.getPropertyValue('--panelize-composer-space')).toBe('');
    expect(document.body.style.getPropertyValue('--panelize-composer-space')).toBe('');
  });

  it('uses the document scroller for an empty new conversation and removes its markers on disable', () => {
    const frame = createFrame({
      html: '<main><form id="composer-root"><textarea id="composer"></textarea><button aria-label="Send">Send</button></form></main>'
    });
    const { document } = frame.win;
    Object.defineProperty(document, 'scrollingElement', { configurable: true, value: document.documentElement });
    setVisibleGeometry(document.getElementById('composer'));
    setVisibleGeometry(document.getElementById('composer-root'), { height: 86 });

    send(frame, { blind: true });

    expect(document.getElementById('composer-root').hasAttribute('data-panelize-composer')).toBe(true);
    expect(document.documentElement.hasAttribute('data-panelize-scroller')).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--panelize-composer-space')).toBe('110px');

    send(frame, { blind: false });
    expect(document.querySelectorAll('[data-panelize-composer], [data-panelize-scroller]')).toHaveLength(0);
    expect(document.documentElement.style.getPropertyValue('--panelize-composer-space')).toBe('');
    expect(document.body.style.getPropertyValue('--panelize-composer-space')).toBe('');
  });

  it.each(['auto', 'scroll'])('marks the message itself as the closest %s scroller', overflow => {
    const frame = createFrame({
      html: `<main><section id="outer-scroller" style="overflow-y:auto"><article class="prose" id="answer" style="overflow-y:${overflow}">Answer</article></section><form id="composer-root"><textarea id="composer"></textarea><button aria-label="Send">Send</button></form></main>`
    });
    const { document } = frame.win;
    setVisibleGeometry(document.getElementById('composer'));
    setVisibleGeometry(document.getElementById('composer-root'), { height: 86 });

    send(frame, { blind: true });

    expect(document.getElementById('answer').hasAttribute('data-panelize-scroller')).toBe(true);
    expect(document.getElementById('outer-scroller').hasAttribute('data-panelize-scroller')).toBe(false);
  });

  it('measures, resizes and reobserves the active composer, then disconnects cleanly', async () => {
    const { ResizeObserverClass, observers } = createResizeObserverMock();
    const frame = createFrame({
      ResizeObserver: ResizeObserverClass,
      html: '<main id="app"><section id="conversation" style="overflow-y:auto"><article class="prose" id="answer">Answer</article></section><form id="composer-root"><textarea id="composer"></textarea><button aria-label="Send">Send</button></form></main>'
    });
    const { document } = frame.win;
    const originalRoot = document.getElementById('composer-root');
    const originalGeometry = setVisibleGeometry(originalRoot, { height: 90 });
    setVisibleGeometry(document.getElementById('composer'));

    send(frame, { blind: true });

    const [observer] = observers;
    expect(observers).toHaveLength(1);
    expect(observer.targets.has(originalRoot)).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--panelize-composer-space')).toBe('114px');

    originalGeometry.resize({ height: 132 });
    observer.callback([]);
    expect(document.documentElement.style.getPropertyValue('--panelize-composer-space')).toBe('156px');

    const replacementRoot = document.createElement('form');
    replacementRoot.id = 'replacement-composer-root';
    replacementRoot.innerHTML = '<textarea id="replacement-composer"></textarea><button aria-label="Send">Send</button>';
    originalRoot.replaceWith(replacementRoot);
    const replacementGeometry = setVisibleGeometry(replacementRoot, { height: 116 });
    setVisibleGeometry(document.getElementById('replacement-composer'));
    await new Promise(resolve => setTimeout(resolve, 260));

    expect(replacementRoot.hasAttribute('data-panelize-composer')).toBe(true);
    expect(observer.targets.has(originalRoot)).toBe(false);
    expect(observer.targets.has(replacementRoot)).toBe(true);
    expect(observer.disconnectCalls).toBeGreaterThan(0);
    expect(document.documentElement.style.getPropertyValue('--panelize-composer-space')).toBe('140px');

    replacementGeometry.resize({ height: 151 });
    observer.callback([]);
    expect(document.documentElement.style.getPropertyValue('--panelize-composer-space')).toBe('175px');

    send(frame, { blind: false });
    expect(observer.targets.size).toBe(0);
    expect(observer.disconnectCalls).toBeGreaterThan(1);
    expect(document.documentElement.style.getPropertyValue('--panelize-composer-space')).toBe('');
    expect(document.body.style.getPropertyValue('--panelize-composer-space')).toBe('');

    observer.callback([]);
    expect(document.documentElement.style.getPropertyValue('--panelize-composer-space')).toBe('');
  });

  it('keeps the compact composer send action without retaining app-level send controls', () => {
    const frame = createFrame({
      html: '<main id="app"><section id="conversation"><article class="prose" id="answer">Answer</article></section><div id="composer-shell"><div id="editor-wrapper"><textarea id="composer"></textarea></div><div id="composer-controls"><button aria-label="Send" id="composer-send">Send</button></div></div><button aria-label="Send" id="toolbar-send">Other send action</button></main>'
    });
    const { document } = frame.win;
    setVisibleGeometry(document.getElementById('composer'));
    setVisibleGeometry(document.getElementById('editor-wrapper'), { height: 48 });
    setVisibleGeometry(document.getElementById('composer-shell'), { height: 96 });
    setVisibleGeometry(document.getElementById('app'), { height: 760 });

    send(frame, { blind: true });

    expect(document.getElementById('composer-shell').hasAttribute('data-panelize-keep')).toBe(true);
    expect(document.getElementById('composer-send').hasAttribute('data-panelize-keep')).toBe(true);
    expect(document.getElementById('toolbar-send').hasAttribute('data-panelize-hide')).toBe(true);
  });

  it.each([
    ['chatglm', 'https://chatglm.cn/main/alltoolsdetail', '<aside class="el-aside aside-container" id="provider-sidebar"><div class="aside-subjects"><div class="new-session">新对话</div></div><div class="el-overlay-dialog" role="dialog"></div></aside>'],
    ['zai-global', 'https://chat.z.ai/', '<div id="sidebar"><div role="presentation"><button id="new-chat-button" class="navNewChat" aria-label="New Chat"></button></div></div>']
  ])('hides the %s sidebar in blind mode and restores it on disable', (provider, url, sidebarHtml) => {
    const frame = createFrame({
      url,
      html: `<section id="shell">${sidebarHtml}<main id="main"><div class="markdown" id="answer">Answer</div><form id="composer-root"><textarea id="composer"></textarea><button aria-label="Send">Send</button></form></main></section>`
    });
    const { document } = frame.win;
    setVisibleGeometry(document.getElementById('composer'));
    setVisibleGeometry(document.getElementById('composer-root'), { height: 86 });
    const sidebar = document.querySelector('#provider-sidebar, #sidebar');

    send(frame, { blind: true });
    const hiddenSidebar = sidebar.hasAttribute('data-panelize-hide')
      || [...sidebar.children].filter(child => !child.matches('[role="dialog"]')).every(child => child.hasAttribute('data-panelize-hide'));
    expect(hiddenSidebar).toBe(true);
    expect(document.getElementById('main').hasAttribute('data-panelize-hide')).toBe(false);
    expect(document.getElementById('composer-root').hasAttribute('data-panelize-composer')).toBe(true);

    send(frame, { blind: false });
    expect(sidebar.hasAttribute('data-panelize-hide')).toBe(false);
    expect(sidebar.hasAttribute('data-panelize-collapse')).toBe(false);
  });

  it('keeps ChatGLM dialogs mounted in its sidebar visible in blind mode', () => {
    const frame = createFrame({
      url: 'https://chatglm.cn/main/alltoolsdetail',
      html: '<section id="shell"><aside class="el-aside aside-container" id="provider-sidebar"><div class="aside-subjects" id="history">History</div><div class="el-overlay"><div class="el-overlay-dialog" role="dialog" id="login-dialog">Log in</div></div></aside><main id="main"><form id="composer-root"><textarea id="composer"></textarea><button aria-label="Send">Send</button></form></main></section>'
    });
    const { document } = frame.win;
    setVisibleGeometry(document.getElementById('composer'));
    setVisibleGeometry(document.getElementById('composer-root'), { height: 86 });

    send(frame, { blind: true });
    const sidebar = document.getElementById('provider-sidebar');
    expect(sidebar.hasAttribute('data-panelize-hide')).toBe(false);
    expect(sidebar.hasAttribute('data-panelize-collapse')).toBe(true);
    expect(document.getElementById('history').hasAttribute('data-panelize-hide')).toBe(true);
    expect(document.getElementById('login-dialog').closest('[data-panelize-hide]')).toBeNull();
  });

  it('hides a provider sidebar even when no visible composer exists', () => {
    const frame = createFrame({ url: 'https://chat.z.ai/', html: '<div id="sidebar">History</div><main id="main"></main>' });
    send(frame, { blind: true });
    expect(frame.win.document.getElementById('sidebar').hasAttribute('data-panelize-hide')).toBe(true);
    expect(frame.win.document.getElementById('main').hasAttribute('data-panelize-hide')).toBe(false);
  });

  it('never hides a provider sidebar that holds the model picker', () => {
    const frame = createFrame({
      url: 'https://chat.z.ai/',
      html: '<div id="sidebar"><button aria-label="Select Model" id="model-picker">Model</button></div><main><form id="composer-root"><textarea id="composer"></textarea><button aria-label="Send">Send</button></form></main>'
    });
    const { document } = frame.win;
    setVisibleGeometry(document.getElementById('composer'));
    setVisibleGeometry(document.getElementById('composer-root'), { height: 86 });

    send(frame, { blind: true });
    expect(document.getElementById('sidebar').hasAttribute('data-panelize-hide')).toBe(false);
    expect(document.getElementById('model-picker').hasAttribute('data-panelize-hide')).toBe(false);
  });

  it('leaves sidebars on other providers to sibling isolation', () => {
    const frame = createFrame({ url: 'https://chatgpt.com/', html: '<div id="sidebar">History</div><main></main>' });
    send(frame, { blind: true });
    expect(frame.win.document.getElementById('sidebar').hasAttribute('data-panelize-hide')).toBe(false);
  });

  it('does not hide anything when no visible composer exists', () => {
    const frame = createFrame({ html: '<header id="welcome">Provider home</header><aside id="sidebar">Chat history</aside><div class="prose" id="answer">Answer</div>' });
    send(frame, { blind: true });
    expect(frame.win.document.querySelectorAll('[data-panelize-hide], [data-panelize-keep]')).toHaveLength(0);
  });

  it('keeps the currently focused control and its ancestor chain visible', async () => {
    const frame = createFrame({
      html: '<main><div id="focus-wrapper"><input id="focused-control"></div><form id="composer-root"><textarea id="composer"></textarea><button aria-label="Send">Send</button></form><article class="prose" id="answer">Answer</article></main><aside id="sidebar">History</aside>'
    });
    const { document } = frame.win;
    setVisibleGeometry(document.getElementById('composer'));
    document.getElementById('focused-control').focus();

    send(frame, { blind: true });
    expect(document.getElementById('focused-control').hasAttribute('data-panelize-keep')).toBe(true);
    expect(document.getElementById('focus-wrapper').hasAttribute('data-panelize-hide')).toBe(false);
    expect(document.getElementById('sidebar').hasAttribute('data-panelize-hide')).toBe(true);
  });

  it('puts the style back when the page removes it', async () => {
    const frame = createFrame();
    send(frame, { blind: true });
    frame.win.document.getElementById('panelize-page-style').remove();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(styleText(frame)).toContain('font-family');
  });

  it('watches stylesheet changes without observing streamed body subtrees', async () => {
    const frame = createFrame({ html: '<main>Conversation</main>' });
    const { document } = frame.win;
    send(frame, { blind: true });

    let styleLookups = 0;
    const getElementById = document.getElementById.bind(document);
    document.getElementById = (id) => {
      if (id === 'panelize-page-style') styleLookups += 1;
      return getElementById(id);
    };

    document.querySelector('main').append(document.createElement('p'));
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(styleLookups).toBe(0);

    document.getElementById('panelize-page-style').remove();
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(styleText(frame)).toContain('font-family');

    const replacementHead = document.createElement('head');
    document.documentElement.replaceChild(replacementHead, document.head);
    await new Promise(resolve => setTimeout(resolve, 30));
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
