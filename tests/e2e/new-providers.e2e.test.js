import { test, expect } from '@playwright/test';
import { OPTIONAL_PROVIDER_CONFIGS } from '../../modules/providers/optional-provider-access.js';
import {
  createPatchedExtensionCopy,
  launchExtension,
  openMultiPanel
} from './support/extension-harness.js';

const PROVIDERS = [
  {
    id: 'perplexity',
    origin: 'https://www.perplexity.ai',
    scriptId: 'perplexity-scripts',
    ruleId: 1010,
    composer: '#ask-input',
    messages: '#sent-messages'
  },
  {
    id: 'copilot',
    origin: 'https://copilot.com',
    scriptId: 'copilot-scripts',
    ruleId: 1011,
    composer: 'span#m365-chat-editor-target-element[contenteditable="true"][role="textbox"][data-lexical-editor="true"]',
    messages: '#sent-messages'
  },
  {
    id: 'wenxin',
    origin: 'https://wenxin.baidu.com',
    scriptId: 'wenxin-scripts',
    ruleId: 1012,
    composer: '#chat-textarea',
    messages: '#sent-messages'
  }
];

function providerFixture(providerId) {
  const composer = providerId === 'perplexity'
    ? '<div id="ask-input" contenteditable="true" role="textbox" data-lexical-editor="true" aria-label="Ask anything"></div>'
    : providerId === 'copilot'
      ? '<span id="m365-chat-editor-target-element" contenteditable="true" role="textbox" data-lexical-editor="true" aria-label="Message Copilot" style="display:block;min-width:240px;min-height:36px"></span>'
      : '<textarea id="chat-textarea" class="ci-textarea" aria-label="输入消息"></textarea>';

  const sendControl = providerId === 'perplexity'
    ? '<button type="button" aria-label="提交">Send</button>'
    : providerId === 'copilot'
      ? '<button type="submit" aria-label="Send" class="fai-SendButton fai-BebopLiteChatInput__send">Send</button>'
      : '<span class="ci-submit-button"><img id="ci-submit-button-ai" class="ci-submit-button-ai-active" src="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2724%27 height=%2724%27%3E%3Crect width=%2724%27 height=%2724%27 rx=%274%27 fill=%27%23333%27/%3E%3C/svg%3E" width="24" height="24" alt="Send"></span>';

  const wenxinHandler = providerId === 'wenxin'
    ? `
      const sendIcon = document.querySelector('#ci-submit-button-ai');
      composer.addEventListener('input', () => {
        sendIcon.classList.toggle('ci-submit-button-ai-active', Boolean(composer.value.trim()));
      });
      sendIcon.addEventListener('click', () => form.requestSubmit());
    `
    : '';
  const composerContainer = providerId === 'perplexity'
    ? `<div class="bg-composer">${composer}${sendControl}</div>`
    : providerId === 'copilot'
      ? `<form id="composer-form"><div id="m365-chat-input-shared-container" data-test-id="chat-input-wrapper">${composer}${sendControl}</div></form>`
      : `<form id="composer-form">${composer}${sendControl}</form>`;

  return `<!doctype html>
    <html><head><meta charset="utf-8"><title>${providerId} fixture</title></head>
    <body>
      ${composerContainer}
      <ol id="sent-messages" aria-label="Sent messages"></ol>
      <script>
        const form = document.querySelector('#composer-form');
        const composer = document.querySelector('#${providerId === 'perplexity' ? 'ask-input' : providerId === 'copilot' ? 'm365-chat-editor-target-element' : 'chat-textarea'}');
        function sendMessage(event) {
          event?.preventDefault();
          const text = composer.isContentEditable ? composer.textContent : composer.value;
          if (!text.trim()) return;
          const item = document.createElement('li');
          item.textContent = text;
          document.querySelector('#sent-messages').append(item);
          if (composer.isContentEditable) composer.textContent = '';
          else composer.value = '';
          composer.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (form) form.addEventListener('submit', sendMessage);
        if ('${providerId}' === 'perplexity') {
          document.querySelector('.bg-composer button[aria-label="提交"]').addEventListener('click', sendMessage);
        }
        ${wenxinHandler}
      </script>
    </body></html>`;
}

