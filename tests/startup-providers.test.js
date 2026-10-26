import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { MAX_PANELS } from '../modules/layout-auto-adjust.js';
import {
  getStartupLayout,
  normalizeStartupProviders,
  resolveStartupProviderIds
} from '../modules/startup-providers.js';

const ORDERED = ['chatgpt', 'claude', 'gemini', 'grok', 'deepseek'];

describe('normalizeStartupProviders', () => {
  it('returns null for missing or empty selections', () => {
    expect(normalizeStartupProviders(null)).toBeNull();
    expect(normalizeStartupProviders(undefined)).toBeNull();
    expect(normalizeStartupProviders('chatgpt')).toBeNull();
    expect(normalizeStartupProviders([])).toBeNull();
    expect(normalizeStartupProviders(['', 1])).toBeNull();
  });

  it('removes duplicates and invalid entries', () => {
    expect(normalizeStartupProviders(['claude', 'claude', '', 2, 'grok'])).toEqual(['claude', 'grok']);
  });
});

describe('resolveStartupProviderIds', () => {
  it('opens the first providers that fit the layout when nothing is selected', () => {
    expect(resolveStartupProviderIds(ORDERED, null, 3, 12)).toEqual(['chatgpt', 'claude', 'gemini']);
  });

  it('opens selected providers in provider order, ignoring the layout capacity', () => {
    expect(resolveStartupProviderIds(ORDERED, ['deepseek', 'chatgpt', 'grok', 'claude'], 3, 12))
      .toEqual(['chatgpt', 'claude', 'grok', 'deepseek']);
  });

  it('skips selected providers that are disabled or unauthorized', () => {
    expect(resolveStartupProviderIds(ORDERED, ['qwen', 'gemini'], 3, 12)).toEqual(['gemini']);
  });

  it('falls back to the layout when no selected provider is available', () => {
    expect(resolveStartupProviderIds(ORDERED, ['qwen'], 2, 12)).toEqual(['chatgpt', 'claude']);
  });

  it('caps the selection at the maximum panel count', () => {
    expect(resolveStartupProviderIds(ORDERED, ORDERED, 3, 2)).toEqual(['chatgpt', 'claude']);
  });

  it('opens up to thirty enabled providers on startup', () => {
    const ids = Array.from({ length: 31 }, (_, index) => `provider-${index}`);
    expect(resolveStartupProviderIds(ids, null, 30, MAX_PANELS)).toEqual(ids.slice(0, 30));
    expect(resolveStartupProviderIds(ids, ids, 3, MAX_PANELS)).toEqual(ids.slice(0, 30));
  });
});

describe('getStartupLayout', () => {
  it('keeps a layout that already fits', () => {
    expect(getStartupLayout('2x2', 4)).toBe('2x2');
    expect(getStartupLayout('1x3', 2)).toBe('1x3');
  });

  it('keeps 1xN layouts that grow as panels are added', () => {
    expect(getStartupLayout('1x3', 5)).toBe('1x3');
    expect(getStartupLayout('4x2', 9)).toBe('4x2');
  });

  it('switches other layouts that are too small to a single row', () => {
    expect(getStartupLayout('2x2', 5)).toBe('1x5');
    expect(getStartupLayout('3x1', 4)).toBe('1x4');
    expect(getStartupLayout('2x6', 30)).toBe('1x30');
    expect(getStartupLayout('2x15', 30)).toBe('2x15');
  });
});

describe('startup provider locale strings', () => {
  it('exist in every locale', () => {
    const localesDir = resolve(process.cwd(), '_locales');
    for (const locale of readdirSync(localesDir)) {
      const messages = JSON.parse(readFileSync(resolve(localesDir, locale, 'messages.json'), 'utf8'));
      expect(messages.labelOpenOnStartup?.message, locale).toBeTruthy();
      expect(messages.descStartupProviders?.message, locale).toBeTruthy();
    }
  });
});
