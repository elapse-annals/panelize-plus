import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLayoutController } from '../../../multi-panel/controllers/layout.js';

afterEach(() => {
  document.body.innerHTML = '';
});

function setup(layout, panelCount) {
  document.body.innerHTML = '<div id="panel-grid"></div>';
  const panels = Array.from({ length: panelCount }, (_, index) => ({ id: `panel-${index}` }));
  const refresh = vi.fn();
  const updatePanelEdgeButtons = vi.fn();
  const controller = createLayoutController({
    getPanelsController: () => ({ panels }),
    getPresentationController: () => ({ updatePanelEdgeButtons })
  });
  controller.currentLayout = layout;
  controller.panelResize = { refresh };
  return { controller, refresh, updatePanelEdgeButtons, grid: document.getElementById('panel-grid') };
}

describe('syncAutoLayoutColumns', () => {
  it('refreshes handles and edge buttons for a fixed 1xN layout', () => {
    const { controller, refresh, updatePanelEdgeButtons, grid } = setup('1x15', 15);
    grid.style.setProperty('--panel-count', '14');
    grid.style.setProperty('--panel-min-width', '320px');

    controller.syncAutoLayoutColumns();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(updatePanelEdgeButtons).toHaveBeenCalledTimes(1);
    // Fixed layouts take their column count from the class, never the auto vars.
    expect(grid.style.getPropertyValue('--panel-count')).toBe('14');
    expect(grid.style.getPropertyValue('--panel-min-width')).toBe('320px');
  });

  it('writes the auto columns and refreshes for the auto layout', () => {
    const { controller, refresh, updatePanelEdgeButtons, grid } = setup('1x-auto', 15);

    controller.syncAutoLayoutColumns();

    expect(grid.style.getPropertyValue('--panel-count')).toBe('15');
    expect(grid.style.getPropertyValue('--panel-min-width')).toBe('320px');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(updatePanelEdgeButtons).toHaveBeenCalledTimes(1);
  });

  it('does nothing without a panel grid', () => {
    const refresh = vi.fn();
    const updatePanelEdgeButtons = vi.fn();
    const controller = createLayoutController({
      getPanelsController: () => ({ panels: [] }),
      getPresentationController: () => ({ updatePanelEdgeButtons })
    });
    controller.panelResize = { refresh };

    controller.syncAutoLayoutColumns();

    expect(refresh).not.toHaveBeenCalled();
    expect(updatePanelEdgeButtons).not.toHaveBeenCalled();
  });
});
