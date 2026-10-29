import { test, expect } from '@playwright/test';
import { launchExtension } from './extension-harness.js';

test('Chinese is the default and English stays selected after reload; retired languages use Chinese', async () => {
  const extension = await launchExtension({ args: ['--lang=en-US'] });
  try {
    await extension.context.route('https://**/*', route => route.abort());
    const page = await extension.context.newPage();
    await page.goto(extension.extensionUrl('options/options.html'));
    const language = page.locator('#language-select');
    const label = page.locator('[data-i18n="labelLanguage"]');
    await expect(language).toHaveValue('zh_CN');
    await expect(label).toHaveText('语言');
    expect(await language.locator('option').evaluateAll(options => options.map(option => option.value)))
      .toEqual(['zh_CN', 'en']);
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');

    await language.selectOption('en');
    await expect(label).toHaveText('Language');
    await page.reload();
    await expect(language).toHaveValue('en');
    await expect(label).toHaveText('Language');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    const englishGuideEvent = page.waitForEvent('popup');
    await page.locator('#open-custom-prompt-guide').click();
    const englishGuide = await englishGuideEvent;
    await expect(englishGuide).toHaveURL(extension.extensionUrl('data/prompt-libraries/guide.en.html'));
    await englishGuide.close();

    await extension.serviceWorker.evaluate(() => chrome.storage.sync.set({ language: 'ja' }));
    await page.reload();
    await expect(language).toHaveValue('zh_CN');
    await expect(label).toHaveText('语言');
    const chineseGuideEvent = page.waitForEvent('popup');
    await page.locator('#open-custom-prompt-guide').click();
    const chineseGuide = await chineseGuideEvent;
    await expect(chineseGuide).toHaveURL(extension.extensionUrl('data/prompt-libraries/guide.zh_CN.html'));
  } finally {
    await extension.close();
  }
});
