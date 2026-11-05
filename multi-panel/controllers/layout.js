/**
 * Owns layout behavior and its page-local state.
 * Deferred controller getters keep composition in the entry point.
 */
import { getEnabledProviders } from '../../modules/providers/providers.js';
import { MAX_PANELS, LAYOUT_PANEL_COUNTS } from '../../modules/panels/layout-auto-adjust.js';
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
    if (LAYOUT_PANEL_COUNTS[layout]) {
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
  function setLayout(layout) {
    if (!LAYOUT_PANEL_COUNTS[layout]) return;

    getPanelsController().setFocusedPanel(null);
    currentLayout = layout;

    const panelGrid = document.getElementById('panel-grid');
    panelGrid.className = `layout-${layout}`;

    // Update layout button active states
    document.querySelectorAll('.layout-option').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.layout === layout);
    });

    // Adjust panel count if needed
    const targetCount = LAYOUT_PANEL_COUNTS[layout];
    adjustPanelCount(targetCount);

    // Save layout
    getPresentationController().saveProviderConfiguration();

    // Close modal
    closeLayoutModal();
  }

  async function adjustPanelCount(targetCount) {
    getPanelsController().setFocusedPanel(null);
    const enabledProviders = await getEnabledProviders();
    const maxAllowedCount = Math.min(targetCount, MAX_PANELS, enabledProviders.length);

    // Remove excess panels
    while (getPanelsController().panels.length > maxAllowedCount) {
      const panel = getPanelsController().panels[getPanelsController().panels.length - 1];
      getPanelsController().removePanel(panel.id);
    }

    // Add missing panels
    while (getPanelsController().panels.length < maxAllowedCount) {
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
    closeLayoutModal,
    get currentLayout() { return currentLayout; },
    set currentLayout(value) { currentLayout = value; },
    normalizeLayout,
    openLayoutModal,
    get panelFitObserver() { return panelFitObserver; },
    get panelResize() { return panelResize; },
    set panelResize(value) { panelResize = value; },
    setLayout,
    updatePanelFit,
  };
}
