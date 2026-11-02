import { describe, expect, it } from 'vitest';
import {
  GLOBAL_SEND_MAX_TEXT_LENGTH,
  GLOBAL_SEND_PROMPT_MODES,
  createNativeSendResult,
  isTrustedGlobalSendResultSender,
  normalizeGlobalPrompt,
  normalizeGlobalPromptMode,
  readGlobalSendResultPayload
} from '../modules/global-send.js';

describe('normalizeGlobalPrompt', () => {
  it('trims, normalizes line endings and keeps the prompt text', () => {
    expect(normalizeGlobalPrompt('  First line\r\nSecond line  ')).toEqual({
      ok: true,
      text: 'First line\nSecond line'
    });
  });

  it('rejects missing, empty and overlong text', () => {
    expect(normalizeGlobalPrompt(null).error.code).toBe('invalid-text');
    expect(normalizeGlobalPrompt('  \n ').error.code).toBe('empty-text');
    expect(normalizeGlobalPrompt('x'.repeat(GLOBAL_SEND_MAX_TEXT_LENGTH + 1)).error.code)
      .toBe('text-too-long');
  });

  it('counts Unicode code points rather than UTF-16 units', () => {
    expect(normalizeGlobalPrompt('😀'.repeat(GLOBAL_SEND_MAX_TEXT_LENGTH)).ok).toBe(true);
  });
});

describe('normalizeGlobalPromptMode', () => {
  it('accepts only the built-in modes, Auto and Default', () => {
    expect([...GLOBAL_SEND_PROMPT_MODES]).toEqual([
      'default', 'auto', 'concise', 'learning', 'compete', 'brainstorm', 'deep'
    ]);
    GLOBAL_SEND_PROMPT_MODES.forEach(mode =>
      expect(normalizeGlobalPromptMode(mode)).toBe(mode));
  });

  it('drops missing, malformed and custom values', () => {
    [undefined, null, '', 'Default', 'custom-mode', 0, {}, []].forEach(value =>
      expect(normalizeGlobalPromptMode(value)).toBeUndefined());
  });
});

describe('native send results', () => {
  it('builds bounded, serializable result fields', () => {
    expect(createNativeSendResult('request-1', {
      ok: true,
      sent: 4.8,
      total: 5,
      reason: ''
    })).toEqual({
      protocol: 1,
      type: 'sendResult',
      requestId: 'request-1',
      ok: true,
      sent: 4,
      total: 5,
      reason: ''
    });
    expect(createNativeSendResult('request-1', { reason: 'x'.repeat(200) }).reason)
      .toHaveLength(120);
  });

  it('only accepts result fields from a valid page payload', () => {
    expect(readGlobalSendResultPayload({
      requestId: 'abc',
      ok: true,
      sent: 2,
      total: 3,
      reason: 'partial',
      ignored: 'value'
    })).toEqual({ requestId: 'abc', ok: true, sent: 2, total: 3, reason: 'partial' });
    expect(readGlobalSendResultPayload({ ok: true })).toBeNull();
  });
});

describe('isTrustedGlobalSendResultSender', () => {
  const runtime = {
    id: 'extension-id',
    getURL: path => `chrome-extension://extension-id/${path}`
  };

  it('accepts only the top-level Multi-Panel extension page', () => {
    expect(isTrustedGlobalSendResultSender({
      id: 'extension-id',
      frameId: 0,
      url: 'chrome-extension://extension-id/multi-panel/multi-panel.html'
    }, runtime)).toBe(true);
    expect(isTrustedGlobalSendResultSender({
      id: 'extension-id',
      frameId: 1,
      url: 'chrome-extension://extension-id/multi-panel/multi-panel.html'
    }, runtime)).toBe(false);
    expect(isTrustedGlobalSendResultSender({
      id: 'extension-id',
      frameId: 0,
      url: 'https://chatgpt.com/'
    }, runtime)).toBe(false);
  });
});