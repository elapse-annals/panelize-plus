/**
 * Owns layout behavior and its page-local state.
 * Deferred controller getters keep composition in the entry point.
 */
import { getEnabledProviders } from '../../modules/providers/providers.js';
import {
  MAX_PANELS,
  LAYOUT_PANEL_COUNTS,
  getAutoLayoutColumnCount,
  getAutoLayoutMinWidth,
  isAutoLayout,
  isKnownLayout
} from '../../modules/panels/layout-auto-adjust.js';
import { applyPanelFitScale, createPanelFitState, getPanelFitScale, updatePanelFitState } from '../../modules/panels/panel-fit.js';

export function createLayoutController({
  getPanelsController,
  getPresentationController
}) {
  // ===== State Management =====
  let currentLayout = '1x3';

  let panelResize = null;

  // Re-fits pages when their panel changes width (window, layout or drag).
  const panelFitObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver((entries) => {
      entries.forEach(({ target }) => {
        const panel = getPanelsController().panels.find(candidate => candidate.iframe?.parentElement === target);
        if (panel) {
          updatePanelFit(panel);
        }
      });
    })
    : null;

  function normalizeLayout(layout) {
    if (isKnownLayout(layout)) {
      return layout;
    }
    return '1x3';
  }

  // ===== Panel Fit =====
  function updatePanelFit(panel) {
    const container = panel.iframe?.parentElement;
    if (!container) {
      return;
    }
    panel.fit = updatePanelFitState(panel.fit || createPanelFitState(), {
      available: container.clientWidth,
      needed: panel.pageNeededWidth || 0,
      now: performance.now()
    });
    applyPanelFitScale(panel.iframe, getPanelFitScale(panel.fit));
  }

  // ===== Layout Management =====
  function writeAutoLayoutColumns(panelGrid, panelCount) {
    const count = getAutoLayoutColumnCount(panelCount);
    panelGrid.style.setProperty('--panel-count', String(count));
    panelGrid.style.setProperty('--panel-min-width', `${getAutoLayoutMinWidth(count)}px`);
  }

  // Applies the current layout id; auto also needs explicit track variables
  // because its column count is not part of the fixed layout table.
  function applyLayoutToGrid({ panelCount = getPanelsController().panels.length } = {}) {
    const panelGrid = document.getElementById('panel-grid');
    if (!panelGrid) return;

    panelGrid.className = `layout-${currentLayout}`;

    // Update layout button active states
    document.querySelectorAll('.layout-option').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.layout === currentLayout);
    });

    if (isAutoLayout(currentLayout)) {
      writeAutoLayoutColumns(panelGrid, panelCount);
    } else {
      // Never let an auto minimum width override a fixed layout.
      panelGrid.style.removeProperty('--panel-count');
      panelGrid.style.removeProperty('--panel-min-width');
    }

    panelResize?.refresh();
    getPresentationController().updatePanelEdgeButtons?.();
  }

  // Panel count changes in the auto layout do not change the grid class, so
  // resize handles and edge buttons need an explicit refresh.
  function syncAutoLayoutColumns() {
    if (!isAutoLayout(currentLayout)) return;

    const panelGrid = document.getElementById('panel-grid');
    if (!panelGrid) return;

    writeAutoLayoutColumns(panelGrid, getPanelsController().panels.length);
    panelResize?.refresh();
    getPresentationController().updatePanelEdgeButtons?.();
  }

  function setLayout(layout) {
    if (!isKnownLayout(layout)) return;

    getPanelsController().setFocusedPanel(null);
    currentLayout = layout;
    applyLayoutToGrid();

    // Auto keeps its panel count; fixed layouts still resize to their capacity.
    if (!isAutoLayout(layout)) {
      adjustPanelCount(LAYOUT_PANEL_COUNTS[layout], layout);
    }

    // Save layout
    getPresentationController().saveProviderConfiguration();

    // Close modal
    closeLayoutModal();
  }

  async function adjustPanelCount(targetCount, targetLayout = currentLayout) {
    getPanelsController().setFocusedPanel(null);
    const enabledProviders = await getEnabledProviders();
    if (currentLayout !== targetLayout) return;

    const maxAllowedCount = Math.min(targetCount, MAX_PANELS, enabledProviders.length);

    // Remove excess panels
    while (getPanelsController().panels.length > maxAllowedCount) {
      if (currentLayout !== targetLayout) return;
      const panel = getPanelsController().panels[getPanelsController().panels.length - 1];
      getPanelsController().removePanel(panel.id);
    }

    // Add missing panels
    while (getPanelsController().panels.length < maxAllowedCount) {
      if (currentLayout !== targetLayout) return;
      // Find a provider not already in use
      const usedProviders = getPanelsController().panels.map(p => p.providerId);
      const availableProvider = enabledProviders.find(p => !usedProviders.includes(p.id));

      if (availableProvider) {
        await getPanelsController().addPanel(availableProvider.id);
      }
    }
  }

  // ===== Modal Functions =====
  function openLayoutModal() {
    const modal = document.getElementById('layout-modal');
    modal.style.display = 'flex';

    // Mark current layout as active
    document.querySelectorAll('.layout-option').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.layout === currentLayout);
    });
  }

  function closeLayoutModal() {
    document.getElementById('layout-modal').style.display = 'none';
  }

  return {
    applyLayoutToGrid,
    closeLayoutModal,
    get currentLayout() { return currentLayout; },
    set currentLayout(value) { currentLayout = value; },
    normalizeLayout,
    openLayoutModal,
    get panelFitObserver() { return panelFitObserver; },
    get panelResize() { return panelResize; },
    set panelResize(value) { panelResize = value; },
    setLayout,
    syncAutoLayoutColumns,
    updatePanelFit,
  };
}
