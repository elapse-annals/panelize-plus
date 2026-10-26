import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const composerScriptSource = readFileSync(
  resolve(process.cwd(), 'content-scripts/chatgpt-composer.js'),
  'utf8'
);
const contentScriptSource = readFileSync(
  resolve(process.cwd(), 'content-scripts/text-injection-all-providers.js'),
  'utf8'
);

const START = Date.UTC(2026, 9, 24, 8, 0, 0);

function dispatchMultiPanelMessage(payload) {
  window.dispatchEvent(new MessageEvent('message', { data: payload }));
}

function getTimingCalls(requestId) {
  return window.parent.postMessage.mock.calls
    .map(call => call[0])
    .filter(payload => (
      payload?.type === 'PANELIZE_RESPONSE_TIMING'
      && payload?.context === 'multi-panel-provider-status'
      && payload?.requestId === requestId
    ));
}

function getPhases(requestId) {
  return getTimingCalls(requestId).map(call => call.phase);
}

function getEngagementKinds(requestId) {
  return window.parent.postMessage.mock.calls
    .map(call => call[0])
    .filter(payload => (
      payload?.type === 'PANELIZE_ANSWER_ENGAGEMENT'
      && payload?.context === 'multi-panel-provider-status'
      && payload?.requestId === requestId
    ))
    .map(payload => payload.kind);
}

function dispatchUserEvent(type, { trusted = true } = {}) {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, 'isTrusted', { value: trusted });
  document.body.dispatchEvent(event);
}

function startSend(requestId) {
  dispatchMultiPanelMessage({ type: 'TRIGGER_SEND', requestId, context: 'multi-panel' });
}

