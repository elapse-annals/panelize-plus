/**
 * Layout capacity table and auto-adjust rules for the multi-panel grid.
 * Kept separate from multi-panel.js so tests exercise the production logic.
 */

export const MAX_PANELS = 30;

/** Single-row layout whose column count follows the open panel count. */
export const AUTO_LAYOUT_ID = '1x-auto';
/** Panels opened by the auto layout when no saved selection is usable. */
export const AUTO_LAYOUT_STARTUP_PANEL_COUNT = 3;

export const LAYOUT_PANEL_COUNTS = {
  '1x1': 1,
  '1x2': 2,
  '1x3': 3,
  '1x4': 4,
  '1x5': 5,
  '1x6': 6,
  '1x7': 7,
  '1x8': 8,
  '1x9': 9,
  '1x10': 10,
  '1x11': 11,
  '1x12': 12,
  '1x13': 13,
  '1x14': 14,
  '1x15': 15,
  '1x16': 16,
  '1x17': 17,
  '1x18': 18,
  '1x19': 19,
  '1x20': 20,
  '1x21': 21,
  '1x22': 22,
  '1x23': 23,
  '1x24': 24,
  '1x25': 25,
  '1x26': 26,
  '1x27': 27,
  '1x28': 28,
  '1x29': 29,
  '1x30': 30,
  '2x1': 2,
  '2x2': 4,
  '2x3': 6,
  '2x4': 8,
  '2x5': 10,
  '2x6': 12,
  '2x7': 14,
  '2x8': 16,
  '2x9': 18,
  '2x10': 20,
  '2x11': 22,
  '2x12': 24,
  '2x13': 26,
  '2x14': 28,
  '2x15': 30,
  '3x1': 3,
  '3x2': 6,
  '3x3': 9,
  '4x2': 8
};

/** Every layout the picker offers, including the auto layout. */
export const KNOWN_LAYOUT_IDS = Object.freeze([...Object.keys(LAYOUT_PANEL_COUNTS), AUTO_LAYOUT_ID]);

export function isAutoLayout(layout) {
  return layout === AUTO_LAYOUT_ID;
}

/** Auto layout or a fixed layout in LAYOUT_PANEL_COUNTS. */
export function isKnownLayout(layout) {
  return isAutoLayout(layout) || Object.hasOwn(LAYOUT_PANEL_COUNTS, layout);
}

/** Panel capacity for a known layout; 0 for an unknown one. */
export function getLayoutCapacity(layout) {
  if (isAutoLayout(layout)) return MAX_PANELS;
  return Object.hasOwn(LAYOUT_PANEL_COUNTS, layout) ? LAYOUT_PANEL_COUNTS[layout] : 0;
}

/** Auto layout columns: one per panel, clamped to the grid's valid range. */
export function getAutoLayoutColumnCount(panelCount) {
  const count = Math.trunc(Number(panelCount)) || 1;
  return Math.min(Math.max(count, 1), MAX_PANELS);
}

/** Minimum column width for the auto layout, matching the fixed 1xN rules. */
export function getAutoLayoutMinWidth(columnCount) {
  const count = getAutoLayoutColumnCount(columnCount);
  if (count === 1) return 0;
  if (count <= 6) return 400;
  if (count === 7) return 350;
  return 320;
}

/**
 * Calculates whether layout adjustment is needed based on current layout and panel count
 * Only auto-expands columns in 1xN layout sequence
 * @param {string} currentLayout - Current layout, e.g., '1x2'
 * @param {number} newPanelCount - Total panel count after adding
 * @returns {string|null} - New layout name, or null if no adjustment needed
 */
export function getAutoAdjustedLayout(currentLayout, newPanelCount) {
  if (isAutoLayout(currentLayout)) return null;

  if (currentLayout === '4x2' && newPanelCount === 9) {
    return '1x9';
  }

  // Only handle 1xN layouts.
  const match = currentLayout.match(/^1x(\d+)$/);
  if (!match) return null;

  const currentCols = parseInt(match[1]);
  const currentCapacity = LAYOUT_PANEL_COUNTS[currentLayout];

  // Keep the current layout while the new panel still fits.
  if (newPanelCount <= currentCapacity) return null;

  if (currentLayout === '1x7' && newPanelCount === 8) {
    return '4x2';
  }

  // Advance to the next 1xN layout.
  const nextCols = currentCols + 1;
  const nextLayout = `1x${nextCols}`;

  // 1x8 remains manual because auto-expand prefers 4x2 for the 8th panel.
  if (LAYOUT_PANEL_COUNTS[nextLayout]) {
    return nextLayout;
  }

  return null;
}

/**
 * Calculates whether layout shrink is needed based on current layout and panel count
 * Only auto-shrinks columns in 1xN layout sequence
 * @param {string} currentLayout - Current layout, e.g., '1x3'
 * @param {number} newPanelCount - Total panel count after removing
 * @returns {string|null} - New layout name, or null if no adjustment needed
 */
export function getAutoShrunkLayout(currentLayout, newPanelCount) {
  if (isAutoLayout(currentLayout)) return null;

  if (currentLayout === '1x9' && newPanelCount === 8) {
    return '4x2';
  }

  if (currentLayout === '4x2' && newPanelCount === 7) {
    return '1x7';
  }

  // Only handle 1xN layouts (consistent with auto-expand behavior)
  const match = currentLayout.match(/^1x(\d+)$/);
  if (!match) return null;

  const currentCols = parseInt(match[1]);

  // No need to shrink if panel count already matches or exceeds column count
  if (newPanelCount >= currentCols) return null;

  // Shrink to match panel count (minimum 1x1)
  const targetCols = Math.max(newPanelCount, 1);
  const targetLayout = `1x${targetCols}`;

  if (LAYOUT_PANEL_COUNTS[targetLayout]) {
    return targetLayout;
  }

  return null;
}
