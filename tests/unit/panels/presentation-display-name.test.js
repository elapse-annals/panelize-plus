import { describe, expect, it } from 'vitest';
import { createPresentationController } from '../../../multi-panel/controllers/presentation.js';
import { getProviderById } from '../../../modules/providers/providers.js';

const MODE_TITLES = { concise: 'Concise', deep: 'Deep thinking' };

function createController(panels, { blind = false } = {}) {
  const controller = createPresentationController({
    getAnswersController: () => ({}),
    getComposerController: () => ({
      composerControls: {
        getPromptModeTitle: modeKey => MODE_TITLES[modeKey] || null
      }
    }),
    getLayoutController: () => ({}),
    getPanelsController: () => ({ panels }),
    getSendingController: () => ({}),
    getSharingController: () => ({}),
    getSummaryController: () => ({})
  });
  controller.isBlindModeEnabled = blind;
  return controller;
}

describe('panel display names', () => {
  const panels = () => [
    { id: 'p1', providerId: 'chatgpt', promptMode: 'inherit' },
    { id: 'p2', providerId: 'chatgpt', promptMode: 'concise' },
    { id: 'p3', providerId: 'claude', promptMode: 'inherit' },
    { id: 'p4', providerId: 'chatgpt', promptMode: 'deep' }
  ];

  it('keeps a single inherit panel plain and numbers duplicate inherit panels', () => {
    const controller = createController(panels());
    expect(controller.getPanelDisplayName(panels()[2])).toBe(getProviderById('claude').name);
    expect(controller.getPanelDisplayName(panels()[0])).toBe('ChatGPT #1');
  });

  it('names a fixed mode after the panel and uses short names for chips', () => {
    const controller = createController(panels());
    expect(controller.getPanelDisplayName(panels()[1])).toBe('ChatGPT · Concise');
    expect(controller.getPanelDisplayName(panels()[3])).toBe('ChatGPT · Deep thinking');
    expect(controller.getPanelDisplayName(panels()[1], { short: true })).toBe('GPT · Concise');
    expect(controller.getPanelDisplayName(panels()[0], { short: true })).toBe('GPT #1');
  });

  it('falls back to provider numbering for a mode missing from the library', () => {
    const missing = panels();
    missing[1].promptMode = 'deleted-mode';
    const controller = createController(missing);
    expect(controller.getPanelDisplayName(missing[1])).toBe('ChatGPT #2');
  });

  it('anonymizes names in blind mode, numbering by display order', () => {
    const controller = createController(panels(), { blind: true });
    expect(controller.getPanelDisplayName(panels()[1])).toBe('Anonymous model 2');
    expect(controller.getPanelDisplayName(panels()[1], { short: true })).toBe('Anonymous model 2');
  });
});