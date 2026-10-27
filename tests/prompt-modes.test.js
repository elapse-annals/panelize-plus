import { describe, expect, it } from 'vitest';
import { PROMPT_MODES, PROMPT_MODE_IDS, applyPromptMode, getPromptMode, getPromptModeSuffix, isPromptMode } from '../modules/prompt-modes.js';

// Mirrors getLocalizedText: a missing locale string falls back to English.
const translate = (key, fallback) => fallback;

describe('prompt modes', () => {
  it('lists the selectable modes in menu order', () => {
    expect(PROMPT_MODE_IDS).toEqual(['learning', 'concise', 'brainstorm', 'compete']);
  });

  it('recognises only the shipped modes', () => {
    PROMPT_MODE_IDS.forEach(mode => expect(isPromptMode(mode)).toBe(true));
    [null, undefined, '', 'verbose', 'Learning', 0].forEach(value => expect(isPromptMode(value)).toBe(false));
  });

  it.each([null, undefined, '', 'verbose'])('leaves the question alone for %s', (mode) => {
    expect(applyPromptMode('Explain closures', mode, translate)).toBe('Explain closures');
  });

  it.each(['', '   ', '\n\n'])('adds nothing to empty text (%j)', (text) => {
    expect(applyPromptMode(text, 'concise', translate)).toBe(text);
  });

  it.each(PROMPT_MODE_IDS)('appends the %s instruction after a blank line', (mode) => {
    const result = applyPromptMode('Explain closures', mode, translate);

    expect(result.startsWith('Explain closures\n\n')).toBe(true);
    expect(result.length).toBeGreaterThan('Explain closures\n\n'.length);
    expect(result.match(/\n\n/g)).toHaveLength(1);
  });

  it('uses the locale string for the appended instruction', () => {
    const tr = (key, fallback) => (key === 'promptModeSuffix_compete' ? '比较一下。' : fallback);

    expect(applyPromptMode('问题', 'compete', tr)).toBe('问题\n\n比较一下。');
  });

  it('asks the translation helper for the mode-specific key', () => {
    const requested = [];
    applyPromptMode('Question', 'brainstorm', (key, fallback) => {
      requested.push(key);
      return fallback;
    });

    expect(requested).toEqual(['promptModeSuffix_brainstorm']);
  });

  it('falls back to the English instruction when the locale string is missing', () => {
    const fallback = applyPromptMode('Question', 'learning', (key, english) => english);

    expect(applyPromptMode('Question', 'learning')).toBe(fallback);
    expect(applyPromptMode('Question', 'learning', () => '')).toBe(fallback);
    expect(fallback).toContain('Answer as a teacher');
  });

  it('keeps the user text verbatim, including its own line breaks', () => {
    const text = 'Line one\n\nLine two';
    const result = applyPromptMode(text, 'concise', translate);

    expect(result.startsWith(`${text}\n\n`)).toBe(true);
  });

  it('gives every mode a label and hint with locale keys', () => {
    expect(PROMPT_MODES.map(mode => mode.id)).toEqual(PROMPT_MODE_IDS);
    PROMPT_MODES.forEach(mode => {
      expect(getPromptMode(mode.id)).toBe(mode);
      expect(mode.labelKey).toMatch(/^promptMode[A-Z]/);
      expect(mode.hintKey).toBe(`${mode.labelKey}Hint`);
      expect(mode.label && mode.hint).toBeTruthy();
    });
    expect(getPromptMode('verbose')).toBeNull();
  });

  it('returns the bare instruction for sends without text', () => {
    expect(getPromptModeSuffix('concise', translate)).toBe(applyPromptMode('Q', 'concise', translate).slice('Q\n\n'.length));
    expect(getPromptModeSuffix(null, translate)).toBe('');
    expect(getPromptModeSuffix('verbose', translate)).toBe('');
  });
});