describe('response timing content script', () => {
  beforeAll(() => {
    window.eval(composerScriptSource);
    window.eval(contentScriptSource);
  });

  beforeEach(() => {
    vi.useFakeTimers({ now: START });
    Object.defineProperty(window, 'parent', {
      configurable: true,
      value: { postMessage: vi.fn() },
    });
  });

  afterEach(() => {
    // Release the previous request's observer as well as its polling timer.
    dispatchMultiPanelMessage({ type: 'NEW_CHAT', context: 'multi-panel' });
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('does not rescan answers or reread unchanged text while waiting or generating', async () => {
    window.happyDOM.setURL('https://chat.deepseek.com/a/chat/s/test');
    document.body.innerHTML = '<div id="thread"></div>';
    const queries = vi.spyOn(document, 'querySelectorAll');
    const answerQueries = () => queries.mock.calls.filter(([selector]) => selector === '.ds-markdown').length;
    startSend('req-cached');
    await vi.advanceTimersByTimeAsync(2000);
    expect(answerQueries()).toBe(1);

    document.getElementById('thread').innerHTML = '<div class="ds-markdown">First output</div>';
    const answer = document.querySelector('.ds-markdown');
    const textReads = vi.spyOn(answer, 'textContent', 'get');
    await vi.advanceTimersByTimeAsync(250);
    expect(getPhases('req-cached')).toEqual(['first-output']);
    expect(answerQueries()).toBe(2);
    expect(textReads).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(2000);
    expect(answerQueries()).toBe(2);
    expect(textReads).toHaveBeenCalledOnce();
    answer.firstChild.data = 'Updated output';
    await vi.advanceTimersByTimeAsync(250);
    expect(textReads).toHaveBeenCalledTimes(2);
    expect(answerQueries()).toBe(2);
  });

  it('reconnects to a replaced answer and retains the last text-change timestamp', async () => {
    window.happyDOM.setURL('https://chat.deepseek.com/a/chat/s/test');
    document.body.innerHTML = '<div id="thread"></div>';
    startSend('req-replaced-answer');
    document.getElementById('thread').innerHTML = '<div class="ds-markdown">First output</div>';
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(1000);
    document.querySelector('.ds-markdown').outerHTML = '<div class="ds-markdown">Replacement output</div>';
    await vi.advanceTimersByTimeAsync(250);
    const changedAt = Date.now();
    await vi.advanceTimersByTimeAsync(5000);
    expect(getTimingCalls('req-replaced-answer')).toEqual([
      expect.objectContaining({ phase: 'first-output' }),
      expect.objectContaining({ phase: 'complete', at: changedAt })
    ]);
  });

  it('keeps the baseline text immutable when an earlier answer changes', async () => {
    window.happyDOM.setURL('https://gemini.google.com/app/test');
    document.body.innerHTML = '<div id="thread"><model-response>Earlier answer</model-response></div>';
    startSend('req-baseline');
    document.querySelector('model-response').textContent = 'Updated earlier answer';
    await vi.advanceTimersByTimeAsync(250);
    expect(getPhases('req-baseline')).toEqual([]);
    document.querySelector('model-response').outerHTML = '<model-response>Updated earlier answer</model-response>';
    await vi.advanceTimersByTimeAsync(250);
    expect(getPhases('req-baseline')).toEqual(['first-output']);
  });

  it('times a ChatGPT answer from first text until the stop button is gone and the text settles', async () => {
    window.happyDOM.setURL('https://chatgpt.com/c/test');
    document.body.innerHTML = `
      <main id="thread">
        <div data-message-author-role="assistant">Earlier answer</div>
      </main>
      <form data-type="unified-composer">
        <div id="prompt-textarea" contenteditable="true" role="textbox"></div>
      </form>
    `;
    const thread = document.getElementById('thread');
    const composer = document.querySelector('form');

    startSend('req-chatgpt');
    await vi.advanceTimersByTimeAsync(1000);
    expect(getPhases('req-chatgpt')).toEqual([]);

    composer.insertAdjacentHTML('beforeend', '<button data-testid="stop-button">Stop</button>');
    thread.insertAdjacentHTML('beforeend', '<div data-message-author-role="assistant" id="answer">Hel</div>');
    await vi.advanceTimersByTimeAsync(250);
    expect(getTimingCalls('req-chatgpt')).toEqual([
      expect.objectContaining({ phase: 'first-output', provider: 'chatgpt', at: START + 1250 }),
    ]);

    await vi.advanceTimersByTimeAsync(750);
    document.getElementById('answer').textContent = 'Hello world';
    await vi.advanceTimersByTimeAsync(250);
    const lastChangeAt = Date.now();

    // Still streaming while the stop button shows, however long the text pauses.
    await vi.advanceTimersByTimeAsync(6000);
    expect(getPhases('req-chatgpt')).toEqual(['first-output']);

    composer.querySelector('[data-testid="stop-button"]').remove();
    await vi.advanceTimersByTimeAsync(250);
    expect(getTimingCalls('req-chatgpt')).toEqual([
      expect.objectContaining({ phase: 'first-output' }),
      expect.objectContaining({ phase: 'complete', at: lastChangeAt }),
    ]);
  });

  it('times a current-layout ChatGPT answer from its markdown, not the hidden speaker label, until streaming ends', async () => {
    window.happyDOM.setURL('https://chatgpt.com/c/test');
    document.body.innerHTML = `
      <ol id="thread" data-conversation-transcript>
        <li data-message-role="assistant" data-message-complete>
          <h4>ChatGPT said:</h4><div data-assistant-markdown-root><p>Earlier answer</p></div>
        </li>
      </ol>
    `;
    const thread = document.getElementById('thread');

    startSend('req-chatgpt-current');
    thread.insertAdjacentHTML('beforeend', '<li data-message-role="assistant" data-message-streaming id="turn"><h4>ChatGPT said:</h4></li>');
    await vi.advanceTimersByTimeAsync(1000);
    expect(getPhases('req-chatgpt-current')).toEqual([]);

    const turn = document.getElementById('turn');
    turn.insertAdjacentHTML('beforeend', '<div data-assistant-markdown-root><p id="answer">Hel</p></div>');
    await vi.advanceTimersByTimeAsync(250);
    expect(getTimingCalls('req-chatgpt-current')).toEqual([
      expect.objectContaining({ phase: 'first-output', provider: 'chatgpt', at: START + 1250 }),
    ]);

    document.getElementById('answer').textContent = 'Hello world';
    await vi.advanceTimersByTimeAsync(250);
    const lastChangeAt = Date.now();

    // Still streaming while the turn is marked as streaming.
    await vi.advanceTimersByTimeAsync(6000);
    expect(getPhases('req-chatgpt-current')).toEqual(['first-output']);

    turn.removeAttribute('data-message-streaming');
    turn.setAttribute('data-message-complete', '');
    await vi.advanceTimersByTimeAsync(250);
    expect(getTimingCalls('req-chatgpt-current')).toEqual([
      expect.objectContaining({ phase: 'first-output' }),
      expect.objectContaining({ phase: 'complete', at: lastChangeAt }),
    ]);
  });

  it('completes a DeepSeek answer once its text has not changed for the settle time', async () => {
    window.happyDOM.setURL('https://chat.deepseek.com/a/chat/s/test');
    document.body.innerHTML = '<div id="thread"></div>';
    const thread = document.getElementById('thread');

    startSend('req-deepseek');
    await vi.advanceTimersByTimeAsync(500);
    thread.insertAdjacentHTML('beforeend', '<div class="ds-markdown" id="answer">Thinking</div>');
    await vi.advanceTimersByTimeAsync(250);
    const firstOutputAt = Date.now();

    await vi.advanceTimersByTimeAsync(3000);
    document.getElementById('answer').textContent = 'Thinking done. Answer';
    await vi.advanceTimersByTimeAsync(250);
    const lastChangeAt = Date.now();

    await vi.advanceTimersByTimeAsync(4500);
    expect(getPhases('req-deepseek')).toEqual(['first-output']);

    await vi.advanceTimersByTimeAsync(750);
    expect(getTimingCalls('req-deepseek')).toEqual([
      expect.objectContaining({ phase: 'first-output', provider: 'deepseek', at: firstOutputAt }),
      expect.objectContaining({ phase: 'complete', at: lastChangeAt }),
    ]);
  });

  it('times every provider the answer stats module times', () => {
    const source = readFileSync(resolve(process.cwd(), 'modules/answer-stats.js'), 'utf8');
    const ids = source.match(/ANSWER_TIMING_PROVIDER_IDS = Object\.freeze\(\[([^\]]*)\]/)[1]
      .match(/'([^']+)'/g).map(id => id.slice(1, -1));
    const timed = contentScriptSource.match(/const RESPONSE_TIMING_PROVIDERS = \{([\s\S]*?)\n  \};/)[1]
      .match(/^    '?([\w-]+)'?: \{/gm).map(line => line.trim().replace(/'?: \{$/, '').replace(/^'/, ''));
    expect(timed).toEqual(ids);
  });

  it.each([
    ['kimi', 'https://www.kimi.com/chat/test',
      '<div class="chat-content-item chat-content-item-assistant"><div class="markdown">Hi</div></div>',
      '<div class="send-button-container disabled stop"></div>', '.send-button-container'],
    ['qwen-cn', 'https://www.qianwen.com/chat/test',
      '<div class="answer-common-card answer-receiving-card"><div class="qk-markdown">Hi</div></div>',
      '', '.answer-common-card'],
  ])('completes a %s answer once its stop state is gone', async (provider, url, answerHtml, busyHtml, busyQuery) => {
    window.happyDOM.setURL(url);
    document.body.innerHTML = '<div id="thread"></div>';
    const thread = document.getElementById('thread');
    const requestId = `req-${provider}`;

    startSend(requestId);
    await vi.advanceTimersByTimeAsync(500);
    thread.insertAdjacentHTML('beforeend', answerHtml + busyHtml);
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(6000);
    expect(getTimingCalls(requestId)).toEqual([
      expect.objectContaining({ phase: 'first-output', provider }),
    ]);

    const busy = thread.querySelector(busyQuery);
    busy.classList.remove('stop', 'answer-receiving-card');
    await vi.advanceTimersByTimeAsync(250);
    expect(getPhases(requestId)).toEqual(['first-output', 'complete']);
  });

  it('completes a Yuanbao answer after its settle time', async () => {
    window.happyDOM.setURL('https://yuanbao.tencent.com/chat/test');
    document.body.innerHTML = '<div id="thread"></div>';
    const thread = document.getElementById('thread');

    startSend('req-yuanbao');
    await vi.advanceTimersByTimeAsync(500);
    thread.insertAdjacentHTML('beforeend', '<div class="agent-chat__bubble agent-chat__bubble--ai"><div class="agent-chat__speech-text">Hi</div></div>');
    await vi.advanceTimersByTimeAsync(4750);
    expect(getPhases('req-yuanbao')).toEqual(['first-output']);
    await vi.advanceTimersByTimeAsync(500);
    expect(getPhases('req-yuanbao')).toEqual(['first-output', 'complete']);
  });

  it('does not count a re-rendered previous answer as new output', async () => {
    window.happyDOM.setURL('https://gemini.google.com/app/test');
    document.body.innerHTML = '<div id="thread"><model-response>Earlier answer</model-response></div>';
    const thread = document.getElementById('thread');

    startSend('req-gemini');
    await vi.advanceTimersByTimeAsync(500);
    thread.innerHTML = '<model-response>Earlier answer</model-response>';
    await vi.advanceTimersByTimeAsync(1000);
    expect(getPhases('req-gemini')).toEqual([]);

    thread.insertAdjacentHTML('beforeend', '<model-response>New answer</model-response>');
    await vi.advanceTimersByTimeAsync(250);
    expect(getPhases('req-gemini')).toEqual(['first-output']);
  });

  it('reports cancelled when a new chat starts and when another send replaces it', async () => {
    window.happyDOM.setURL('https://chat.deepseek.com/a/chat/s/test');
    document.body.innerHTML = '<div id="thread"></div>';

    startSend('req-replaced');
    await vi.advanceTimersByTimeAsync(250);
    startSend('req-new-chat');
    await vi.advanceTimersByTimeAsync(250);
    dispatchMultiPanelMessage({ type: 'NEW_CHAT', context: 'multi-panel' });

    expect(getPhases('req-replaced')).toEqual(['cancelled']);
    expect(getPhases('req-new-chat')).toEqual(['cancelled']);
  });

  it('reports a timeout when no answer appears', async () => {
    window.happyDOM.setURL('https://chat.deepseek.com/a/chat/s/test');
    document.body.innerHTML = '<div id="thread"></div>';

    startSend('req-timeout');
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 - 250);
    expect(getPhases('req-timeout')).toEqual([]);

    await vi.advanceTimersByTimeAsync(250);
    expect(getPhases('req-timeout')).toEqual(['timeout']);
  });

  it('reports clicks and scrolls on the last sent answer for every provider', async () => {
    window.happyDOM.setURL('https://www.kimi.com/chat/test');
    document.body.innerHTML = '<div class="markdown">Answer</div>';

    dispatchUserEvent('pointerdown');
    expect(getEngagementKinds(undefined)).toEqual([]);

    startSend('req-engaged');
    dispatchUserEvent('pointerdown');
    dispatchUserEvent('wheel');
    // Reported at most once per second for each kind, and only for user input.
    dispatchUserEvent('wheel');
    dispatchUserEvent('touchmove');
    dispatchUserEvent('pointerdown', { trusted: false });
    expect(getEngagementKinds('req-engaged')).toEqual(['click', 'scroll']);

    await vi.advanceTimersByTimeAsync(1000);
    dispatchUserEvent('touchmove');
    expect(getEngagementKinds('req-engaged')).toEqual(['click', 'scroll', 'scroll']);
    expect(window.parent.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ provider: 'kimi' }),
      '*'
    );

    // A new chat no longer shows the answer.
    dispatchMultiPanelMessage({ type: 'NEW_CHAT', context: 'multi-panel' });
    await vi.advanceTimersByTimeAsync(1000);
    dispatchUserEvent('pointerdown');
    expect(getEngagementKinds('req-engaged')).toEqual(['click', 'scroll', 'scroll']);
  });

  it('does not time providers without timing support', async () => {
    window.happyDOM.setURL('https://chatglm.cn/main/alltoolsdetail');
    document.body.innerHTML = '<div id="thread"></div>';

    startSend('req-chatglm');
    document.getElementById('thread').innerHTML = '<div class="markdown">Answer</div>';
    await vi.advanceTimersByTimeAsync(10000);

    expect(getPhases('req-chatglm')).toEqual([]);
  });
});
