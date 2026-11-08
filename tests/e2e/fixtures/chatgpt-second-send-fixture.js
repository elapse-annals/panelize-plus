/**
 * ChatGPT fixture for the "second Send All does not submit" regression.
 *
 * The first prompt is sent from a home composer with a `send-button` test id.
 * That click swaps the page to a thread composer (the live site's home ->
 * thread transition), optionally keeps the old home composer in the DOM hidden
 * with `visibility`, and can make send unavailable while an answer streams.
 * The thread send control can be a plain localized submit button or the
 * `fruitjuice-send-button` test id, both seen on the live composer.
 *
 * @param {object} [config]
 * @param {'fruitjuice'|'submit-localized'} [config.threadSend]
 *   Send control rendered in the thread composer.
 * @param {'visibility'|'remove'} [config.hideHomeAfterSend]
 *   How the old home composer is retired; `visibility` leaves a hidden duplicate.
 * @param {number} [config.busyAfterFirstSendMs]
 *   How long the stop button stays visible after the first send. While busy the
 *   thread send control is removed, matching ChatGPT's composer.
 * @returns {string} HTML document.
 */
export function renderChatgptSecondSendFixture({
  threadSend = 'fruitjuice',
  hideHomeAfterSend = 'visibility',
  busyAfterFirstSendMs = 0,
} = {}) {
  const config = { threadSend, hideHomeAfterSend, busyAfterFirstSendMs };
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>ChatGPT second send fixture</title></head>
<body>
  <form data-fixture-role="edit-message">
    <textarea aria-label="Edit message">Earlier message</textarea>
    <button type="submit" aria-label="发送消息" data-fixture-stray>发送</button>
  </form>
  <form data-chatgpt-composer data-composer-placement="home" data-fixture-home>
    <div data-composer-markdown contenteditable="true" role="textbox" aria-label="Chat with ChatGPT"></div>
    <button type="submit" data-testid="send-button" aria-label="Send prompt" data-fixture-send>Send</button>
  </form>
  <script>
    const config = ${JSON.stringify(config)};
    const state = window.__fixture = {
      sends: 0,
      sentTexts: [],
      stopClicks: 0,
      straySends: [],
      phase: 'home',
      busy: false,
      transitions: 0,
    };
    const homeForm = document.querySelector('[data-fixture-home]');
    let threadForm = null;

    document.addEventListener('submit', (event) => event.preventDefault());
    document.addEventListener('click', (event) => {
      if (event.target.closest('[data-fixture-stop]')) {
        event.preventDefault();
        state.stopClicks += 1;
        return;
      }
      if (event.target.closest('[data-fixture-stray]')) {
        event.preventDefault();
        state.straySends.push('edit-message');
        return;
      }
      const sendButton = event.target.closest('[data-fixture-send]');
      if (sendButton) {
        event.preventDefault();
        handleSend(sendButton.closest('form'));
      }
    });

    function currentEditor(form) {
      return form?.querySelector('[data-composer-markdown]') || null;
    }

    function sendButtonHtml() {
      if (config.threadSend === 'submit-localized') {
        return '<button type="submit" aria-label="发送消息" data-fixture-send>发送</button>';
      }
      return '<button type="button" data-testid="fruitjuice-send-button" aria-label="发送" data-fixture-send>发送</button>';
    }

    function handleSend(form) {
      const editor = currentEditor(form);
      if (!editor) return;
      state.sends += 1;
      state.sentTexts.push(editor.textContent);
      editor.textContent = '';

      const firstSend = state.phase === 'home';
      if (firstSend) {
        transitionToThread();
        if (config.busyAfterFirstSendMs > 0) {
          startBusy(config.busyAfterFirstSendMs);
        }
      } else if (config.busyAfterFirstSendMs > 0) {
        startBusy(config.busyAfterFirstSendMs);
      }
    }

    function transitionToThread() {
      state.phase = 'thread';
      state.transitions += 1;
      threadForm = document.createElement('form');
      threadForm.setAttribute('data-chatgpt-composer', '');
      threadForm.setAttribute('data-composer-placement', 'thread');
      threadForm.innerHTML = '<div data-composer-markdown contenteditable="true" role="textbox" aria-label="Chat with ChatGPT"></div>'
        + sendButtonHtml();
      document.body.append(threadForm);

      if (config.hideHomeAfterSend === 'remove') {
        homeForm.remove();
      } else {
        homeForm.style.visibility = 'hidden';
      }
    }

    function startBusy(durationMs) {
      if (!threadForm || state.busy) return;
      state.busy = true;
      const sendButton = threadForm.querySelector('[data-fixture-send]');
      sendButton?.remove();
      const stopButton = document.createElement('button');
      stopButton.type = 'button';
      stopButton.dataset.testid = 'stop-button';
      stopButton.dataset.fixtureStop = '';
      stopButton.setAttribute('aria-label', 'Stop streaming');
      stopButton.textContent = 'Stop';
      threadForm.append(stopButton);

      setTimeout(() => {
        stopButton.remove();
        state.busy = false;
        if (threadForm) {
          threadForm.insertAdjacentHTML('beforeend', sendButtonHtml());
        }
      }, durationMs);
    }
  </script>
</body>
</html>`;
}