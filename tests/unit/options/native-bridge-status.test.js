import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createNativeBridgeStatusController } from '../../../options/controllers/native-bridge-status.js';
import { readNativeBridgeStatusResponse } from '../../../modules/platform/native-bridge-status.js';

function translate(key, substitution) {
  if (key === 'msgNativeBridgeConnected') {
    return `已连接 Panelize Link v${substitution}`;
  }
  return {
    msgNativeBridgeConnectedNoVersion: '已连接 Panelize Link（客户端未上报版本）',
    msgNativeBridgeDisconnected: '未连接 Panelize Link',
    msgNativeBridgeDisabled: '全局输入桥接已关闭',
    msgNativeBridgeUnknown: '无法获取桥接状态'
  }[key] || key;
}

function statusResponse(status) {
  return { ok: true, status };
}

describe('readNativeBridgeStatusResponse', () => {
  it('accepts a complete status response', () => {
    expect(readNativeBridgeStatusResponse(statusResponse({
      enabled: true,
      connected: true,
      clientVersion: '2.95.0',
      error: ''
    }))).toEqual({
      enabled: true,
      connected: true,
      clientVersion: '2.95.0',
      error: ''
    });
  });

  it('rejects malformed responses and normalizes optional fields', () => {
    expect(readNativeBridgeStatusResponse(null)).toBeNull();
    expect(readNativeBridgeStatusResponse({ ok: false })).toBeNull();
    expect(readNativeBridgeStatusResponse(statusResponse({ enabled: true }))).toBeNull();
    expect(readNativeBridgeStatusResponse(statusResponse({
      enabled: true,
      connected: false,
      clientVersion: 2950,
      error: null
    }))).toEqual({
      enabled: true,
      connected: false,
      clientVersion: null,
      error: ''
    });
  });
});

describe('createNativeBridgeStatusController', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="native-bridge-status">—</div>';
  });

  function render(response) {
    const controller = createNativeBridgeStatusController({
      translate,
      requestStatus: vi.fn()
    });
    controller.renderResponse(response);
    return document.getElementById('native-bridge-status').textContent;
  }

  it('renders the connected client version', () => {
    expect(render(statusResponse({
      enabled: true,
      connected: true,
      clientVersion: '2.95.0',
      error: ''
    }))).toBe('已连接 Panelize Link v2.95.0');
  });

  it('renders a connection without a reported client version', () => {
    expect(render(statusResponse({
      enabled: true,
      connected: true,
      clientVersion: null,
      error: ''
    }))).toBe('已连接 Panelize Link（客户端未上报版本）');
  });

  it('renders disconnected, disabled and unknown states', () => {
    expect(render(statusResponse({
      enabled: true,
      connected: false,
      clientVersion: null,
      error: ''
    }))).toBe('未连接 Panelize Link');
    expect(render(statusResponse({
      enabled: false,
      connected: false,
      clientVersion: null,
      error: ''
    }))).toBe('全局输入桥接已关闭');
    expect(render(null)).toBe('无法获取桥接状态');
  });

  it('polls only while the page is visible and stops cleanly', () => {
    const requestStatus = vi.fn(() => Promise.resolve(statusResponse({
      enabled: true,
      connected: false,
      clientVersion: null,
      error: ''
    })));
    const setIntervalFn = vi.fn(() => 7);
    const clearIntervalFn = vi.fn();
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true
    });

    const controller = createNativeBridgeStatusController({
      requestStatus,
      translate,
      documentRef: document,
      intervalMs: 3000,
      setIntervalFn,
      clearIntervalFn
    });
    controller.start();

    expect(setIntervalFn).toHaveBeenCalledWith(expect.any(Function), 3000);
    expect(requestStatus).toHaveBeenCalledTimes(1);

    setIntervalFn.mock.calls[0][0]();
    expect(requestStatus).toHaveBeenCalledTimes(2);

    controller.stop();
    expect(clearIntervalFn).toHaveBeenCalledWith(7);
  });

  it('falls back to the unknown text when the bridge cannot answer', async () => {
    const controller = createNativeBridgeStatusController({
      translate,
      requestStatus: vi.fn(() => Promise.reject(new Error('no bridge')))
    });

    await controller.refresh();

    expect(document.getElementById('native-bridge-status').textContent)
      .toBe('无法获取桥接状态');
  });
});
