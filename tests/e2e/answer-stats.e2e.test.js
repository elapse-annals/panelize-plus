import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
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
    await expect(deepseekRow.locator('td').nth(10)).toHaveText('5');
    await expect(chatgptRow.locator('td').nth(10)).toHaveText('-3');
    await expect(chatgptRow.locator('td').nth(7)).not.toHaveText('—');
    const category = page.locator('#answer-stats-category');
    await expect(category.locator('option')).toHaveCount(6);
    await category.selectOption('translation');
    await expect(rows).toHaveCount(0);
    await expect(category).toBeVisible();
    await category.selectOption('qa');
    await expect(rows).toHaveCount(2);
    await category.selectOption('');

    // Both answers finish once their text settles (DeepSeek waits 5s).
    await expect(chatgptRow.locator('td').nth(3)).not.toHaveText('—', { timeout: 15000 });
    await expect(deepseekRow.locator('td').nth(3)).not.toHaveText('—', { timeout: 15000 });
    await expect(deepseekRow.locator('td').nth(2)).toHaveText(/\d+(\.\d)? m?s \(/);
    await expect(page.locator('.answer-stats-notes')).not.toHaveAttribute('open', '');
    await page.screenshot({ path: testInfo.outputPath('answer-stats.png') });
    await page.locator('#close-answer-stats-modal').click();

    // The answer log lists the question with each panel's answer and filters it.
    await page.locator('#answer-log-btn').click();
    await expect(page.locator('#answer-log-list .answer-log-item')).toHaveCount(1);
    await expect(page.locator('.answer-log-prompt')).toHaveText('Which answer is best?');
    await expect(page.locator('.answer-log-chip.adopted')).toContainText('DeepSeek');
    await expect(page.locator('.answer-log-chip.rejected')).toContainText('ChatGPT');
    await page.locator('#answer-log-search').fill('no such question');
    await expect(page.locator('#answer-log-list .answer-log-item')).toHaveCount(0);
    await expect(page.locator('#answer-log-no-matches')).toBeVisible();
    await page.locator('#answer-log-search').fill('ANSWER is');
    await expect(page.locator('#answer-log-list .answer-log-item')).toHaveCount(1);
    await page.locator('#answer-log-feedback').selectOption('none');
    await expect(page.locator('#answer-log-count')).toHaveText('0');
    await page.locator('#answer-log-feedback').selectOption('all');
    await page.locator('#answer-log-provider').selectOption('deepseek');
    await expect(page.locator('#answer-log-list .answer-log-item')).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath('answer-log.png') });
    await page.locator('#close-answer-log-modal').click();

    // Stats and the rejection survive a reload.
    await adoptButtons.nth(1).click();
    await expect(adoptButtons.nth(1)).toHaveAttribute('aria-pressed', 'false');
    await page.reload();
    await page.locator('#answer-stats-btn').click();
    await expect(page.locator('#answer-stats-table tbody tr')).toHaveCount(2);
    const persistedChatgptRow = page.locator('#answer-stats-table tbody tr').filter({ hasText: 'ChatGPT' });
    await expect(persistedChatgptRow.locator('td').nth(10)).toHaveText('-3');
    await page.locator('#close-answer-stats-modal').click();
    await page.locator('#answer-log-btn').click();
    await expect(page.locator('.answer-log-chip.rejected')).toContainText('ChatGPT');
    await page.locator('#close-answer-log-modal').click();

    // A new round starts with fresh, unselected feedback controls.
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

