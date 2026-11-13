import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFocusController } from '../../../multi-panel/controllers/focus.js';
import { PANELIZE_FOCUS_GUARD } from '../../../multi-panel/controllers/protocol.js';

describe('multi-panel focus controller', () => {
  let panels;
  let loadingPanelIds;
  let controller;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <textarea id="unified-input"></textarea>
      <iframe id="panel-1-frame"></iframe>
      <iframe id="panel-2-frame"></iframe>
    `;

    const iframe1 = document.getElementById('panel-1-frame');
    const iframe2 = document.getElementById('panel-2-frame');
    iframe1.contentWindow.postMessage = vi.fn();
    iframe2.contentWindow.postMessage = vi.fn();

    panels = [
      { id: 'panel-1', providerId: 'chatgpt', iframe: iframe1 },
      { id: 'panel-2', providerId: 'claude', iframe: iframe2 }
    ];
    loadingPanelIds = new Set();

    controller = createFocusController({
      getPanelsController: () => ({
        panels,
        loadingPanelIds
      })
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts focus guard even if another iframe currently holds focus', () => {
    const iframe1 = document.getElementById('panel-1-frame');
    iframe1.focus();
    expect(document.activeElement).toBe(iframe1);

    controller.startPanelFocusGuard(panels[1]);

    expect(controller.panelFocusGuardIds.has('panel-2')).toBe(true);
    expect(panels[1].iframe.contentWindow.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: PANELIZE_FOCUS_GUARD,
        context: 'multi-panel',
        active: true,
        durationMs: 8000
      }),
      '*'
    );
  });

  it('stops focus guard for a single panel without affecting other panels', () => {
    controller.startPanelFocusGuard(panels[0]);
    controller.startPanelFocusGuard(panels[1]);

    expect(controller.panelFocusGuardIds.size).toBe(2);

    controller.stopPanelFocusGuard('panel-1');

    expect(controller.panelFocusGuardIds.has('panel-1')).toBe(false);
    expect(controller.panelFocusGuardIds.has('panel-2')).toBe(true);
    expect(panels[0].iframe.contentWindow.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: PANELIZE_FOCUS_GUARD,
        active: false
      }),
      '*'
    );
  });

  it('preserves unified input focus while any panel focus guard is active', () => {
    expect(controller.shouldPreserveUnifiedInputFocus()).toBe(false);

    controller.startPanelFocusGuard(panels[0]);
    expect(controller.shouldPreserveUnifiedInputFocus()).toBe(true);

    controller.stopPanelFocusGuard('panel-0'); // invalid id, does nothing
    expect(controller.shouldPreserveUnifiedInputFocus()).toBe(true);

    controller.stopPanelFocusGuard('panel-1');
    expect(controller.shouldPreserveUnifiedInputFocus()).toBe(false);
  });

  it('still refocuses the question box while protection is active', async () => {
    loadingPanelIds.add('panel-1');
    const input = document.getElementById('unified-input');
    input.focus();
    // The blur handler runs while the body is the active element.
    input.blur();

    controller.focusUnifiedInput();
    await vi.advanceTimersByTimeAsync(50);

    expect(document.activeElement).toBe(input);
  });

  it('leaves focus on a control the user just focused', async () => {
    loadingPanelIds.add('panel-1');
    const input = document.getElementById('unified-input');
    const select = document.createElement('select');
    document.body.append(select);
    input.focus();
    input.blur();

    // The click's focus change lands before the queued refocus frame runs.
    controller.focusUnifiedInput();
    select.focus();
    await vi.advanceTimersByTimeAsync(50);

    expect(document.activeElement).toBe(select);
    select.remove();
  });
});