test('registers and sends through the new optional providers', async ({}, testInfo) => {
  test.setTimeout(90000);

  let extensionCopy;
  let extension;
  try {
    const requestedOrigins = [...new Set(PROVIDERS.flatMap(({ id }) => OPTIONAL_PROVIDER_CONFIGS[id].origins))];
    extensionCopy = await createPatchedExtensionCopy(manifest => {
      manifest.host_permissions.push(...requestedOrigins);
    });
    extension = await launchExtension({ extensionPath: extensionCopy.extensionPath });

    await extension.serviceWorker.evaluate(async (providerIds) => {
      await chrome.storage.sync.set({
        enabledProviders: providerIds,
        providerOrder: providerIds,
        enterKeyBehavior: {
          enabled: true,
          preset: 'default',
          newlineModifiers: { shift: true, ctrl: false, alt: false, meta: false },
          sendModifiers: { shift: false, ctrl: false, alt: false, meta: false }
        }
      });
    }, PROVIDERS.map(({ id }) => id));

    await expect.poll(() => extension.serviceWorker.evaluate(async () => {
      const scripts = await chrome.scripting.getRegisteredContentScripts();
      const rules = await chrome.declarativeNetRequest.getDynamicRules();
      return {
        scripts: scripts.map(({ id }) => id),
        rules: rules.map(({ id }) => id)
      };
    })).toEqual({
      scripts: expect.arrayContaining(PROVIDERS.map(({ scriptId }) => scriptId)),
      rules: expect.arrayContaining(PROVIDERS.map(({ ruleId }) => ruleId))
    });

    for (const { origin, id } of PROVIDERS) {
      await extension.context.route(`${origin}/**`, route => route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: providerFixture(id)
      }));
    }

    const page = await openMultiPanel(extension, {
      providers: PROVIDERS.map(({ id }) => id),
      enabledProviders: PROVIDERS.map(({ id }) => id),
      layout: '1x3'
    });

    for (const provider of PROVIDERS) {
      const frame = page.frameLocator(`#panel-grid iframe[src^="${provider.origin}"]`);
      await expect(frame.locator(provider.composer)).toBeVisible();
    }

    await page.locator('#unified-input').fill('Send All fixture message');
    await page.locator('#fill-input-btn').click();

    for (const provider of PROVIDERS) {
      const frame = page.frameLocator(`#panel-grid iframe[src^="${provider.origin}"]`);
      await expect.poll(() => frame.locator(provider.composer).evaluate(element => (
        element.isContentEditable ? element.textContent : element.value
      ))).toBe('Send All fixture message');
    }

    await page.screenshot({ path: testInfo.outputPath('new-providers.png'), fullPage: true });
    await page.locator('#send-all-btn').click();

    for (const provider of PROVIDERS) {
      const frame = page.frameLocator(`#panel-grid iframe[src^="${provider.origin}"]`);
      await expect(frame.locator(provider.messages).locator('li')).toHaveText(['Send All fixture message']);
    }

    await page.close();

    for (const provider of PROVIDERS) {
      const enterPage = await openMultiPanel(extension, {
        providers: [provider.id],
        enabledProviders: [provider.id],
        layout: '1x1'
      });
      const frame = enterPage.frameLocator(`#panel-grid iframe[src^="${provider.origin}"]`);
      const composer = frame.locator(provider.composer);
      const message = `Enter fixture message: ${provider.id}`;
      await composer.click();
      await composer.fill('Line one');
      await composer.press('Shift+Enter');
      await composer.pressSequentially('Line two');
      await expect.poll(() => composer.evaluate(element => (
        element.isContentEditable ? element.innerText : element.value
      ))).toMatch(/^Line one[\r\n]+Line two$/);
      await expect(frame.locator(provider.messages).locator('li')).toHaveCount(0);

      await composer.fill(message);
      await composer.press('Enter');
      await expect(frame.locator(provider.messages).locator('li')).toHaveText([message]);
      await enterPage.close();
    }
  } finally {
    await extension?.close();
    await extensionCopy?.cleanup();
  }
});
