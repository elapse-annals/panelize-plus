import { test, expect } from '@playwright/test';
import { launchExtension, openMultiPanel } from './extension-harness.js';
import { renderChatgptFixture } from './fixtures/chatgpt-fixture.js';

const DEEPSEEK_FIXTURE = `<!doctype html>
<html><body>
  <div id="thread"></div>
  <textarea placeholder="How can I help you?"></textarea>
</body></html>`;

function findFrame(page, origin) {
  return page.frames().find(candidate => candidate.url().startsWith(origin));
}

async function appendAnswer(page, origin, html) {
  const frame = findFrame(page, origin);
  await frame.evaluate((answerHtml) => {
    const container = document.getElementById('thread') || document.body;
    container.insertAdjacentHTML('beforeend', answerHtml);
  }, html);
}

test('Answer stats time each answer and record the adopted one', async ({}, testInfo) => {
  test.setTimeout(60000);
  const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
  try {
    await extension.context.route('https://chatgpt.com/**', route => route.fulfill({
      contentType: 'text/html', body: renderChatgptFixture({ composer: 'current' }),
    }));
    await extension.context.route('https://chat.deepseek.com/**', route => route.fulfill({
      contentType: 'text/html', body: DEEPSEEK_FIXTURE,
    }));
    const page = await openMultiPanel(extension, { providers: ['chatgpt', 'deepseek'], layout: '1x2' });
    const adoptButtons = page.locator('.adopt-answer-btn');
    await expect(adoptButtons).toHaveCount(2);
    await expect(adoptButtons.nth(0)).toBeDisabled();
    await expect.poll(() => Boolean(findFrame(page, 'https://chat.deepseek.com/'))).toBe(true);

    await page.locator('#unified-input').fill('Which answer is best?');
    await page.locator('#send-all-btn').click();
    await expect(adoptButtons.nth(0)).toBeEnabled();

    await appendAnswer(page, 'https://chatgpt.com/', '<div data-message-author-role="assistant">ChatGPT answer</div>');
    await appendAnswer(page, 'https://chat.deepseek.com/', '<div class="ds-markdown">DeepSeek answer</div>');

    await adoptButtons.nth(1).click();
    await expect(adoptButtons.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(adoptButtons.nth(0)).toHaveAttribute('aria-pressed', 'false');

    await page.locator('#answer-stats-btn').click();
    const rows = page.locator('#answer-stats-table tbody tr');
    await expect(rows).toHaveCount(2);
    const deepseekRow = rows.filter({ hasText: 'DeepSeek' });
    const chatgptRow = rows.filter({ hasText: 'ChatGPT' });
    await expect(deepseekRow.locator('td').nth(5)).toHaveText('1');
    await expect(deepseekRow.locator('td').nth(6)).toHaveText('100%');
    await expect(chatgptRow.locator('td').nth(6)).toHaveText('0%');

    // Both answers finish once their text settles (DeepSeek waits 5s).
    await expect(chatgptRow.locator('td').nth(3)).not.toHaveText('—', { timeout: 15000 });
    await expect(deepseekRow.locator('td').nth(3)).not.toHaveText('—', { timeout: 15000 });
    await expect(deepseekRow.locator('td').nth(2)).toHaveText(/\d+(\.\d)? m?s \(/);
    await expect(page.locator('#answer-stats-recent li')).toHaveCount(1);
    await expect(page.locator('.answer-stats-recent-prompt')).toHaveText('Which answer is best?');
    await expect(page.locator('.answer-stats-chip.adopted')).toContainText('DeepSeek');
    await page.screenshot({ path: testInfo.outputPath('answer-stats.png') });

    // Stats survive a reload, and the adoption can be undone before that.
    await page.locator('#close-answer-stats-modal').click();
    await adoptButtons.nth(1).click();
    await expect(adoptButtons.nth(1)).toHaveAttribute('aria-pressed', 'false');
    await page.reload();
    await page.locator('#answer-stats-btn').click();
    await expect(page.locator('#answer-stats-table tbody tr')).toHaveCount(2);
    await expect(page.locator('.answer-stats-chip.adopted')).toHaveCount(0);

    page.once('dialog', dialog => dialog.accept());
    await page.locator('#answer-stats-clear-btn').click();
    await expect(page.locator('#answer-stats-empty')).toBeVisible();
  } finally {
    await extension.close();
  }
});