test('task category filters, best models and exports include legacy and newly sent rounds', async ({}, testInfo) => {
  test.setTimeout(60000);
  const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
  try {
    await extension.context.route('https://chatgpt.com/**', route => route.fulfill({
      contentType: 'text/html', body: renderChatgptFixture({ composer: 'current' })
    }));
    await extension.context.route('https://chat.deepseek.com/**', route => route.fulfill({
      contentType: 'text/html', body: DEEPSEEK_FIXTURE
    }));
    await extension.serviceWorker.evaluate(() => chrome.storage.sync.set({ language: 'en', selectedPromptMode: 'auto' }));
    const page = await openMultiPanel(extension, { providers: ['chatgpt', 'deepseek'], layout: '1x2' });
    await page.evaluate(async () => {
      const { createRound, applyTimingEvent, toggleRoundAdoption, saveAnswerRound } = await import('../modules/answer-stats.js');
      const now = Date.now();
      for (let i = 0; i < 5; i++) {
        const coding = i < 3;
        let round = createRound({
          id: `seed-${i}`, createdAt: now - (i + 1) * 1000,
          text: coding ? 'Fix this function' : 'Translate this into English',
          panels: [{ id: 'p1', providerId: 'chatgpt' }, { id: 'p2', providerId: 'deepseek' }]
        });
        round = applyTimingEvent(round, 'p1', 'complete', round.createdAt + 8000);
        round = applyTimingEvent(round, 'p2', 'complete', round.createdAt + 18000);
        round = toggleRoundAdoption(round, coding ? 'p2' : 'p1');
        if (i === 0) delete round.category; // A record from before categories existed.
        await saveAnswerRound(round);
      }
    });
    await page.locator('#answer-stats-btn').click();
    const rows = page.locator('#answer-stats-table tbody tr');
    const category = page.locator('#answer-stats-category');
    await expect(page.locator('#answer-stats-best .answer-stats-best-chip')).toHaveText([
      'Coding: DeepSeek · adoption 100% · median 18.0 s'
    ]);
    await category.selectOption('coding');
    await expect(rows.locator('td:nth-child(2)')).toHaveText(['3', '3']);
    await category.selectOption('translation');
    await expect(rows.locator('td:nth-child(2)')).toHaveText(['2', '2']);
    await category.selectOption('writing');
    await expect(rows).toHaveCount(0);
    await expect(category).toBeVisible();
    // The overview still compares every category when the table is filtered.
    await expect(page.locator('#answer-stats-best .answer-stats-best-chip')).toHaveCount(1);
    await category.selectOption('coding');
    await page.screenshot({ path: testInfo.outputPath('answer-stats-categories-light.png') });
    await page.locator('html').evaluate(html => html.setAttribute('data-theme', 'dark'));
    await page.screenshot({ path: testInfo.outputPath('answer-stats-categories-dark.png') });
    await page.locator('#close-answer-stats-modal').click();

    // Classification uses the question after an Auto trigger is removed.
    await page.locator('#unified-input').fill('/brief Translate this code into English: function greet() {}');
    await page.locator('#fill-input-btn').click();
    await page.locator('#send-all-btn').click();
    await expect(page.locator('.adopt-answer-btn').first()).toBeEnabled();
    await page.locator('.adopt-answer-btn').first().click();
    await page.locator('#answer-log-btn').click();
    await expect(page.locator('#answer-log-list .answer-log-item').first().locator('.answer-log-prompt'))
      .toHaveText('Translate this code into English: function greet() {}');
    await expect(page.locator('#answer-log-list .answer-log-item').first().locator('.answer-log-category'))
      .toHaveText('Translation');
    await page.locator('#close-answer-log-modal').click();
    await page.locator('#answer-stats-btn').click();
    await expect(page.locator('#answer-stats-best .answer-stats-best-chip')).toHaveText([
      'Coding: DeepSeek · adoption 100% · median 18.0 s',
      'Translation: ChatGPT · adoption 100% · median 8.0 s'
    ]);
    const downloadEvent = page.waitForEvent('download');
    await page.locator('#answer-stats-export-btn').click();
    const download = await downloadEvent;
    const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
    expect(exported.rounds).toHaveLength(6);
    expect(exported.rounds.every(round => ['coding', 'translation'].includes(round.category))).toBe(true);
    expect(exported.rounds.find(round => round.id === 'seed-0').category).toBe('coding');
    const legacyUnchanged = await page.evaluate(async () => {
      const { getAllAnswerRounds } = await import('../modules/answer-stats.js');
      return !(await getAllAnswerRounds()).find(round => round.id === 'seed-0').category;
    });
    expect(legacyUnchanged).toBe(true);
  } finally {
    await extension.close();
  }
});
