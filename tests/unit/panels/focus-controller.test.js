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
});
