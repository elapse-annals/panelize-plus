import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import { DEFAULT_TIER_RECIPES } from '../modules/provider-tiers.js';

const source = readFileSync(resolve(process.cwd(), 'content-scripts/provider-tiers.js'), 'utf8');
const extensionOrigin = 'chrome-extension://panelize-test';
const windows = new Set();

function markVisible(element, win) {
  Object.defineProperty(element, 'offsetParent', {
    configurable: true,
    get: () => win.document.body
  });
}

function createProviderFrame({ url, html = '' }) {
  const win = new Window({ url });
  const replies = [];
  const parent = {
    postMessage(message, targetOrigin) {
      replies.push({ message, targetOrigin });
    }
  };
  win.chrome = { runtime: { getURL: () => `${extensionOrigin}/` } };
  Object.defineProperty(win, 'parent', { configurable: true, value: parent });
  win.document.body.innerHTML = html;
  win.document.querySelectorAll('*').forEach(element => markVisible(element, win));
  win.eval(source);
  windows.add(win);
  return { win, parent, replies };
}

function sendHostMessage(frame, data, { origin = extensionOrigin, sourceWindow = frame.parent } = {}) {
  const event = new frame.win.Event('message');
  Object.assign(event, {
    data: { context: 'multi-panel', requestId: 'tier-request-1', ...data },
    origin,
    source: sourceWindow
  });
  frame.win.dispatchEvent(event);
}

async function waitForReply(frame, expected = 1, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && frame.replies.length < expected) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  return frame.replies.map(entry => entry.message);
}

function createMenuFixture({ url, provider, selected, choices, locked = [] }) {
  const triggerId = provider === 'gemini' ? 'gemini-model' : `${provider}-model`;
  const triggerRole = provider === 'gemini' ? 'combobox' : 'button';
  const { win, parent, replies } = createProviderFrame({
    url,
    html: `
      <textarea id="draft">keep this draft</textarea>
      <button id="attachment" aria-label="Attached file">report.pdf</button>
      <button id="send" data-testid="send-button">Send</button>
      <button id="agent" aria-label="Agent mode">Agent</button>
      <button id="${triggerId}" data-testid="${provider}-model-switcher" role="${triggerRole}" aria-expanded="false">${selected}</button>
    `
  });
  const trigger = win.document.getElementById(triggerId);
  let menu = null;
  let triggerClickCount = 0;
  let optionClickCount = 0;
  let sendClickCount = 0;
  win.document.getElementById('send').addEventListener('click', () => sendClickCount++);
  trigger.addEventListener('click', () => {
    triggerClickCount++;
    const existing = win.document.getElementById('tier-menu');
    if (existing) {
      existing.remove();
      trigger.setAttribute('aria-expanded', 'false');
      return;
    }
    menu = win.document.createElement('div');
    menu.id = 'tier-menu';
    menu.setAttribute('role', 'menu');
    for (const label of choices) {
      const option = win.document.createElement('button');
      option.setAttribute('role', 'menuitem');
      option.textContent = label;
      if (locked.includes(label)) option.setAttribute('aria-disabled', 'true');
      option.addEventListener('click', () => {
        optionClickCount++;
        if (locked.includes(label)) return;
        trigger.textContent = label;
        trigger.setAttribute('aria-expanded', 'false');
        menu.remove();
      });
      markVisible(option, win);
      menu.append(option);
    }
    markVisible(menu, win);
    win.document.body.append(menu);
    trigger.setAttribute('aria-expanded', 'true');
  });
  return {
    win,
    parent,
    replies,
    trigger,
    get menu() { return menu; },
    get triggerClickCount() { return triggerClickCount; },
    get optionClickCount() { return optionClickCount; },
    get sendClickCount() { return sendClickCount; }
  };
}

function createNestedMenuFixture({ provider, url, selected, models, submenuLabel, choices }) {
  const { win, parent, replies } = createProviderFrame({
    url,
    html: `
      <textarea id="draft">nested-menu draft</textarea>
      <button id="send">Send</button>
      <button id="model-selector" data-testid="${provider}-model-selector" aria-expanded="false">${selected}</button>
    `
  });
  const trigger = win.document.getElementById('model-selector');
  let optionClickCount = 0;
  let submenuClickCount = 0;
  trigger.addEventListener('click', () => {
    if (win.document.getElementById('model-menu')) return;
    const root = win.document.createElement('div');
    root.id = 'model-menu';
    root.setAttribute('role', 'menu');
    for (const label of models) {
      const option = win.document.createElement('button');
      option.setAttribute('role', 'menuitem');
      option.textContent = label;
      markVisible(option, win);
      root.append(option);
    }
    const submenuTrigger = win.document.createElement('button');
    submenuTrigger.setAttribute('role', 'menuitem');
    submenuTrigger.setAttribute('aria-haspopup', 'menu');
    submenuTrigger.textContent = submenuLabel;
    submenuTrigger.addEventListener('click', () => {
      submenuClickCount++;
      const submenu = win.document.createElement('div');
      submenu.id = 'effort-menu';
      submenu.setAttribute('role', 'menu');
      for (const label of choices) {
        const option = win.document.createElement('button');
        option.setAttribute('role', 'menuitemradio');
        option.textContent = label;
        option.addEventListener('click', () => {
          optionClickCount++;
          trigger.textContent = label;
          trigger.setAttribute('aria-expanded', 'false');
          root.remove();
          submenu.remove();
        });
        markVisible(option, win);
        submenu.append(option);
      }
      markVisible(submenu, win);
      win.document.body.append(submenu);
    });
    markVisible(submenuTrigger, win);
    root.append(submenuTrigger);
    markVisible(root, win);
    win.document.body.append(root);
    trigger.setAttribute('aria-expanded', 'true');
  });
  return {
    win,
    parent,
    replies,
    trigger,
    get optionClickCount() { return optionClickCount; },
    get submenuClickCount() { return submenuClickCount; }
  };
}

/**
 * A page with one or more pickers. Each item either sets the text of some
 * triggers (`set: { triggerId: text }`) or opens a submenu of more items.
 * `roleless` menus use plain list items, like popovers without ARIA roles.
 */
