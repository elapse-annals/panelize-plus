/**
 * Minimal provider pages for browser tests. The extension's real manifest
 * content scripts run against these pages through the production host names;
 * the pages never contact a provider service.
 */
export function renderProviderTierFixture(provider, {
  newChatFailOnClicks = [],
  newChatResetMode = null,
  loggedOut = false,
  chatgptControl = 'menu',
} = {}) {
  if (loggedOut) {
    return `<!doctype html><html><head><meta charset="utf-8"><title>${provider} login fixture</title></head>
      <body><button data-testid="login-button" aria-label="Log in">Log in</button></body></html>`;
  }

  const isChatgpt = provider === 'chatgpt';
  // ChatGPT shows GPT-6 in its model switcher and the tier in a separate
  // reasoning-effort control (a menu, or a strength slider).
  const gptModelMarkup = '<button type="button" data-testid="model-switcher" aria-label="GPT-6">GPT-6</button>';
  const modelMarkup = isChatgpt && chatgptControl === 'slider' ? `${gptModelMarkup}
    <button type="button" id="thinking-strength-button" data-testid="thinking-strength" aria-expanded="false">Thinking strength Medium</button>
    <div id="thinking-strength-popover" hidden>
      <label for="thinking-strength-slider">Thinking strength</label>
      <input id="thinking-strength-slider" type="range" min="0" max="2" step="1" value="1">
    </div>` : isChatgpt ? `${gptModelMarkup}
    <button type="button" data-testid="reasoning-effort" aria-label="Medium" aria-expanded="false">Medium</button>
    <div id="model-menu" role="menu" data-state="closed" style="display:none">
      <button type="button" role="option" data-tier-option="fast" aria-selected="false">Instant</button>
      <button type="button" role="option" data-tier-option="balanced" aria-selected="true">Medium</button>
      <button type="button" role="option" data-tier-option="deep" aria-selected="false">High</button>
    </div>` : '';
  const composerMarkup = isChatgpt
    ? `<form data-type="unified-composer" data-chatgpt-composer data-composer-placement="thread">
        <div data-composer-markdown contenteditable="true" role="textbox" aria-label="Chat with ChatGPT">Prior conversation text</div>
        <button type="submit" aria-label="Send prompt">Send</button>
      </form>`
    : `<textarea class="ds-scroll-area" placeholder="How can I help you?">Prior conversation text</textarea>`;
  const toggleMarkup = provider === 'deepseek'
    ? `<button id="deep-think" type="button" aria-label="DeepThink" aria-pressed="false">DeepThink</button>`
    : '';

  return `<!doctype html><html><head><meta charset="utf-8"><title>${provider} fixture</title></head>
    <body>
      <nav><button type="button" data-testid="new-chat-button" aria-label="New chat">New chat</button></nav>
      ${modelMarkup}
      ${toggleMarkup}
      <div data-message-author-role="user">Prior user message</div>
      ${composerMarkup}
      <script>
        const config = ${JSON.stringify({ newChatFailOnClicks, newChatResetMode })};
        const provider = ${JSON.stringify(provider)};
        const newChatButton = document.querySelector('[data-testid="new-chat-button"]');
        const editor = provider === 'chatgpt'
          ? document.querySelector('[data-composer-markdown]')
          : document.querySelector('textarea');
        const modelButton = document.querySelector('[data-testid="reasoning-effort"]');
        const modelMenu = document.getElementById('model-menu');
        const strengthButton = document.getElementById('thinking-strength-button');
        const strengthPopover = document.getElementById('thinking-strength-popover');
        let strengthSlider = document.getElementById('thinking-strength-slider');
        const deepThink = document.getElementById('deep-think');
        window.__fixture = { provider, newChats: 0, modelChanges: 0, deepThinkChanges: 0 };

        function setModel(tier) {
          const label = tier === 'fast' ? 'Instant' : tier === 'deep' ? 'High' : 'Medium';
          modelButton.setAttribute('aria-label', label);
          modelButton.textContent = label;
          modelMenu.querySelectorAll('[data-tier-option]').forEach(option => {
            option.setAttribute('aria-selected', String(option.dataset.tierOption === tier));
          });
          window.__fixture.model = label;
        }

        modelButton?.addEventListener('click', () => {
          const open = modelButton.getAttribute('aria-expanded') === 'true';
          modelButton.setAttribute('aria-expanded', String(!open));
          modelMenu.dataset.state = open ? 'closed' : 'open';
          modelMenu.style.display = open ? 'none' : 'block';
        });
        modelMenu?.querySelectorAll('[data-tier-option]').forEach(option => option.addEventListener('click', () => {
          setModel(option.dataset.tierOption);
          window.__fixture.modelChanges += 1;
          modelButton.setAttribute('aria-expanded', 'false');
          modelMenu.dataset.state = 'closed';
          modelMenu.style.display = 'none';
        }));
        function updateStrengthLabel(value) {
          const label = ['Low', 'Medium', 'High'][Number(value)];
          strengthButton.textContent = 'Thinking strength ' + label;
          window.__fixture.model = label;
        }
        function setStrength(value) {
          strengthSlider.value = String(value);
          updateStrengthLabel(value);
        }
        function handleStrengthInput(event) {
          const changedSlider = event.currentTarget;
          const value = changedSlider.value;
          setTimeout(() => {
            if (!changedSlider.isConnected) return;
            const replacement = changedSlider.cloneNode(true);
            replacement.value = value;
            replacement.addEventListener('input', handleStrengthInput);
            changedSlider.replaceWith(replacement);
            strengthSlider = replacement;
            updateStrengthLabel(value);
            window.__fixture.modelChanges += 1;
          }, 40);
        }
        strengthButton?.addEventListener('click', () => {
          strengthPopover.hidden = !strengthPopover.hidden;
          strengthButton.setAttribute('aria-expanded', String(!strengthPopover.hidden));
        });
        strengthSlider?.addEventListener('input', handleStrengthInput);
        if (strengthSlider) setStrength(strengthSlider.value);
        document.addEventListener('keydown', event => {
          if (event.key === 'Escape' && strengthPopover && !strengthPopover.hidden) {
            strengthPopover.hidden = true;
            strengthButton.setAttribute('aria-expanded', 'false');
          }
        });
        deepThink?.addEventListener('click', () => {
          deepThink.setAttribute('aria-pressed', String(deepThink.getAttribute('aria-pressed') !== 'true'));
          window.__fixture.deepThinkChanges += 1;
        });
        newChatButton.addEventListener('click', () => {
          window.__fixture.newChats += 1;
          if (config.newChatFailOnClicks.includes(window.__fixture.newChats)) return;
          if (editor) {
            if (editor.isContentEditable) editor.textContent = '';
            else editor.value = '';
          }
          document.querySelectorAll('[data-message-author-role="user"], [data-message-author-role="assistant"]').forEach(node => node.remove());
          if (deepThink) {
            deepThink.setAttribute('aria-pressed', 'false');
            window.__fixture.deepThinkChanges += 1;
          }
          if (modelButton && config.newChatResetMode) {
            setModel(config.newChatResetMode);
            window.__fixture.modelChanges += 1;
          }
          if (strengthSlider && config.newChatResetMode) {
            setStrength(config.newChatResetMode === 'fast' ? 0 : config.newChatResetMode === 'deep' ? 2 : 1);
            window.__fixture.modelChanges += 1;
          }
        });
      </script>
    </body></html>`;
}

export function renderUnsupportedProviderFixture(provider = 'grok', options = {}) {
  return renderProviderTierFixture(provider, options);
}
