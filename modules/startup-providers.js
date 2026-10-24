/**
 * Startup panel selection for the multi-panel page.
 * Kept separate from multi-panel.js so tests exercise the production logic.
 */

import { LAYOUT_PANEL_COUNTS, getAutoAdjustedLayout } from './layout-auto-adjust.js';

/**
 * Normalize the stored startupProviders setting.
 * @param {unknown} value - Stored value
 * @returns {string[]|null} - Unique provider IDs, or null when nothing is selected
 */
export function normalizeStartupProviders(value) {
  if (!Array.isArray(value)) {
    return null;
  }

  const ids = [...new Set(value.filter(id => typeof id === 'string' && id))];
  return ids.length > 0 ? ids : null;
}

/**
 * Pick the providers to open when the multi-panel page starts.
 * Selected startup providers open in provider order; without a usable
 * selection, the first providers that fit the layout open as before.
 * @param {string[]} orderedProviderIds - Enabled, authorized providers in display order
 * @param {unknown} startupProviders - Stored startupProviders setting
 * @param {number} layoutCapacity - Panel count of the current layout
 * @param {number} maxPanels - Maximum number of panels
 * @returns {string[]}
 */
export function resolveStartupProviderIds(orderedProviderIds, startupProviders, layoutCapacity, maxPanels) {
  const selected = normalizeStartupProviders(startupProviders);
  if (selected) {
    const picked = orderedProviderIds.filter(id => selected.includes(id));
    if (picked.length > 0) {
      return picked.slice(0, maxPanels);
    }
  }

  return orderedProviderIds.slice(0, Math.min(layoutCapacity, maxPanels));
}

/**
 * Choose a layout that can hold the startup panels.
 * 1xN layouts grow one panel at a time while panels are added, so they are
 * kept; other layouts that are too small switch to a single row.
 * @param {string} layout - Current layout
 * @param {number} panelCount - Number of startup panels
 * @returns {string}
 */
export function getStartupLayout(layout, panelCount) {
  const capacity = LAYOUT_PANEL_COUNTS[layout] || 0;
  if (panelCount <= capacity || getAutoAdjustedLayout(layout, panelCount)) {
    return layout;
  }

  const rowLayout = `1x${panelCount}`;
  return LAYOUT_PANEL_COUNTS[rowLayout] ? rowLayout : layout;
}
