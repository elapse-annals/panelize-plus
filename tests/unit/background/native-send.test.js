import { describe, expect, it, vi } from 'vitest';
import { createNativeSendBridge } from '../../../background/native-send.js';

function createFakePort() {
  const messageListeners = [];
  const disconnectListeners = [];
  return {
    postMessage: vi.fn(),
    disconnect: vi.fn(() => disconnectListeners.forEach(listener => listener())),
    onMessage: { addListener: listener => messageListeners.push(listener) },
    onDisconnect: { addListener: listener => disconnectListeners.push(listener) },
    emitMessage: message => messageListeners.forEach(listener => listener(message)),
    emitDisconnect: () => disconnectListeners.forEach(listener => listener())
  };
}

function createBridge({
  port = createFakePort(),
  onSendPrompt = vi.fn(() => Promise.resolve()),
  onNewChat = vi.fn(() => Promise.resolve()),
  onHistoryRequest = vi.fn(),
  onHistoryUpsert = vi.fn(),
  onDisconnect = vi.fn()
} = {}) {
  const status = vi.fn();
  const bridge = createNativeSendBridge({
    connectNative: vi.fn(() => port),
    runtime: {
      id: 'extension-id',
      getManifest: () => ({ version: '2.60.0' }),
      lastError: null
    },
    onSendPrompt,
    onNewChat,
    onHistoryRequest,
    onHistoryUpsert,
    onDisconnect,
    onStatus: status,
    now: () => 1000
  });
  return { bridge, port, status, onSendPrompt, onNewChat, onHistoryRequest, onHistoryUpsert, onDisconnect };
}

