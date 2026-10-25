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

test('Answer stats time each answer, record the adopted one and score engagement', async ({}, testInfo) => {
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
    const rejectButtons = page.locator('.reject-answer-btn');
    await expect(adoptButtons).toHaveCount(2);
    await expect(rejectButtons).toHaveCount(2);
    await expect(adoptButtons.nth(0)).toBeDisabled();
    await expect(rejectButtons.nth(0)).toBeDisabled();
    await expect.poll(() => Boolean(findFrame(page, 'https://chat.deepseek.com/'))).toBe(true);

    await page.locator('#unified-input').fill('Which answer is best?');
    await page.locator('#send-all-btn').click();
    await expect(adoptButtons.nth(0)).toBeEnabled();
    await expect(rejectButtons.nth(0)).toBeEnabled();

    await appendAnswer(page, 'https://chatgpt.com/', '<div data-message-author-role="assistant">ChatGPT answer</div>');
    await appendAnswer(page, 'https://chat.deepseek.com/', '<div class="ds-markdown">DeepSeek answer</div>');

    // Rejection and adoption are mutually exclusive for the same answer,
    // while each remains independently toggleable.
    await rejectButtons.nth(0).click();
    await expect(rejectButtons.nth(0)).toHaveAttribute('aria-pressed', 'true');
    await page.screenshot({ path: testInfo.outputPath('answer-rejection-selected.png') });
    await rejectButtons.nth(0).click();
    await expect(rejectButtons.nth(0)).toHaveAttribute('aria-pressed', 'false');
    await adoptButtons.nth(0).click();
    await expect(adoptButtons.nth(0)).toHaveAttribute('aria-pressed', 'true');
    await expect(rejectButtons.nth(0)).toHaveAttribute('aria-pressed', 'false');
    await rejectButtons.nth(0).click();
    await expect(rejectButtons.nth(0)).toHaveAttribute('aria-pressed', 'true');
    await expect(adoptButtons.nth(0)).toHaveAttribute('aria-pressed', 'false');
    await adoptButtons.nth(1).click();
    await expect(adoptButtons.nth(1)).toHaveAttribute('aria-pressed', 'true');

    // Clicking in the ChatGPT panel and enlarging it count towards its score.
    await findFrame(page, 'https://chatgpt.com/').locator('body').click({ position: { x: 5, y: 5 } });
    const chatgptFocusButton = page.locator('.focus-panel-btn').nth(0);
    await chatgptFocusButton.click();
    await expect(chatgptFocusButton).toHaveAttribute('aria-pressed', 'true');
    await chatgptFocusButton.click();
    await expect(chatgptFocusButton).toHaveAttribute('aria-pressed', 'false');

    await page.locator('#answer-stats-btn').click();
    const rows = page.locator('#answer-stats-table tbody tr');
    await expect(rows).toHaveCount(2);
    const deepseekRow = rows.filter({ hasText: 'DeepSeek' });
    const chatgptRow = rows.filter({ hasText: 'ChatGPT' });
    await expect(deepseekRow.locator('td').nth(5)).toHaveText('1');
    await expect(deepseekRow.locator('td').nth(6)).toHaveText('100%');
    await expect(chatgptRow.locator('td').nth(6)).toHaveText('0%');
    await expect(deepseekRow.locator('td').nth(8)).toHaveText('5');
    await expect(chatgptRow.locator('td').nth(8)).toHaveText('-3');
    await expect(chatgptRow.locator('td').nth(7)).not.toHaveText('—');

    // Both answers finish once their text settles (DeepSeek waits 5s).
    await expect(chatgptRow.locator('td').nth(3)).not.toHaveText('—', { timeout: 15000 });
    await expect(deepseekRow.locator('td').nth(3)).not.toHaveText('—', { timeout: 15000 });
    await expect(deepseekRow.locator('td').nth(2)).toHaveText(/\d+(\.\d)? m?s \(/);
    await expect(page.locator('#answer-stats-recent li')).toHaveCount(1);
    await expect(page.locator('.answer-stats-recent-prompt')).toHaveText('Which answer is best?');
    await expect(page.locator('.answer-stats-chip.adopted')).toContainText('DeepSeek');
    await expect(page.locator('.answer-stats-chip.rejected')).toContainText('ChatGPT');
    await page.screenshot({ path: testInfo.outputPath('answer-stats.png') });

    // Stats and the rejection survive a reload.
    await page.locator('#close-answer-stats-modal').click();
    await adoptButtons.nth(1).click();
    await expect(adoptButtons.nth(1)).toHaveAttribute('aria-pressed', 'false');
    await page.reload();
    await page.locator('#answer-stats-btn').click();
    await expect(page.locator('#answer-stats-table tbody tr')).toHaveCount(2);
    const persistedChatgptRow = page.locator('#answer-stats-table tbody tr').filter({ hasText: 'ChatGPT' });
    await expect(persistedChatgptRow.locator('td').nth(8)).toHaveText('-3');
    await expect(page.locator('.answer-stats-chip.rejected')).toContainText('ChatGPT');

    // A new round starts with fresh, unselected feedback controls.
    await page.locator('#close-answer-stats-modal').click();
    await expect(rejectButtons.nth(0)).toBeDisabled();
    await page.locator('#unified-input').fill('A new question');
    await page.locator('#send-all-btn').click();
    await expect(rejectButtons.nth(0)).toBeEnabled();
    await expect(rejectButtons.nth(0)).toHaveAttribute('aria-pressed', 'false');
    await expect(adoptButtons.nth(0)).toHaveAttribute('aria-pressed', 'false');

    const firstPanel = page.locator('#panel-grid .panel-item').nth(0);
    await firstPanel.locator('.switch-provider-btn').click();
    await page.locator('.provider-switcher-item[data-provider-id="deepseek"]').click();
    await expect(firstPanel.locator('.panel-header-left .provider-name')).toHaveText('DeepSeek');
    await expect(firstPanel.locator('.adopt-answer-btn')).toBeDisabled();
    await expect(firstPanel.locator('.reject-answer-btn')).toBeDisabled();

    await firstPanel.locator('.switch-provider-btn').click();
    await page.locator('.provider-switcher-item[data-provider-id="chatgpt"]').click();
    await expect(firstPanel.locator('.panel-header-left .provider-name')).toHaveText('ChatGPT');
    await expect(firstPanel.locator('.adopt-answer-btn')).toBeDisabled();
    await expect(firstPanel.locator('.reject-answer-btn')).toBeDisabled();

    await page.locator('#unified-input').fill('A question after switching providers');
    await page.locator('#send-all-btn').click();
    await expect(firstPanel.locator('.reject-answer-btn')).toBeEnabled();
    await expect(firstPanel.locator('.adopt-answer-btn')).toBeEnabled();

    await page.locator('#answer-stats-btn').click();
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#answer-stats-clear-btn').click();
    await expect(page.locator('#answer-stats-empty')).toBeVisible();
  } finally {
    await extension.close();
  }
});
