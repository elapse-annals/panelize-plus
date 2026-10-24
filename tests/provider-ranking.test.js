import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getAllAnswerRoundsMock } = vi.hoisted(() => ({
  getAllAnswerRoundsMock: vi.fn()
}));

vi.mock('../modules/answer-stats.js', async (importOriginal) => ({
  ...await importOriginal(),
  getAllAnswerRounds: getAllAnswerRoundsMock
}));

import { createRound, toggleRoundAdoption } from '../modules/answer-stats.js';
import { getEnabledProviders } from '../modules/providers.js';
import {
  getFrequentProviderOrder,
  normalizeProviderSortMode,
  rankProviderIds
} from '../modules/provider-ranking.js';

describe('provider ranking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAllAnswerRoundsMock.mockResolvedValue([]);
  });

  afterEach(() => {
    delete chrome.permissions;
  });

  it('orders by score, adopted count and rounds, then keeps manual order for ties', () => {
    expect(rankProviderIds(
      ['chatgpt', 'claude', 'gemini', 'grok'],
      ['grok', 'gemini', 'claude', 'chatgpt'],
      [
        { providerId: 'chatgpt', score: 5, adoptedCount: 1, rounds: 4 },
        { providerId: 'claude', score: 5, adoptedCount: 2, rounds: 1 },
        { providerId: 'gemini', score: 5, adoptedCount: 2, rounds: 3 },
        { providerId: 'grok', score: 8, adoptedCount: 0, rounds: 1 }
      ]
    )).toEqual(['grok', 'gemini', 'claude', 'chatgpt']);

    expect(rankProviderIds(
      ['chatgpt', 'claude', 'gemini'],
      ['gemini', 'chatgpt', 'claude'],
      []
    )).toEqual(['gemini', 'chatgpt', 'claude']);
  });

  it('normalizes invalid sort modes to manual', () => {
    expect(normalizeProviderSortMode('frequent')).toBe('frequent');
    expect(normalizeProviderSortMode('unexpected')).toBe('manual');
    expect(normalizeProviderSortMode(undefined)).toBe('manual');
  });

  it('reads answer history for frequent order and falls back to manual order when storage fails', async () => {
    const rounds = [
      {
        id: 'r1',
        adoptedProviderId: 'claude',
        answers: {
          a: { providerId: 'chatgpt', status: null },
          b: { providerId: 'claude', status: null },
          c: { providerId: 'gemini', status: null }
        }
      }
    ];
    getAllAnswerRoundsMock.mockResolvedValueOnce(rounds);

    await expect(getFrequentProviderOrder(
      ['chatgpt', 'claude', 'gemini'],
      ['gemini', 'chatgpt', 'claude']
    )).resolves.toEqual(['claude', 'gemini', 'chatgpt']);
    expect(getAllAnswerRoundsMock).toHaveBeenCalledOnce();

    getAllAnswerRoundsMock.mockRejectedValueOnce(new Error('IDB unavailable'));
    await expect(getFrequentProviderOrder(
      ['chatgpt', 'claude', 'gemini'],
      ['gemini', 'chatgpt', 'claude']
    )).resolves.toEqual(['gemini', 'chatgpt', 'claude']);
  });

  it('returns enabled providers in frequent order from local answer statistics', async () => {
    let round = createRound({
      id: 'r1',
      createdAt: 100,
      text: 'prompt',
      panels: [
        { id: 'chatgpt-panel', providerId: 'chatgpt' },
        { id: 'claude-panel', providerId: 'claude' },
        { id: 'gemini-panel', providerId: 'gemini' }
      ]
    });
    round = toggleRoundAdoption(round, 'claude-panel');
    getAllAnswerRoundsMock.mockResolvedValue([round]);
    chrome.storage.sync.get.mockResolvedValue({
      enabledProviders: ['chatgpt', 'claude', 'gemini'],
      providerOrder: ['gemini', 'chatgpt', 'claude'],
      providerSortMode: 'frequent'
    });

    const providers = await getEnabledProviders();

    expect(providers.map(({ id }) => id)).toEqual(['claude', 'gemini', 'chatgpt']);
    expect(getAllAnswerRoundsMock).toHaveBeenCalledOnce();
  });

  it('keeps manual order without reading statistics in manual mode', async () => {
    chrome.storage.sync.get.mockResolvedValue({
      enabledProviders: ['chatgpt', 'claude', 'gemini'],
      providerOrder: ['gemini', 'chatgpt', 'claude'],
      providerSortMode: 'manual'
    });

    const providers = await getEnabledProviders();

    expect(providers.map(({ id }) => id)).toEqual(['gemini', 'chatgpt', 'claude']);
    expect(getAllAnswerRoundsMock).not.toHaveBeenCalled();
  });

  it.each([null, []])('uses the stored enabledProviders order when providerOrder is %s', async (providerOrder) => {
    chrome.storage.sync.get.mockResolvedValue({
      enabledProviders: ['gemini', 'chatgpt', 'claude'],
      providerOrder,
      providerSortMode: 'manual'
    });

    const providers = await getEnabledProviders();

    expect(providers.map(({ id }) => id)).toEqual(['gemini', 'chatgpt', 'claude']);
    expect(getAllAnswerRoundsMock).not.toHaveBeenCalled();
  });

  it('still filters inaccessible providers before applying frequent order', async () => {
    chrome.permissions = {
      contains: vi.fn().mockResolvedValue(false)
    };
    getAllAnswerRoundsMock.mockResolvedValue([{
      id: 'r1',
      adoptedProviderId: 'qwen-cn',
      answers: {
        qwen: { providerId: 'qwen-cn', status: null },
        chatgpt: { providerId: 'chatgpt', status: null }
      }
    }]);
    chrome.storage.sync.get.mockResolvedValue({
      enabledProviders: ['chatgpt', 'qwen-cn'],
      providerOrder: ['chatgpt', 'qwen-cn'],
      providerSortMode: 'frequent'
    });

    const providers = await getEnabledProviders();

    expect(providers.map(({ id }) => id)).toEqual(['chatgpt']);
    expect(chrome.permissions.contains).toHaveBeenCalledOnce();
  });
});