describe('createNativeSendBridge', () => {
  it('connects to the fixed host and announces the extension version', () => {
    const { bridge, port, status } = createBridge();

    expect(bridge.connect()).toBe(true);
    expect(port.postMessage).toHaveBeenCalledWith({
      protocol: 2,
      type: 'hello',
      extensionVersion: '2.60.0',
      capabilities: ['historySync', 'newChat']
    });
    expect(status).toHaveBeenCalledWith({ connected: true, error: '' });
    expect(bridge.isConnected()).toBe(true);
  });

  it('answers host heartbeats to keep the service worker responsive', () => {
    const { bridge, port } = createBridge();
    bridge.connect();
    port.postMessage.mockClear();

    bridge.handleNativeMessage({ protocol: 2, type: 'ping' });

    expect(port.postMessage).toHaveBeenCalledWith({ protocol: 2, type: 'pong', at: 1000 });
  });

  it('hands off a valid prompt once and completes it from the page result', async () => {
    const { bridge, port, onSendPrompt } = createBridge();
    bridge.connect();
    port.postMessage.mockClear();

    bridge.handleNativeMessage({
      protocol: 2,
      type: 'sendPrompt',
      requestId: 'request-1',
      text: '  Explain closures  '
    });
    bridge.handleNativeMessage({
      protocol: 2,
      type: 'sendPrompt',
      requestId: 'request-1',
      text: 'Explain closures'
    });
    await Promise.resolve();

    expect(onSendPrompt).toHaveBeenCalledTimes(1);
    expect(onSendPrompt).toHaveBeenCalledWith({
      text: 'Explain closures',
      requestId: 'request-1'
    });
    expect(port.postMessage).toHaveBeenCalledWith({
      protocol: 2,
      type: 'sendAccepted',
      requestId: 'request-1'
    });

    expect(bridge.deliverResult({
      requestId: 'request-1',
      ok: true,
      sent: 6,
      total: 6
    })).toBe(true);
    expect(port.postMessage).toHaveBeenLastCalledWith({
      protocol: 2,
      type: 'sendResult',
      requestId: 'request-1',
      ok: true,
      sent: 6,
      total: 6,
      reason: ''
    });
  });

  it('passes a whitelisted per-send prompt mode to the page', async () => {
    const { bridge, port, onSendPrompt } = createBridge();
    bridge.connect();
    port.postMessage.mockClear();

    bridge.handleNativeMessage({
      protocol: 2,
      type: 'sendPrompt',
      requestId: 'mode-1',
      text: 'Explain closures',
      promptMode: 'concise'
    });
    await Promise.resolve();

    expect(onSendPrompt).toHaveBeenCalledWith({
      text: 'Explain closures',
      requestId: 'mode-1',
      promptMode: 'concise'
    });
  });

  it('drops an unknown mode without blocking the send', async () => {
    const { bridge, port, onSendPrompt } = createBridge();
    bridge.connect();
    port.postMessage.mockClear();

    bridge.handleNativeMessage({
      protocol: 2,
      type: 'sendPrompt',
      requestId: 'mode-2',
      text: 'Explain closures',
      promptMode: 'custom-mode'
    });
    await Promise.resolve();

    expect(onSendPrompt).toHaveBeenCalledWith({
      text: 'Explain closures',
      requestId: 'mode-2'
    });
    expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'sendAccepted',
      requestId: 'mode-2'
    }));
  });

  it('sends once when a retry changes the mode', async () => {
    const { bridge, onSendPrompt } = createBridge();
    bridge.connect();

    bridge.handleNativeMessage({
      type: 'sendPrompt',
      requestId: 'mode-3',
      text: 'Question',
      promptMode: 'concise'
    });
    bridge.handleNativeMessage({
      type: 'sendPrompt',
      requestId: 'mode-3',
      text: 'Question',
      promptMode: 'deep'
    });
    await Promise.resolve();

    expect(onSendPrompt).toHaveBeenCalledTimes(1);
    expect(onSendPrompt).toHaveBeenCalledWith({
      text: 'Question',
      requestId: 'mode-3',
      promptMode: 'concise'
    });
  });

  it('rejects malformed requests without calling the page', () => {
    const { bridge, port, onSendPrompt } = createBridge();
    bridge.connect();
    port.postMessage.mockClear();

    bridge.handleNativeMessage({ type: 'sendPrompt', requestId: 'r', text: '   ' });
    expect(onSendPrompt).not.toHaveBeenCalled();
    expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
      requestId: 'r',
      code: 'empty-text'
    }));
  });

  it('forwards preparation progress once per state and stops at the result', async () => {
    const { bridge, port } = createBridge();
    bridge.connect();
    bridge.handleNativeMessage({ type: 'sendPrompt', requestId: 'progress-1', text: 'Question' });
    await Promise.resolve();
    port.postMessage.mockClear();

    const preparing = {
      requestId: 'progress-1',
      stage: 'preparing',
      ready: 3,
      total: 5,
      pendingCount: 2,
      timedOutCount: 0,
      pendingNames: ['Claude', 'Gemini']
    };
    expect(bridge.deliverProgress(preparing)).toBe(true);
    expect(port.postMessage).toHaveBeenLastCalledWith({
      protocol: 2,
      type: 'sendProgress',
      requestId: 'progress-1',
      stage: 'preparing',
      ready: 3,
      total: 5,
      pendingCount: 2,
      timedOutCount: 0,
      pendingNames: ['Claude', 'Gemini'],
      timedOutNames: [],
      blind: false
    });

    // A repeated tick and a stage regression are both dropped.
    port.postMessage.mockClear();
    expect(bridge.deliverProgress(preparing)).toBe(false);
    expect(bridge.deliverProgress({ ...preparing, stage: 'opening' })).toBe(false);
    expect(port.postMessage).not.toHaveBeenCalled();

    expect(bridge.deliverProgress({ requestId: 'progress-1', stage: 'sending' })).toBe(true);
    expect(bridge.deliverResult({ requestId: 'progress-1', ok: true, sent: 3, total: 5 })).toBe(true);

    // Late updates after the final result are ignored.
    port.postMessage.mockClear();
    expect(bridge.deliverProgress({ requestId: 'progress-1', stage: 'sending' })).toBe(false);
    expect(port.postMessage).not.toHaveBeenCalled();
  });

  it('reports the opened phase once and only while the request is active', async () => {
    const { bridge, port } = createBridge();
    bridge.connect();
    bridge.handleNativeMessage({ type: 'sendPrompt', requestId: 'opened-1', text: 'Question' });
    await Promise.resolve();
    port.postMessage.mockClear();

    expect(bridge.deliverOpened('opened-1')).toBe(true);
    expect(port.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'sendProgress',
      requestId: 'opened-1',
      stage: 'opening'
    }));

    expect(bridge.deliverOpened('opened-1')).toBe(false);
    expect(bridge.deliverProgress({ requestId: 'opened-1', stage: 'preparing', ready: 1, total: 1 })).toBe(true);
    // The page reported first: an opening event arriving later must not move backwards.
    expect(bridge.deliverOpened('opened-1')).toBe(false);

    expect(bridge.deliverProgress({ requestId: 'unknown', stage: 'preparing' })).toBe(false);
    expect(bridge.deliverOpened('unknown')).toBe(false);
  });

  it('does not resend a request that already completed', async () => {
    const { bridge, port, onSendPrompt } = createBridge();
    bridge.connect();
    bridge.handleNativeMessage({ type: 'sendPrompt', requestId: 'once', text: 'Question' });
    await Promise.resolve();
    bridge.deliverResult({ requestId: 'once', ok: true, sent: 1, total: 1 });
    port.postMessage.mockClear();

    bridge.handleNativeMessage({ type: 'sendPrompt', requestId: 'once', text: 'Question' });

    expect(onSendPrompt).toHaveBeenCalledTimes(1);
    expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'sendResult',
      requestId: 'once'
    }));
  });

  it('reports disconnects and allows reconnecting', () => {
    const firstPort = createFakePort();
    const secondPort = createFakePort();
    const connectNative = vi.fn()
      .mockReturnValueOnce(firstPort)
      .mockReturnValueOnce(secondPort);
    const status = vi.fn();
    const bridge = createNativeSendBridge({
      connectNative,
      runtime: { id: 'extension-id', getManifest: () => ({ version: '2.60.0' }) },
      onSendPrompt: vi.fn(),
      onStatus: status
    });

    bridge.connect();
    firstPort.disconnect();

    expect(bridge.isConnected()).toBe(false);
    expect(status).toHaveBeenLastCalledWith({ connected: false, error: '' });
    expect(bridge.connect()).toBe(true);
    expect(secondPort.postMessage).toHaveBeenCalled();
  });

  it('disconnects on demand and can reconnect', () => {
    const firstPort = createFakePort();
    const secondPort = createFakePort();
    const connectNative = vi.fn()
      .mockReturnValueOnce(firstPort)
      .mockReturnValueOnce(secondPort);
    const bridge = createNativeSendBridge({
      connectNative,
      runtime: { id: 'extension-id', getManifest: () => ({ version: '2.60.0' }) },
      onSendPrompt: vi.fn()
    });

    bridge.connect();
    bridge.disconnect();

    expect(firstPort.disconnect).toHaveBeenCalled();
    expect(bridge.isConnected()).toBe(false);
    expect(bridge.connect()).toBe(true);
    expect(secondPort.postMessage).toHaveBeenCalled();
  });

  it('passes the new-chat flag through to the send handoff', async () => {
    const { bridge, onSendPrompt } = createBridge();
    bridge.connect();

    bridge.handleNativeMessage({
      type: 'sendPrompt',
      requestId: 'new-chat-send',
      text: 'Question',
      newChat: true
    });
    await Promise.resolve();

    expect(onSendPrompt).toHaveBeenCalledWith({
      text: 'Question',
      requestId: 'new-chat-send',
      newChat: true
    });
  });

  it('handles a new-chat request once and reports its result', async () => {
    const { bridge, port, onNewChat } = createBridge();
    bridge.connect();
    port.postMessage.mockClear();

    bridge.handleNativeMessage({ type: 'newChat', requestId: 'chat-1' });
    bridge.handleNativeMessage({ type: 'newChat', requestId: 'chat-1' });
    await Promise.resolve();
    expect(onNewChat).toHaveBeenCalledTimes(1);
    expect(onNewChat).toHaveBeenCalledWith({ requestId: 'chat-1' });

    expect(bridge.deliverNewChatResult({
      requestId: 'chat-1',
      ok: true,
      ready: 3,
      total: 3
    })).toBe(true);
    expect(port.postMessage).toHaveBeenLastCalledWith({
      protocol: 2,
      type: 'newChatResult',
      requestId: 'chat-1',
      ok: true,
      ready: 3,
      total: 3,
      reason: ''
    });

    // A late or unknown result is ignored.
    expect(bridge.deliverNewChatResult({ requestId: 'chat-1', ok: true })).toBe(false);
    expect(bridge.deliverNewChatResult({ requestId: 'unknown', ok: true })).toBe(false);
  });

  it('answers a repeated new-chat request from its remembered result', async () => {
    const { bridge, port, onNewChat } = createBridge();
    bridge.connect();
    bridge.handleNativeMessage({ type: 'newChat', requestId: 'chat-2' });
    await Promise.resolve();
    bridge.deliverNewChatResult({ requestId: 'chat-2', ok: true, ready: 1, total: 1 });
    port.postMessage.mockClear();

    bridge.handleNativeMessage({ type: 'newChat', requestId: 'chat-2' });
    expect(onNewChat).toHaveBeenCalledTimes(1);
    expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'newChatResult',
      requestId: 'chat-2'
    }));
  });

  it('dispatches history requests and validated upsert batches', async () => {
    const { bridge, port, onHistoryRequest, onHistoryUpsert } = createBridge();
    bridge.connect();
    port.postMessage.mockClear();

    bridge.handleNativeMessage({ type: 'historyRequest' });
    expect(onHistoryRequest).toHaveBeenCalledTimes(1);

    bridge.handleNativeMessage({
      type: 'historyUpsert',
      batchId: 'batch-1',
      index: 0,
      total: 1,
      records: [{
        key: 'from mac',
        text: 'From Mac',
        createdAt: 900,
        updatedAt: 900
      }]
    });
    await Promise.resolve();
    expect(onHistoryUpsert).toHaveBeenCalledWith({
      batchId: 'batch-1',
      index: 0,
      total: 1,
      records: [expect.objectContaining({ text: 'From Mac', key: 'from mac' })]
    });

    port.postMessage.mockClear();
    bridge.handleNativeMessage({
      type: 'historyUpsert',
      batchId: '',
      index: 0,
      total: 1,
      records: []
    });
    expect(onHistoryUpsert).toHaveBeenCalledTimes(1);
    expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
      code: 'invalid-request'
    }));
  });

  it('sends history snapshots and updates as chunks', () => {
    const { bridge, port } = createBridge();
    bridge.connect();
    port.postMessage.mockClear();

    const records = Array.from({ length: 51 }, (_, index) => ({
      key: `q${index}`,
      text: `question ${index}`,
      createdAt: 900,
      updatedAt: 900,
      summary: null
    }));
    expect(bridge.sendHistorySnapshot(records)).toBe(true);
    expect(port.postMessage).toHaveBeenCalledTimes(2);
    expect(port.postMessage.mock.calls[0][0]).toMatchObject({
      type: 'historySnapshot',
      index: 0,
      total: 2
    });
    expect(port.postMessage.mock.calls[1][0]).toMatchObject({
      type: 'historySnapshot',
      index: 1,
      total: 2
    });

    port.postMessage.mockClear();
    expect(bridge.sendHistoryUpsert([])).toBe(true);
    expect(port.postMessage).not.toHaveBeenCalled();
  });

  it('notifies when the native port disconnects', () => {
    const { bridge, port, onDisconnect } = createBridge();
    bridge.connect();
    port.disconnect();
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });
});