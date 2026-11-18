import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNativeBridgeController } from '../../../background/controllers/native-bridge.js';

function createFakePort() {
  const messageListeners = [];
  return {
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onMessage: { addListener: listener => messageListeners.push(listener) },
    onDisconnect: { addListener: vi.fn() },
    emitMessage: message => messageListeners.forEach(listener => listener(message))
  };
}

function createController({ enabled = true, port = createFakePort() } = {}) {
  const settings = {
    globalSendBridgeEnabled: enabled,
    loadGlobalSendSetting: vi.fn(async () => {})
  };
  const controller = createNativeBridgeController({
    getPageActionsController: () => ({
      handOffGlobalPrompt: vi.fn(),
      handOffNewChat: vi.fn()
    }),
    getHistorySyncController: () => null,
    getSettingsController: () => settings
  });
  return { controller, settings, port };
}

function requestStatus(controller, sender = { id: 'extension-id' }) {
  return new Promise(resolve => {
    controller.handleStatusRequest(sender, resolve);
  });
}

describe('createNativeBridgeController status requests', () => {
  let port;

  beforeEach(() => {
    port = createFakePort();
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'extension-id',
        lastError: null,
        connectNative: vi.fn(() => port)
      },
      alarms: {
        create: vi.fn(),
        clear: vi.fn(() => Promise.resolve())
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects status requests from other senders', () => {
    const { controller } = createController({ port });
    const sendResponse = vi.fn();

    expect(controller.handleStatusRequest({ id: 'other' }, sendResponse)).toBe(false);
    expect(sendResponse).toHaveBeenCalledWith({ ok: false });
  });

  it('reports the enabled and connected bridge state', async () => {
    const { controller, settings } = createController({ port });

    const response = await requestStatus(controller);

    expect(settings.loadGlobalSendSetting).toHaveBeenCalledTimes(1);
    expect(response).toEqual({
      ok: true,
      status: {
        enabled: true,
        connected: true,
        clientVersion: null,
        error: ''
      }
    });
    expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'hello' }));
  });

  it('exposes the client version announced over the bridge', async () => {
    const { controller } = createController({ port });
    await requestStatus(controller);

    port.emitMessage({ type: 'clientHello', clientVersion: '2.95.0' });

    const response = await requestStatus(controller);
    expect(response.status.clientVersion).toBe('2.95.0');
  });

  it('reports a disabled bridge without connecting', async () => {
    const { controller } = createController({ enabled: false, port });

    const response = await requestStatus(controller);

    expect(response.status).toEqual({
      enabled: false,
      connected: false,
      clientVersion: null,
      error: ''
    });
    expect(port.postMessage).not.toHaveBeenCalled();
  });
});