function createRecipeFixture({ url, triggers, roleless = false }) {
  const html = triggers.map(({ id, attrs = '', text }) =>
    `<button id="${id}" ${attrs} aria-expanded="false">${text}</button>`).join('');
  const frame = createProviderFrame({ url, html: `<textarea id="draft">recipe draft</textarea><button id="send">Send</button>${html}` });
  const { win } = frame;
  const clicks = [];
  const closeAll = () => {
    win.document.querySelectorAll('.fixture-menu').forEach(menu => menu.remove());
    triggers.forEach(({ id }) => win.document.getElementById(id).setAttribute('aria-expanded', 'false'));
  };
  const buildMenu = items => {
    const menu = win.document.createElement(roleless ? 'ul' : 'div');
    menu.className = 'fixture-menu';
    if (!roleless) menu.setAttribute('role', 'menu');
    for (const item of items) {
      const option = win.document.createElement(roleless ? 'li' : 'button');
      if (!roleless) option.setAttribute('role', item.submenu ? 'menuitem' : 'menuitemradio');
      if (item.submenu) option.setAttribute('aria-haspopup', 'menu');
      if (item.checked) option.setAttribute('aria-checked', 'true');
      option.textContent = item.label;
      option.addEventListener('click', () => {
        clicks.push(item.label);
        if (item.submenu) {
          win.document.body.append(buildMenu(item.submenu));
          return;
        }
        Object.entries(item.set || {}).forEach(([id, text]) => { win.document.getElementById(id).textContent = text; });
        closeAll();
      });
      markVisible(option, win);
      menu.append(option);
    }
    markVisible(menu, win);
    return menu;
  };
  triggers.forEach(({ id, items }) => {
    const trigger = win.document.getElementById(id);
    trigger.addEventListener('click', () => {
      clicks.push(`open:${id}`);
      if (trigger.getAttribute('aria-expanded') === 'true') { closeAll(); return; }
      closeAll();
      win.document.body.append(buildMenu(items()));
      trigger.setAttribute('aria-expanded', 'true');
    });
  });
  return { ...frame, clicks };
}

function kimiFixture(initial = 'K3.1 Pro 进阶') {
  const trigger = id => ({ set: { kimi: id } });
  let model = initial.replace(/ (标准|进阶|极致)$/, '');
  let effort = initial.match(/(标准|进阶|极致)$/)[1];
  const frame = createRecipeFixture({
    url: 'https://www.kimi.com/',
    triggers: [{
      id: 'kimi',
      attrs: 'data-testid="model-select-trigger" aria-haspopup="menu"',
      text: initial,
      items: () => [
        ...['K3.1 Pro', 'K2.8 Preview', '快速'].map(name => ({
          label: `${name} ${name === '快速' ? '快速对话，即时响应' : '说明'}`,
          checked: name === model,
          ...trigger(`${name} ${effort}`),
          get set() { model = name; return { kimi: `${name} ${effort}` }; }
        })),
        {
          label: `思考强度 ${effort}`,
          submenu: ['标准', '进阶', '极致'].map(level => ({
            label: level,
            get set() { effort = level; return { kimi: `${model} ${level}` }; }
          }))
        }
      ]
    }]
  });
  return frame;
}

afterEach(() => {
  for (const win of windows) win.happyDOM.abort();
  windows.clear();
  vi.restoreAllMocks();
});

