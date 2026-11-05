/**
 * Grid placement for the AI summary card.
 *
 * The card is one full-height column right after the columns the panels
 * occupy in the first row, so unused layout columns stay to its right instead
 * of separating it from the last AI.
 */

/**
 * @param {number[]} panelRowTops Offset tops of the rendered panel elements.
 * @returns {number|null} 1-based grid column line, or null without panels.
 */
export function getSummaryColumnStart(panelRowTops) {
  if (!Array.isArray(panelRowTops) || panelRowTops.length === 0) {
    return null;
  }
  const firstTop = Math.min(...panelRowTops);
  return panelRowTops.filter(top => top === firstTop).length + 1;
}
