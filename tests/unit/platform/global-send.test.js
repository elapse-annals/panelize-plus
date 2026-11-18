import { describe, expect, it } from 'vitest';
import {
  GLOBAL_SEND_MAX_TEXT_LENGTH,
  GLOBAL_SEND_PROMPT_MODES,
  NATIVE_APP_BUNDLE_ID_MAX_LENGTH,
  NATIVE_CAPABILITIES,
  NATIVE_CLIENT_VERSION_MAX_LENGTH,
  createNativeHello,
  createNativeSendProgress,
  createNativeSendResult,
  isTrustedGlobalSendResultSender,
  normalizeGlobalPrompt,
  normalizeGlobalPromptMode,
  readClientHello,
  readGlobalSendProgressPayload,
  readGlobalSendResultPayload
} from '../../../modules/platform/global-send.js';

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
      protocol: 2,
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

describe('native send progress', () => {
  it('builds the progress event forwarded to the desktop app', () => {
    expect(createNativeSendProgress({
      requestId: 'request-1',
      stage: 'preparing',
      ready: 3,
      total: 5,
      pendingCount: 2,
      timedOutCount: 0,
      pendingNames: ['Claude', 'Gemini'],
      timedOutNames: [],
      blind: false
    })).toEqual({
      protocol: 2,
      type: 'sendProgress',
      requestId: 'request-1',
      stage: 'preparing',
      ready: 3,
      total: 5,
      pendingCount: 2,
      timedOutCount: 0,
      pendingNames: ['Claude', 'Gemini'],
      timedOutNames: [],
      blind: false
    });
  });

  it('accepts only known stages and a valid request ID', () => {
    const base = { requestId: 'r1', total: 2, ready: 1 };
    expect(readGlobalSendProgressPayload({ ...base, stage: 'opening' })?.stage).toBe('opening');
    expect(readGlobalSendProgressPayload({ ...base, stage: 'preparing' })?.stage).toBe('preparing');
    expect(readGlobalSendProgressPayload({ ...base, stage: 'sending' })?.stage).toBe('sending');
    expect(readGlobalSendProgressPayload({ ...base, stage: 'done' })).toBeNull();
    expect(readGlobalSendProgressPayload({ ...base, stage: 'preparing', requestId: '  ' })).toBeNull();
  });

  it('bounds counts to the panel total', () => {
    const progress = readGlobalSendProgressPayload({
      requestId: 'r1',
      stage: 'preparing',
      ready: 9,
      total: 5,
      pendingCount: 4,
      timedOutCount: 4
    });
    expect(progress.ready).toBe(5);
    expect(progress.pendingCount).toBe(0);
    expect(progress.timedOutCount).toBe(0);
  });

  it('caps and trims AI names, and carries only counts in blind mode', () => {
    const names = Array.from({ length: 30 }, (_, index) => `  AI ${index}  `);
    const named = readGlobalSendProgressPayload({
      requestId: 'r1',
      stage: 'preparing',
      ready: 0,
      total: 30,
      pendingNames: names,
      timedOutNames: ['Timeout']
    });
    expect(named.pendingNames).toHaveLength(24);
    expect(named.pendingNames[0]).toBe('AI 0');
    expect(named.timedOutNames).toEqual(['Timeout']);

    const blind = readGlobalSendProgressPayload({
      requestId: 'r1',
      stage: 'preparing',
      ready: 3,
      total: 5,
      pendingCount: 2,
      pendingNames: ['Claude', 'Gemini'],
      blind: true
    });
    expect(blind.pendingNames).toEqual([]);
    expect(blind.pendingCount).toBe(2);
    expect(blind.blind).toBe(true);
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

describe('client hello', () => {
  it('advertises the version handshake capability', () => {
    expect([...NATIVE_CAPABILITIES]).toContain('versionHandshake');
    expect(createNativeHello('2.95.0')).toEqual({
      protocol: 2,
      type: 'hello',
      extensionVersion: '2.95.0',
      capabilities: ['historySync', 'newChat', 'versionHandshake']
    });
  });

  it('reads and trims a valid client hello', () => {
    expect(readClientHello({
      protocol: 2,
      type: 'clientHello',
      clientVersion: ' 2.95.0 ',
      appBundleId: ' com.panelize.search '
    })).toEqual({
      clientVersion: '2.95.0',
      appBundleId: 'com.panelize.search'
    });
    expect(readClientHello({
      type: 'clientHello',
      clientVersion: '2.95.0'
    })).toEqual({ clientVersion: '2.95.0', appBundleId: '' });
  });

  it('rejects other types, missing versions and oversized fields', () => {
    expect(readClientHello({ type: 'hello', clientVersion: '2.95.0' })).toBeNull();
    expect(readClientHello({ type: 'clientHello' })).toBeNull();
    expect(readClientHello({ type: 'clientHello', clientVersion: '   ' })).toBeNull();
    expect(readClientHello({ type: 'clientHello', clientVersion: 2950 })).toBeNull();
    expect(readClientHello({
      type: 'clientHello',
      clientVersion: '9'.repeat(NATIVE_CLIENT_VERSION_MAX_LENGTH + 1)
    })).toBeNull();
    expect(readClientHello({
      type: 'clientHello',
      clientVersion: '2.95.0',
      appBundleId: 'x'.repeat(NATIVE_APP_BUNDLE_ID_MAX_LENGTH + 1)
    })).toBeNull();
  });
});