describe('provider tier content script', () => {
  it.each([
    ['chatgpt', 'https://chatgpt.com/', 'Medium', ['Instant', 'Medium', 'High'], 'High'],
    ['claude', 'https://claude.ai/new', 'Claude Sonnet 4', ['Claude Haiku 4', 'Claude Sonnet 4', 'Claude Opus 4'], 'Claude Opus 4']
  ])('sets %s only through its visible selector and verifies the resulting label', async (provider, url, selected, choices, expectedLabel) => {
    const frame = createMenuFixture({ url, provider, selected, choices });
    sendHostMessage(frame, { type: 'SET_PROVIDER_TIER', tier: 'deep' });

    const [reply] = await waitForReply(frame);
    expect(reply).toMatchObject({
      type: 'PANELIZE_PROVIDER_TIER_RESULT',
      context: 'multi-panel',
      provider,
      tier: 'deep',
      requestedTier: 'deep',
      actualLabel: provider === 'claude' ? `Model: ${expectedLabel} (tier fallback)` : expectedLabel,
      status: 'success'
    });
    expect(reply.supportedTiers).toContain('deep');
    expect(frame.optionClickCount).toBe(1);
    expect(frame.sendClickCount).toBe(0);
    expect(frame.win.document.getElementById('draft').value).toBe('keep this draft');
    expect(frame.win.document.getElementById('attachment').textContent).toBe('report.pdf');
    if (provider === 'claude') {
      sendHostMessage(frame, { type: 'GET_PROVIDER_TIER_STATE', requestId: 'verified-model-fallback' });
      const [, stateReply] = await waitForReply(frame, 2);
      expect(stateReply).toMatchObject({
        status: 'success', tier: 'deep', matchedTiers: ['deep'],
        actualLabel: 'Model: Claude Opus 4 (tier fallback)'
      });
    }
  });

  it('sets and reads ChatGPT reasoning from the visible three-stop strength slider', async () => {
    const frame = createProviderFrame({
      url: 'https://chatgpt.com/',
      html: `
        <button id="effort" data-testid="thinking-strength" aria-expanded="false">思考强度 中</button>
        <div id="popover" hidden>
          <label for="strength">思考强度</label>
          <input id="strength" type="range" min="0" max="2" step="1" value="1">
        </div>
        <textarea id="draft">keep this draft</textarea>
        <button id="send">Send</button>
      `
    });
    const trigger = frame.win.document.getElementById('effort');
    const popover = frame.win.document.getElementById('popover');
    const slider = frame.win.document.getElementById('strength');
    trigger.addEventListener('click', () => {
      popover.hidden = !popover.hidden;
      trigger.setAttribute('aria-expanded', String(!popover.hidden));
    });
    slider.addEventListener('input', () => {
      const nextValue = slider.value;
      frame.win.setTimeout(() => {
        trigger.textContent = `思考强度 ${['低', '中', '高'][Number(nextValue)]}`;
        const replacement = slider.cloneNode(true);
        replacement.value = nextValue;
        replacement.addEventListener('input', () => {});
        slider.replaceWith(replacement);
      }, 35);
    });
    frame.win.document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        popover.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
      }
    });

    sendHostMessage(frame, { type: 'SET_PROVIDER_TIER', tier: 'deep' });
    const [setReply] = await waitForReply(frame);
    expect(setReply).toMatchObject({
      provider: 'chatgpt', status: 'success', tier: 'deep', requestedTier: 'deep',
      actualLabel: '思考强度 高', supportedTiers: ['fast', 'balanced', 'deep'], matchedTiers: ['deep']
    });
    expect(frame.win.document.getElementById('strength').value).toBe('2');
    expect(popover.hidden).toBe(true);
    expect(frame.win.document.getElementById('draft').value).toBe('keep this draft');

    sendHostMessage(frame, { type: 'GET_PROVIDER_TIER_STATE', requestId: 'slider-state' });
    const [, stateReply] = await waitForReply(frame, 2);
    expect(stateReply).toMatchObject({ status: 'success', tier: 'deep', actualLabel: '思考强度 高' });
  });

  it('uses the native range defaults when a ChatGPT slider omits min and max', async () => {
    const frame = createProviderFrame({
      url: 'https://chatgpt.com/',
      html: '<button data-testid="thinking-strength">Thinking strength</button><div><label for="strength">Thinking strength</label><input id="strength" type="range" value="50"></div>'
    });
    const slider = frame.win.document.getElementById('strength');
    sendHostMessage(frame, { type: 'SET_PROVIDER_TIER', tier: 'deep' });
    const [reply] = await waitForReply(frame);
    expect(reply).toMatchObject({ status: 'success', tier: 'deep', requestedTier: 'deep', supportedTiers: ['fast', 'balanced', 'deep'] });
    expect(slider.value).toBe('100');
  });

  it.each([false, true])('falls back to the Effort menu with a separate model picker: %s', async (withModelPicker) => {
    const frame = createMenuFixture({
      url: 'https://chatgpt.com/',
      provider: 'chatgpt',
      selected: 'Reasoning effort Low',
      choices: ['Reasoning effort Low', 'Reasoning effort Medium', 'Reasoning effort High']
    });
    const modelClicked = vi.fn();
    if (withModelPicker) {
      frame.trigger.setAttribute('data-testid', 'reasoning-effort');
      const model = frame.win.document.createElement('button');
      model.setAttribute('data-testid', 'model-switcher');
      model.textContent = 'GPT model';
      model.addEventListener('click', modelClicked);
      markVisible(model, frame.win);
      frame.win.document.body.prepend(model);
    }
    frame.win.document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        frame.menu?.remove();
        frame.trigger.setAttribute('aria-expanded', 'false');
      }
    });

    sendHostMessage(frame, { type: 'SET_PROVIDER_TIER', tier: 'deep' });
    const [reply] = await waitForReply(frame, 1, 4000);
    expect(reply).toMatchObject({ status: 'success', tier: 'deep', requestedTier: 'deep', actualLabel: 'Reasoning effort High' });
    expect(frame.optionClickCount).toBe(1);
    expect(modelClicked).not.toHaveBeenCalled();
    expect(frame.win.document.querySelector('[role="menu"]')).toBeNull();
  });

  it('does not trust an Effort label that disagrees with the slider value on GET', async () => {
    const frame = createProviderFrame({
      url: 'https://chatgpt.com/',
      html: `
        <button id="effort" data-testid="thinking-strength" aria-expanded="false">Thinking strength High</button>
        <div id="popover" hidden><label for="strength">Thinking strength</label><input id="strength" type="range" min="0" max="2" step="1" value="1"></div>
      `
    });
    const trigger = frame.win.document.getElementById('effort');
    const popover = frame.win.document.getElementById('popover');
    trigger.addEventListener('click', () => { popover.hidden = !popover.hidden; });
    frame.win.document.addEventListener('keydown', event => {
      if (event.key === 'Escape') popover.hidden = true;
    });
    sendHostMessage(frame, { type: 'GET_PROVIDER_TIER_STATE' });
    const [reply] = await waitForReply(frame);
    expect(reply).toMatchObject({ status: 'unavailable', reason: 'current_tier_unknown', tier: null, actualLabel: 'Thinking strength High' });
    expect(popover.hidden).toBe(true);
  });

  it('does not invent a balanced tier for a two-stop ChatGPT slider', async () => {
    const frame = createProviderFrame({
      url: 'https://chatgpt.com/',
      html: `
        <button id="effort" aria-expanded="true">Thinking strength</button>
        <div><label for="strength">Thinking strength</label><input id="strength" type="range" min="0" max="1" step="1" value="0"></div>
      `
    });
    const slider = frame.win.document.getElementById('strength');
    sendHostMessage(frame, { type: 'SET_PROVIDER_TIER', tier: 'balanced' });
    const [reply] = await waitForReply(frame);
    expect(reply).toMatchObject({ status: 'unsupported', reason: 'tier_unavailable', tier: null, supportedTiers: ['fast', 'deep'] });
    expect(slider.value).toBe('0');
  });

  it('does not change a disabled ChatGPT reasoning slider', async () => {
    const frame = createProviderFrame({
      url: 'https://chatgpt.com/',
      html: `
        <button id="effort" data-testid="thinking-strength">Thinking strength Medium</button>
        <div><label for="strength">Thinking strength</label><input id="strength" type="range" min="0" max="2" step="1" value="1" disabled></div>
      `
    });
    const slider = frame.win.document.getElementById('strength');
    sendHostMessage(frame, { type: 'SET_PROVIDER_TIER', tier: 'deep' });
    const [reply] = await waitForReply(frame);
    expect(reply).toMatchObject({ status: 'unavailable', reason: 'slider_disabled', tier: null, supportedTiers: ['fast', 'balanced', 'deep'] });
    expect(slider.value).toBe('1');
  });

  it('sets a custom ChatGPT slider with keyboard controls and verifies its ARIA value', async () => {
    const frame = createProviderFrame({
      url: 'https://chatgpt.com/',
      html: `
        <div>
          <span>Thinking strength</span>
          <div id="strength" role="slider" tabindex="0" aria-label="Thinking strength" aria-valuemin="0" aria-valuemax="2" aria-valuenow="1" aria-valuestep="1"></div>
        </div>
      `
    });
    const slider = frame.win.document.getElementById('strength');
    slider.addEventListener('keydown', event => {
      const current = Number(slider.getAttribute('aria-valuenow'));
      const nextValue = event.key === 'End' ? 2 : event.key === 'Home' ? 0
        : event.key === 'ArrowRight' ? Math.min(2, current + 1)
          : event.key === 'ArrowLeft' ? Math.max(0, current - 1) : current;
      frame.win.setTimeout(() => slider.setAttribute('aria-valuenow', String(nextValue)), 25);
    });

    sendHostMessage(frame, { type: 'SET_PROVIDER_TIER', tier: 'deep' });
    const [reply] = await waitForReply(frame);
    expect(reply).toMatchObject({
      status: 'success', tier: 'deep', requestedTier: 'deep',
      actualLabel: '思考强度 2', supportedTiers: ['fast', 'balanced', 'deep'], matchedTiers: ['deep']
    });
    expect(slider.getAttribute('aria-valuenow')).toBe('2');
  });

  it.each([
    ['claude', 'https://claude.ai/new', 'Claude Sonnet 4', ['Claude Haiku 4', 'Claude Sonnet 4', 'Claude Opus 4'], 'Effort', ['Low', 'Medium', 'High'], 'High']
  ])('prefers the nested effort menu for %s over model fallback choices', async (provider, url, selected, models, submenuLabel, choices, expectedLabel) => {
    const frame = createNestedMenuFixture({ provider, url, selected, models, submenuLabel, choices });
    sendHostMessage(frame, { type: 'SET_PROVIDER_TIER', tier: 'deep' });

    const [reply] = await waitForReply(frame);
    expect(reply).toMatchObject({
      provider,
      status: 'success',
      tier: 'deep',
      requestedTier: 'deep',
      actualLabel: expectedLabel,
      supportedTiers: ['fast', 'balanced', 'deep']
    });
    expect(frame.submenuClickCount).toBe(1);
    expect(frame.optionClickCount).toBe(1);
    expect(frame.win.document.getElementById('draft').value).toBe('nested-menu draft');
  });

  it('does not infer Claude effort from the selected Opus model', async () => {
    const frame = createMenuFixture({
      url: 'https://claude.ai/new',
      provider: 'claude',
      selected: 'Claude Opus 5.5',
      choices: ['Claude Haiku 5.5', 'Claude Sonnet 5.5', 'Claude Opus 5.5']
    });
    sendHostMessage(frame, { type: 'GET_PROVIDER_TIER_STATE' });

    const [reply] = await waitForReply(frame);
    expect(reply).toMatchObject({
      status: 'unavailable',
      reason: 'current_tier_unknown',
      tier: null,
      matchedTiers: [],
      actualLabel: 'Model: Claude Opus 5.5'
    });
    expect(frame.triggerClickCount).toBe(0);
  });

  it('uses a separately visible Claude effort value instead of a cached Opus fallback', async () => {
    const { win, parent, replies } = createProviderFrame({
      url: 'https://claude.ai/new',
      html: `
        <button id="external-effort" data-testid="effort-selector" aria-label="Effort: Low">Low</button>
        <textarea id="draft">draft</textarea>
        <button id="model-selector" data-testid="claude-model-selector" aria-expanded="false">Claude Sonnet 5.5</button>
      `
    });
    const trigger = win.document.getElementById('model-selector');
    trigger.addEventListener('click', () => {
      const menu = win.document.createElement('div');
      menu.id = 'model-menu';
      menu.setAttribute('role', 'menu');
      for (const label of ['Claude Haiku 5.5', 'Claude Sonnet 5.5', 'Claude Opus 5.5']) {
        const option = win.document.createElement('button');
        option.setAttribute('role', 'menuitemradio');
        option.textContent = label;
        option.addEventListener('click', () => {
          trigger.textContent = label;
          menu.remove();
          trigger.setAttribute('aria-expanded', 'false');
        });
        markVisible(option, win);
        menu.append(option);
      }
      markVisible(menu, win);
      win.document.body.append(menu);
      trigger.setAttribute('aria-expanded', 'true');
    });
    const frame = { win, parent, replies, triggerClickCount: 0 };
    sendHostMessage(frame, { type: 'SET_PROVIDER_TIER', tier: 'deep' });

    const [setReply] = await waitForReply(frame);
    expect(setReply).toMatchObject({
      status: 'success', tier: 'deep', requestedTier: 'deep',
      actualLabel: 'Model: Claude Opus 5.5 (tier fallback)'
    });

    sendHostMessage(frame, { type: 'GET_PROVIDER_TIER_STATE', requestId: 'effort-refresh' });
    const [, stateReply] = await waitForReply(frame, 2);
    expect(stateReply).toMatchObject({
      status: 'success', tier: 'fast', matchedTiers: ['fast'], actualLabel: 'Effort: Low'
    });
  });

  it('does not choose a same-label option from an unrelated nested popup', async () => {
    const frame = createProviderFrame({
      url: 'https://chat.qwen.ai/',
      html: '<button id="mode" class="qwen-thinking-selector" aria-expanded="false">Auto</button>'
    });
    const trigger = frame.win.document.getElementById('mode');
    let selectedCount = 0;
    trigger.addEventListener('click', () => {
      const menu = frame.win.document.createElement('div');
      menu.id = 'mode-menu';
      menu.setAttribute('role', 'menu');
      const submenu = frame.win.document.createElement('button');
      submenu.id = 'thinking-submenu';
      submenu.setAttribute('role', 'menuitem');
      submenu.setAttribute('aria-haspopup', 'menu');
      submenu.textContent = 'Thinking level';
      submenu.addEventListener('click', () => {
        for (const id of ['real-thinking-menu', 'unrelated-menu']) {
          const root = frame.win.document.createElement('div');
          root.id = id;
          root.setAttribute('role', 'menu');
          const option = frame.win.document.createElement('button');
          option.setAttribute('role', 'menuitemradio');
          option.textContent = 'Fast';
          option.addEventListener('click', () => selectedCount++);
          markVisible(option, frame.win);
          root.append(option);
          markVisible(root, frame.win);
          frame.win.document.body.append(root);
        }
      });
      markVisible(submenu, frame.win);
      menu.append(submenu);
      markVisible(menu, frame.win);
      frame.win.document.body.append(menu);
      trigger.setAttribute('aria-expanded', 'true');
    });

    sendHostMessage(frame, {
      type: 'SET_PROVIDER_TIER',
      tier: 'fast',
      recipes: { fast: [{ kind: 'thinking', label: 'Fast' }], balanced: [], deep: [] }
    });
    const [reply] = await waitForReply(frame);
    expect(reply).toMatchObject({
      provider: 'qwen-global', status: 'error', tier: null,
      requestedTier: 'fast', reason: 'step_failed:thinking'
    });
    expect(selectedCount).toBe(0);
  });

  it('reads a checked Claude effort only from its associated Effort menu', async () => {
    const frame = createProviderFrame({
      url: 'https://claude.ai/new',
      html: `
        <button id="model-selector" data-testid="claude-model-selector" aria-expanded="true">Claude Opus 5.5</button>
        <div id="model-menu" role="menu">
          <button id="effort-choice" role="menuitem" aria-haspopup="menu">Effort</button>
        </div>
        <div id="effort-menu" role="menu" aria-labelledby="effort-choice">
          <button role="menuitemradio" aria-checked="true">Low</button>
          <button role="menuitemradio">Medium</button>
          <button role="menuitemradio">High</button>
        </div>
      `
    });
    sendHostMessage(frame, { type: 'GET_PROVIDER_TIER_STATE' });

    const [reply] = await waitForReply(frame);
    expect(reply).toMatchObject({ status: 'success', tier: 'fast', matchedTiers: ['fast'], actualLabel: 'Low' });
  });

  it('reports Grok as unsupported even when its page shows a menu', async () => {
    const frame = createMenuFixture({
      url: 'https://grok.com/',
      provider: 'grok',
      selected: 'Balanced',
      choices: ['Fast', 'Balanced', 'Deep']
    });
    sendHostMessage(frame, { type: 'SET_PROVIDER_TIER', tier: 'deep' });

    const [reply] = await waitForReply(frame);
    expect(reply).toMatchObject({ provider: 'grok', status: 'unsupported', reason: 'provider_not_supported' });
    expect(frame.triggerClickCount).toBe(0);
  });

  it('deduplicates the same in-flight SET request', async () => {
    const frame = createMenuFixture({
      url: 'https://chatgpt.com/',
      provider: 'chatgpt',
      selected: 'Medium',
      choices: ['Instant', 'Medium', 'High']
    });
    const message = { type: 'SET_PROVIDER_TIER', tier: 'deep', requestId: 'same-request' };
    sendHostMessage(frame, message);
    sendHostMessage(frame, message);

    const [reply] = await waitForReply(frame);
    expect(reply.status).toBe('success');
    expect(frame.optionClickCount).toBe(1);
  });

  it('reads current state without opening a model menu', async () => {
    const frame = createMenuFixture({
      url: 'https://chatgpt.com/',
      provider: 'chatgpt',
      selected: 'Medium',
      choices: ['Instant', 'Medium', 'High']
    });
    const triggerClick = vi.spyOn(frame.trigger, 'click');
    sendHostMessage(frame, { type: 'GET_PROVIDER_TIER_STATE' });

    const [reply] = await waitForReply(frame);
    expect(reply).toMatchObject({
      type: 'PANELIZE_PROVIDER_TIER_STATE',
      provider: 'chatgpt',
      tier: 'balanced',
      actualLabel: 'Medium',
      supportedTiers: ['balanced'],
      status: 'success',
      reason: 'options_not_visible'
    });
    expect(triggerClick).not.toHaveBeenCalled();
  });

  it('does not click a locked tier and reports no verified applied tier', async () => {
    const frame = createMenuFixture({
      url: 'https://chatgpt.com/',
      provider: 'chatgpt',
      selected: 'Medium',
      choices: ['Instant', 'Medium', 'High'],
      locked: ['High']
    });
    sendHostMessage(frame, { type: 'SET_PROVIDER_TIER', tier: 'deep' });

    const [reply] = await waitForReply(frame);
    expect(reply).toMatchObject({
      status: 'unavailable',
      reason: 'option_locked',
      tier: null,
      requestedTier: 'deep',
      actualLabel: 'High'
    });
    expect(frame.optionClickCount).toBe(0);
    expect(frame.sendClickCount).toBe(0);
  });

  it('maps DeepSeek quick and reasoning tiers to the live DeepThink toggle and reports shared mapping', async () => {
    const frame = createProviderFrame({
      url: 'https://chat.deepseek.com/',
      html: '<textarea id="draft">draft stays</textarea><button id="send">Send</button><button id="deepthink" aria-pressed="false">DeepThink</button>'
    });
    const toggle = frame.win.document.getElementById('deepthink');
    let clicks = 0;
    toggle.addEventListener('click', () => {
      clicks++;
      toggle.setAttribute('aria-pressed', String(toggle.getAttribute('aria-pressed') !== 'true'));
    });
    const send = frame.win.document.getElementById('send');
    const sendClick = vi.fn();
    send.addEventListener('click', sendClick);
    sendHostMessage(frame, { type: 'SET_PROVIDER_TIER', tier: 'balanced', recipes: DEFAULT_TIER_RECIPES.deepseek });

    const [reply] = await waitForReply(frame, 1, 1800);
    expect(reply).toMatchObject({
      type: 'PANELIZE_PROVIDER_TIER_RESULT',
      provider: 'deepseek',
      tier: 'balanced',
      requestedTier: 'balanced',
      matchedTiers: ['balanced', 'deep'],
      status: 'success'
    });
    expect(reply.actualLabel).toContain('shared mapping: balanced/deep');
    expect(reply.supportedTiers).toEqual(['fast', 'balanced', 'deep']);
    expect(clicks).toBe(1);
    expect(sendClick).not.toHaveBeenCalled();
    expect(frame.win.document.getElementById('draft').value).toBe('draft stays');
  });

  it('rejects host messages with an untrusted source or origin', async () => {
    const frame = createMenuFixture({
      url: 'https://chatgpt.com/',
      provider: 'chatgpt',
      selected: 'Medium',
      choices: ['Instant', 'Medium', 'High']
    });
    sendHostMessage(frame, { type: 'SET_PROVIDER_TIER', tier: 'deep' }, { origin: 'https://attacker.example' });
    sendHostMessage(frame, { type: 'SET_PROVIDER_TIER', tier: 'deep' }, { sourceWindow: {} });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(frame.replies).toHaveLength(0);
    expect(frame.optionClickCount).toBe(0);
  });

  it('returns explicit unsupported for Google AI search without treating search as a tier', async () => {
    const frame = createProviderFrame({
      url: 'https://www.google.com/search?udm=50',
      html: '<button id="search-mode">AI mode</button>'
    });
    sendHostMessage(frame, { type: 'SET_PROVIDER_TIER', tier: 'deep' });

    const [reply] = await waitForReply(frame);
    expect(reply).toMatchObject({
      provider: 'google',
      status: 'unsupported',
      reason: 'provider_not_supported',
      tier: null,
      requestedTier: 'deep',
      supportedTiers: []
    });
  });

  describe('recipes', () => {
    it('does not report a tier when one recipe step cannot be read', async () => {
      const recipes = {
        fast: [{ kind: 'model', label: 'Qwen3.6-flash' }, { kind: 'thinking', label: 'High' }],
        balanced: [{ kind: 'model', label: 'Qwen3.7' }, { kind: 'thinking', label: 'High' }],
        deep: [{ kind: 'model', label: 'Qwen3.7-Max' }, { kind: 'thinking', label: 'High' }]
      };
      const frame = createRecipeFixture({
        url: 'https://chat.qwen.ai/',
        triggers: [{ id: 'mode', attrs: 'class="qwen-thinking-selector"', text: 'High', items: () => [] }]
      });
      sendHostMessage(frame, { type: 'GET_PROVIDER_TIER_STATE', recipes });

      const [reply] = await waitForReply(frame);
      expect(reply).toMatchObject({ status: 'unavailable', reason: 'current_tier_unknown', tier: null, matchedTiers: [] });
    });

    it('does not report a model match when its required toggle cannot be read', async () => {
      const recipes = {
        fast: [{ kind: 'model', label: 'Qwen3.6-flash' }, { kind: 'toggle', label: 'DeepThink', on: false }],
        balanced: [{ kind: 'model', label: 'Qwen3.7' }, { kind: 'toggle', label: 'DeepThink', on: true }],
        deep: [{ kind: 'model', label: 'Qwen3.7-Max' }, { kind: 'toggle', label: 'DeepThink', on: true }]
      };
      const frame = createRecipeFixture({
        url: 'https://chat.qwen.ai/',
        triggers: [{ id: 'model', attrs: 'class="wms-trigger"', text: 'Qwen3.7', items: () => [] }]
      });
      sendHostMessage(frame, { type: 'GET_PROVIDER_TIER_STATE', recipes });

      const [reply] = await waitForReply(frame);
      expect(reply).toMatchObject({ status: 'unavailable', reason: 'current_tier_unknown', tier: null, matchedTiers: [] });
    });

    it('fails Set when the later thinking choice changes the model away from the requested recipe', async () => {
      const frame = createRecipeFixture({
        url: 'https://chat.qwen.ai/',
        triggers: [
          { id: 'model', attrs: 'class="wms-trigger"', text: 'Qwen3.7-Plus', items: () => [{ label: 'Qwen3.7-Max', set: { model: 'Qwen3.7-Max' } }] },
          { id: 'mode', attrs: 'class="qwen-thinking-selector"', text: 'Auto', items: () => [{ label: 'Thinking', set: { mode: 'Thinking', model: 'Qwen3.7' } }] }
        ]
      });
      const recipes = {
        fast: [],
        balanced: [],
        deep: [{ kind: 'model', label: 'Qwen3.7-Max' }, { kind: 'thinking', label: 'Thinking' }]
      };
      sendHostMessage(frame, { type: 'SET_PROVIDER_TIER', tier: 'deep', recipes });

      const [reply] = await waitForReply(frame, 1, 4000);
      expect(reply).toMatchObject({ status: 'error', reason: 'verification_failed', tier: null, requestedTier: 'deep' });
      expect(reply.actualLabel).toContain('Qwen3.7');
    });

    it('picks the model, then opens the thinking submenu, verifying each step (Kimi)', async () => {
      const frame = kimiFixture('K3.1 Pro 标准');
      sendHostMessage(frame, { type: 'SET_PROVIDER_TIER', tier: 'balanced', recipes: DEFAULT_TIER_RECIPES.kimi });

      const [reply] = await waitForReply(frame, 1, 4000);
      expect(reply).toMatchObject({
        provider: 'kimi',
        status: 'success',
        tier: 'balanced',
        requestedTier: 'balanced',
        matchedTiers: ['balanced'],
        supportedTiers: ['fast', 'balanced', 'deep']
      });
      expect(reply.actualLabel).toBe('K2.8 Preview 标准 · K2.8 Preview 进阶');
      expect(frame.win.document.getElementById('kimi').textContent).toBe('K2.8 Preview 进阶');
      expect(frame.clicks).toEqual(['open:kimi', 'K2.8 Preview 说明', 'open:kimi', '思考强度 标准', '进阶']);
      expect(frame.win.document.getElementById('draft').value).toBe('recipe draft');
    });

    it('does not click anything when the page already shows every step', async () => {
      const frame = kimiFixture('K3.1 Pro 进阶');
      sendHostMessage(frame, { type: 'SET_PROVIDER_TIER', tier: 'deep', recipes: DEFAULT_TIER_RECIPES.kimi });

      const [reply] = await waitForReply(frame);
      expect(reply).toMatchObject({ status: 'success', tier: 'deep' });
      expect(frame.clicks).toEqual([]);
    });

    it('picks GPT-6, then the ChatGPT reasoning effort menu option', async () => {
      const frame = createRecipeFixture({
        url: 'https://chatgpt.com/',
        triggers: [
          { id: 'model', attrs: 'data-testid="model-switcher"', text: 'GPT-5', items: () => ['GPT-5', 'GPT-6'].map(label => ({ label, set: { model: label } })) },
          { id: 'effort', attrs: 'data-testid="reasoning-effort"', text: 'Medium', items: () => ['Instant', 'Medium', 'High'].map(label => ({ label, set: { effort: label } })) }
        ]
      });
      sendHostMessage(frame, { type: 'SET_PROVIDER_TIER', tier: 'fast', recipes: DEFAULT_TIER_RECIPES.chatgpt });

      const [reply] = await waitForReply(frame, 1, 4000);
      expect(reply).toMatchObject({ provider: 'chatgpt', status: 'success', tier: 'fast', matchedTiers: ['fast'], actualLabel: 'GPT-6 · Instant' });
      expect(frame.clicks).toEqual(['open:model', 'GPT-6', 'open:effort', 'Instant']);
      expect(frame.win.document.getElementById('send').textContent).toBe('Send');

      sendHostMessage(frame, { type: 'GET_PROVIDER_TIER_STATE', requestId: 'chatgpt-recipe-state', recipes: DEFAULT_TIER_RECIPES.chatgpt });
      const [, stateReply] = await waitForReply(frame, 2);
      expect(stateReply).toMatchObject({ status: 'success', tier: 'fast', matchedTiers: ['fast'] });
    });

    it('moves the ChatGPT strength slider for a recipe thinking step', async () => {
      const frame = createRecipeFixture({
        url: 'https://chatgpt.com/',
        triggers: [{ id: 'model', attrs: 'data-testid="model-switcher"', text: 'GPT-6', items: () => [] }]
      });
      const doc = frame.win.document;
      doc.body.insertAdjacentHTML('beforeend', '<button id="effort" data-testid="thinking-strength">Thinking strength Medium</button><div><label for="strength">Thinking strength</label><input id="strength" type="range" min="0" max="2" step="1" value="1"></div>');
      doc.querySelectorAll('#effort, #strength, #strength + *, label').forEach(element => markVisible(element, frame.win));
      markVisible(doc.getElementById('strength').parentElement, frame.win);
      const slider = doc.getElementById('strength');
      slider.addEventListener('input', () => {
        doc.getElementById('effort').textContent = `Thinking strength ${['Low', 'Medium', 'High'][Number(slider.value)]}`;
      });
      sendHostMessage(frame, { type: 'SET_PROVIDER_TIER', tier: 'fast', recipes: DEFAULT_TIER_RECIPES.chatgpt });

      const [reply] = await waitForReply(frame, 1, 4000);
      expect(reply).toMatchObject({ provider: 'chatgpt', status: 'success', tier: 'fast', matchedTiers: ['fast'] });
      expect(slider.value).toBe('0');
      expect(frame.clicks).toEqual([]);
    });

    it('uses separate model and thinking pickers and never mistakes Qwen3.7 for Qwen3.7-Max', async () => {
      const models = ['Qwen3.7-Max', 'Qwen3.7', 'Qwen3.6-flash'];
      const frame = createRecipeFixture({
        url: 'https://chat.qwen.ai/',
        roleless: true,
        triggers: [
          { id: 'model', attrs: 'class="wms-trigger"', text: 'Qwen3.7-Plus', items: () => models.map(label => ({ label, set: { model: label } })) },
          { id: 'mode', attrs: 'class="qwen-thinking-selector"', text: '自动', items: () => ['自动', '思考研究', '快速'].map(label => ({ label, set: { mode: label } })) }
        ]
      });
      sendHostMessage(frame, { type: 'SET_PROVIDER_TIER', tier: 'balanced', recipes: DEFAULT_TIER_RECIPES['qwen-global'] });

      const [reply] = await waitForReply(frame, 1, 4000);
      expect(reply).toMatchObject({ status: 'success', tier: 'balanced', actualLabel: 'Qwen3.7 · 思考研究' });
      expect(frame.clicks).toEqual(['open:model', 'Qwen3.7', 'open:mode', '思考研究']);
    });

    it('uses Qwen fast mode together with Qwen3.7-Max for the deep tier', async () => {
      const frame = createRecipeFixture({
        url: 'https://chat.qwen.ai/',
        roleless: true,
        triggers: [
          { id: 'model', attrs: 'class="wms-trigger"', text: 'Qwen3.7', items: () => ['Qwen3.7-Max', 'Qwen3.7', 'Qwen3.6-flash'].map(label => ({ label, set: { model: label } })) },
          { id: 'mode', attrs: 'class="qwen-thinking-selector"', text: '思考研究', items: () => ['自动', '思考研究', '快速'].map(label => ({ label, set: { mode: label } })) }
        ]
      });
      sendHostMessage(frame, { type: 'SET_PROVIDER_TIER', tier: 'deep', recipes: DEFAULT_TIER_RECIPES['qwen-global'] });

      const [reply] = await waitForReply(frame, 1, 4000);
      expect(reply).toMatchObject({ status: 'success', tier: 'deep', actualLabel: 'Qwen3.7-Max · 快速' });
      expect(frame.clicks).toEqual(['open:model', 'Qwen3.7-Max', 'open:mode', '快速']);
    });

    it.each([
      ['fast', '3.5 Flash-Lite', 'High'],
      ['balanced', '3.8 Flash', 'High'],
      ['deep', '4 Argon', 'High']
    ])('maps Gemini %s to its model with the High thinking level', async (tier, model, levelName) => {
      let level = '中';
      let currentModel = '3.5 Flash-Lite';
      const frame = createRecipeFixture({
        url: 'https://gemini.google.com/app',
        triggers: [{
          id: 'picker',
          attrs: `aria-label="打开模式选择器，当前模式为“${currentModel}”"`,
          text: 'Gemini 3.5 Flash-Lite',
          items: () => [
            ...[
              ['3.5 Flash-Lite 极速回答', 'Gemini 3.5 Flash-Lite', '3.5 Flash-Lite'],
              ['3.8 Flash', 'Gemini 3.8 Flash', '3.8 Flash'],
              ['3.1 Pro 高级推理', 'Gemini 3.1 Pro', '3.1 Pro'],
              ['4 Argon 复杂任务', 'Gemini 4 Argon', '4 Argon']
            ].map(([label, triggerLabel, selectedModel]) => ({
              label,
              checked: currentModel === selectedModel,
              get set() { currentModel = selectedModel; return { picker: triggerLabel }; }
            })),
            { label: `Thinking level ${level}`, submenu: ['Low', 'Medium', 'High'].map(choice => ({ label: choice, get set() { level = choice; return {}; } })) }
          ]
        }]
      });
      sendHostMessage(frame, { type: 'SET_PROVIDER_TIER', tier, recipes: DEFAULT_TIER_RECIPES.gemini });

      const [reply] = await waitForReply(frame, 1, 4000);
      expect(reply).toMatchObject({ status: 'success', tier, actualLabel: `Gemini ${model} · Thinking level ${levelName}` });
      expect(level).toBe(levelName);
      expect(currentModel).toBe(model);
      if (tier !== 'balanced') expect(frame.clicks).not.toContain('3.1 Pro 高级推理');
      expect(frame.win.document.getElementById('picker').textContent).toBe(`Gemini ${model}`);
    });

    it('maps Yuanbao to its model menu and DeepThink toggle, reading the model from the trigger id', async () => {
      const ids = { Hy3: 'hunyuan_gpt_175B_0404', DeepSeek: 'deep_seek_v3' };
      let model = 'Hy3';
      const frame = createProviderFrame({
        url: 'https://yuanbao.tencent.com/chat',
        html: `<textarea id="draft">recipe draft</textarea>
          <div id="model" type="button" class="ybc-model-select-button" dt-model-id="${ids.Hy3}"><span>元宝</span></div>
          <div id="think" class="ThinkSelector_iconContainer__a" dt-button-id="deep_think">深度思考</div>`
      });
      const { win } = frame;
      const clicks = [];
      const trigger = win.document.getElementById('model');
      const think = win.document.getElementById('think');
      think.addEventListener('click', () => { clicks.push('think'); think.classList.toggle('ThinkSelector_selected__b'); });
      trigger.addEventListener('click', () => {
        clicks.push('open:model');
        const popup = win.document.createElement('div');
        popup.className = 't-popup';
        for (const name of Object.keys(ids)) {
          const li = win.document.createElement('li');
          li.className = `t-dropdown__item${name === model ? ' t-dropdown__item--active' : ''}`;
          const item = win.document.createElement('div');
          item.className = 'ybc-model-select-dropdown-item';
          item.textContent = `${name} 说明`;
          // Like the live page, only the inner item reacts to clicks.
          item.addEventListener('click', event => {
            event.stopPropagation();
            clicks.push(name);
            model = name;
            trigger.setAttribute('dt-model-id', ids[name]);
            popup.remove();
          });
          li.append(item);
          markVisible(li, win);
          markVisible(item, win);
          popup.append(li);
        }
        markVisible(popup, win);
        win.document.body.append(popup);
      });

      sendHostMessage(frame, { type: 'SET_PROVIDER_TIER', tier: 'deep', recipes: DEFAULT_TIER_RECIPES.yuanbao });
      const [deepReply] = await waitForReply(frame, 1, 4000);
      expect(deepReply).toMatchObject({ status: 'success', tier: 'deep', matchedTiers: ['deep'], actualLabel: 'DeepSeek · 深度思考 on' });
      expect(clicks).toEqual(['open:model', 'DeepSeek', 'think']);

      sendHostMessage(frame, { type: 'SET_PROVIDER_TIER', tier: 'fast', requestId: 'yuanbao-fast', recipes: DEFAULT_TIER_RECIPES.yuanbao });
      const replies = await waitForReply(frame, 2, 4000);
      expect(replies.find(reply => reply.requestId === 'yuanbao-fast')).toMatchObject({
        status: 'success', tier: 'fast', matchedTiers: ['fast'], actualLabel: 'Hy3 · 深度思考 off'
      });

      sendHostMessage(frame, { type: 'GET_PROVIDER_TIER_STATE', requestId: 'yuanbao-state', recipes: DEFAULT_TIER_RECIPES.yuanbao });
      const states = await waitForReply(frame, 3, 2000);
      expect(states.find(reply => reply.requestId === 'yuanbao-state')).toMatchObject({ status: 'success', tier: 'fast' });
    });

    it('reports the failed step and what was confirmed before it', async () => {
      const frame = createRecipeFixture({
        url: 'https://chat.qwen.ai/',
        triggers: [
          { id: 'model', attrs: 'class="wms-trigger"', text: 'Qwen3.7-Plus', items: () => [{ label: 'Qwen3.7-Max', set: { model: 'Qwen3.7-Max' } }] },
          { id: 'mode', attrs: 'class="qwen-thinking-selector"', text: '自动', items: () => [{ label: '自动', set: { mode: '自动' } }] }
        ]
      });
      sendHostMessage(frame, { type: 'SET_PROVIDER_TIER', tier: 'deep', recipes: DEFAULT_TIER_RECIPES['qwen-global'] });

      const [reply] = await waitForReply(frame, 1, 4000);
      expect(reply).toMatchObject({
        status: 'error',
        reason: 'step_failed:thinking',
        tier: null,
        requestedTier: 'deep',
        actualLabel: 'Qwen3.7-Max · ?'
      });
    });

    it('reports tiers with identical recipes as one shared mapping (Meta AI)', async () => {
      const frame = createRecipeFixture({
        url: 'https://www.meta.ai/',
        triggers: [{ id: 'mode', attrs: 'aria-haspopup="menu"', text: '思考', items: () => ['即时', '思考'].map(label => ({ label, set: { mode: label } })) }]
      });
      sendHostMessage(frame, { type: 'SET_PROVIDER_TIER', tier: 'fast', recipes: DEFAULT_TIER_RECIPES['meta-ai'] });

      const [reply] = await waitForReply(frame, 1, 4000);
      expect(reply).toMatchObject({ status: 'success', tier: 'fast', matchedTiers: ['fast', 'balanced'] });
      expect(reply.actualLabel).toBe('即时 (shared mapping: fast/balanced)');
    });

    it('reads the current tier from a combined model and thinking label without opening it (ChatGLM)', async () => {
      const frame = createRecipeFixture({
        url: 'https://chatglm.cn/main/alltoolsdetail',
        triggers: [{ id: 'mode', attrs: 'class="think-mode-trigger"', text: 'GLM-Flash极致', items: () => [] }]
      });
      sendHostMessage(frame, { type: 'GET_PROVIDER_TIER_STATE', recipes: DEFAULT_TIER_RECIPES.chatglm });

      const [reply] = await waitForReply(frame);
      expect(reply).toMatchObject({ status: 'success', tier: 'balanced', matchedTiers: ['balanced'], actualLabel: 'GLM-Flash极致' });
      expect(frame.clicks).toEqual([]);
    });

    it('treats an empty tier recipe as not mapped and missing recipes as unsupported', async () => {
      const frame = kimiFixture();
      sendHostMessage(frame, {
        type: 'SET_PROVIDER_TIER', tier: 'fast', requestId: 'empty-tier',
        recipes: { ...DEFAULT_TIER_RECIPES.kimi, fast: [] }
      });
      sendHostMessage(frame, { type: 'SET_PROVIDER_TIER', tier: 'fast', requestId: 'no-recipes' });

      const replies = await waitForReply(frame, 2);
      expect(replies.find(reply => reply.requestId === 'empty-tier')).toMatchObject({ status: 'unsupported', reason: 'tier_not_mapped' });
      expect(replies.find(reply => reply.requestId === 'no-recipes')).toMatchObject({ status: 'unsupported', reason: 'missing_recipes' });
      expect(frame.clicks).toEqual([]);
    });
  });
});
