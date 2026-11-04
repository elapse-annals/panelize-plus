import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getSettings,
  getSetting,
  saveSetting,
  saveSettings,
  removeDeprecatedClaudeModelMode,
  resetSettings,
  exportSettings,
  importSettings,
} from '../modules/settings.js';
import { DEFAULT_GOOGLE_PROVIDER_MODE } from '../modules/google-mode.js';
import { DEFAULT_PROVIDER_IDS } from '../modules/provider-defaults.js';

describe('settings module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chrome.storage.sync.get.mockImplementation((keys) => Promise.resolve(typeof keys === 'object' ? keys : {}));
    chrome.storage.sync.set.mockResolvedValue();
    chrome.storage.sync.remove.mockResolvedValue();
    chrome.storage.sync.clear.mockResolvedValue();
    chrome.storage.local.get.mockImplementation((keys) => Promise.resolve(typeof keys === 'object' ? keys : {}));
    chrome.storage.local.set.mockResolvedValue();
    chrome.storage.local.remove.mockResolvedValue();
    chrome.storage.local.clear.mockResolvedValue();
  });

  describe('getSettings', () => {
    it('should return settings from chrome.storage.sync', async () => {
      const mockSettings = {
        enabledProviders: ['chatgpt', 'claude'],
        defaultProvider: 'chatgpt',
        theme: 'dark',
        language: 'en',
      };

      chrome.storage.sync.get.mockResolvedValue(mockSettings);

      const result = await getSettings();

      expect(result).toEqual(mockSettings);
      expect(chrome.storage.sync.get).toHaveBeenCalled();
    });

    it('should fallback to local storage if sync fails', async () => {
      chrome.storage.sync.get.mockRejectedValue(new Error('Sync unavailable'));
      chrome.storage.local.get.mockResolvedValue({ theme: 'light' });

      const result = await getSettings();

      expect(chrome.storage.local.get).toHaveBeenCalled();
    });

    it('defaults to Chinese and normalizes retired language preferences', async () => {
      expect((await getSettings()).language).toBe('zh_CN');
      for (const language of [null, 'zh_TW', 'ja', 'de', 'invalid']) {
        chrome.storage.sync.get.mockResolvedValue({ language, theme: 'dark' });
        expect(await getSettings()).toEqual({ language: 'zh_CN', theme: 'dark' });
      }
    });

    it('should show the watermark on shared images by default', async () => {
      chrome.storage.sync.get.mockImplementation(async (defaults) => defaults);

      const result = await getSettings();

      expect(result.shareWatermarkEnabled).toBe(true);
    });

    it('starts with no AI summary profiles and no active profile', async () => {
      chrome.storage.sync.get.mockImplementation(async (defaults) => defaults);

      const result = await getSettings();

      expect(result.aiSummaryProfiles).toBe(null);
      expect(result.aiSummaryActiveProfileId).toBe('');
    });

    it('should notify when an answer is done by default', async () => {
      chrome.storage.sync.get.mockImplementation(async (defaults) => defaults);

      const result = await getSettings();

      expect(result.answerCompleteNotificationEnabled).toBe(true);
    });

    it('should keep the macOS global input bridge off by default', async () => {
      chrome.storage.sync.get.mockImplementation(async (defaults) => defaults);

      const result = await getSettings();

      expect(result.globalSendBridgeEnabled).toBe(false);
    });

    it('should expose the default Google provider mode', async () => {
      chrome.storage.sync.get.mockImplementation(async (defaults) => defaults);

      const result = await getSettings();

      expect(result.googleProviderMode).toBe(DEFAULT_GOOGLE_PROVIDER_MODE);
      expect(result.enabledProviders).toEqual(DEFAULT_PROVIDER_IDS);
    });

    it('should use Auto prompt mode by default', async () => {
      chrome.storage.sync.get.mockImplementation(async (defaults) => defaults);

      const result = await getSettings();

      expect(result.selectedPromptMode).toBe('auto');
    });

    it('should keep an explicitly saved prompt mode', async () => {
      chrome.storage.sync.get.mockResolvedValue({ selectedPromptMode: 'deep' });

      expect((await getSettings()).selectedPromptMode).toBe('deep');

      chrome.storage.sync.get.mockResolvedValue({ selectedPromptMode: null });
      expect((await getSettings()).selectedPromptMode).toBeNull();
    });
  });

  describe('getSetting', () => {
    it('should return specific setting value', async () => {
      chrome.storage.sync.get.mockResolvedValue({
        theme: 'dark',
        defaultProvider: 'claude',
      });

      const result = await getSetting('theme');

      expect(result).toBe('dark');
    });
  });

  describe('saveSetting', () => {
    it('should save single setting to chrome.storage.sync', async () => {
      await saveSetting('theme', 'dark');

      expect(chrome.storage.sync.set).toHaveBeenCalledWith({ theme: 'dark' });
    });

    it('should fallback to local storage if sync fails', async () => {
      chrome.storage.sync.set.mockRejectedValue(new Error('Sync unavailable'));

      await saveSetting('theme', 'dark');

      expect(chrome.storage.local.set).toHaveBeenCalledWith({ theme: 'dark' });
    });

    it('should save the Google provider mode', async () => {
      await saveSetting('googleProviderMode', 'search');

      expect(chrome.storage.sync.set).toHaveBeenCalledWith({ googleProviderMode: 'search' });
    });
  });

  describe('deprecated settings cleanup', () => {
    it('should remove the retired Claude model mode from sync and local storage', async () => {
      await removeDeprecatedClaudeModelMode();

      expect(chrome.storage.sync.remove).toHaveBeenCalledWith('claudeModelMode');
      expect(chrome.storage.local.remove).toHaveBeenCalledWith('claudeModelMode');
    });

    it('should continue cleaning local storage when sync storage is unavailable', async () => {
      chrome.storage.sync.remove.mockRejectedValue(new Error('Sync unavailable'));

      await expect(removeDeprecatedClaudeModelMode()).resolves.toBeUndefined();

      expect(chrome.storage.local.remove).toHaveBeenCalledWith('claudeModelMode');
    });
  });

  describe('saveSettings', () => {
    it('should save multiple settings', async () => {
      const settings = {
        theme: 'dark',
        enabledProviders: ['chatgpt'],
      };

      await saveSettings(settings);

      expect(chrome.storage.sync.set).toHaveBeenCalledWith(settings);
    });
  });

  describe('resetSettings', () => {
    it('should clear and restore default settings', async () => {
      await resetSettings();

      expect(chrome.storage.sync.clear).toHaveBeenCalled();
      expect(chrome.storage.sync.set).toHaveBeenCalledWith(
        expect.objectContaining({
          enabledProviders: expect.any(Array),
          googleProviderMode: DEFAULT_GOOGLE_PROVIDER_MODE,
          defaultProvider: 'chatgpt',
          theme: 'auto',
        })
      );
    });
  });

  describe('importSettings', () => {
    it('normalizes an imported retired language while preserving other preferences', async () => {
      await importSettings({ language: 'ja', theme: 'dark' });
      expect(chrome.storage.sync.set).toHaveBeenCalledWith({ language: 'zh_CN', theme: 'dark' });
    });

    it('should import valid settings', async () => {
      const settings = {
        theme: 'dark',
        enabledProviders: ['chatgpt', 'claude'],
      };

      const result = await importSettings(settings);

      expect(result.success).toBe(true);
      expect(result.imported).toEqual(['theme', 'enabledProviders']);
      expect(result.skipped).toEqual([]);
    });

    it('should import the share watermark preference', async () => {
      const result = await importSettings({ shareWatermarkEnabled: false });

      expect(result.imported).toEqual(['shareWatermarkEnabled']);
      expect(chrome.storage.sync.set).toHaveBeenCalledWith({ shareWatermarkEnabled: false });
    });

    it('should skip invalid setting keys', async () => {
      const settings = {
        theme: 'dark',
        invalidKey: 'value',
      };

      const result = await importSettings(settings);

      expect(result.imported).toEqual(['theme']);
      expect(result.skipped).toEqual(['invalidKey']);
      expect(result.errors).toHaveProperty('invalidKey');
    });

    it('maps a legacy AI summary configuration to one default profile', async () => {
      const result = await importSettings({
        aiSummaryBaseUrl: 'https://legacy.test/v1',
        aiSummaryModel: 'legacy-model',
      });

      expect(chrome.storage.sync.set).toHaveBeenCalledWith({
        aiSummaryBaseUrl: 'https://legacy.test/v1',
        aiSummaryModel: 'legacy-model',
        aiSummaryProfiles: [{
          id: 'default',
          name: '',
          baseUrl: 'https://legacy.test/v1',
          model: 'legacy-model'
        }],
        aiSummaryActiveProfileId: 'default'
      });
      expect(result.imported).toEqual(expect.arrayContaining([
        'aiSummaryProfiles',
        'aiSummaryActiveProfileId'
      ]));
    });

    it('keeps the profile list supplied by a current backup', async () => {
      const profiles = [{ id: 'p1', name: '', baseUrl: 'https://one.test/v1', model: 'm1' }];
      await importSettings({
        aiSummaryProfiles: profiles,
        aiSummaryActiveProfileId: 'p1',
        aiSummaryBaseUrl: 'https://legacy.test/v1',
        aiSummaryModel: 'legacy-model'
      });

      expect(chrome.storage.sync.set).toHaveBeenCalledWith({
        aiSummaryProfiles: profiles,
        aiSummaryActiveProfileId: 'p1',
        aiSummaryBaseUrl: 'https://legacy.test/v1',
        aiSummaryModel: 'legacy-model'
      });
    });
  });

  describe('exportSettings', () => {
    it('should export current settings', async () => {
      const mockSettings = {
        theme: 'dark',
        enabledProviders: ['chatgpt'],
      };

      chrome.storage.sync.get.mockResolvedValue(mockSettings);

      const result = await exportSettings();

      expect(result).toEqual({ ...mockSettings, language: 'zh_CN' });
    });
  });
});
