import { test, expect } from '@playwright/test';
import { launchExtension, openMultiPanel } from './extension-harness.js';
import { renderProviderTierFixture } from './fixtures/provider-tier-fixture.js';

test('ChatGPT mode switching changes and verifies a three-stop reasoning slider', async () => {
  const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
  try {
    await extension.context.route('https://chatgpt.com/**', route => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: renderProviderTierFixture('chatgpt', { chatgptControl: 'slider' })
    }));
    const page = await openMultiPanel(extension, { providers: ['chatgpt'], layout: '1x1' });
    const frame = page.frames().find(candidate => candidate.url().startsWith('https://chatgpt.com/'));
    expect(frame).toBeTruthy();
    const slider = page.frameLocator('iframe[src*="chatgpt.com"]').locator('#thinking-strength-slider');

    await expect.poll(() => frame.evaluate(() => window.__fixture.model)).toBe('Medium');
    for (const [tier, label, value] of [
      ['fast', 'Low', '0'],
      ['deep', 'High', '2'],
      ['balanced', 'Medium', '1']
    ]) {
      await page.locator(`.tier-option[data-tier="${tier}"]`).click();
      await expect.poll(() => frame.evaluate(() => window.__fixture.model)).toBe(label);
      await expect(slider).toHaveValue(value);
      await expect(page.locator('#composer-shell')).toHaveAttribute('data-tier-state', 'confirmed');
    }
  } finally {
    await extension.close();
  }
});
