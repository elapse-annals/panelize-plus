/**
 * Drag handles between panel columns.
 *
 * Column widths are stored per layout as weights: each column becomes
 * minmax(minWidth * weight, weight fr). In wide mode, the same weights produce
 * fixed pixel columns with a wider base and a minimum reading width.
 */

export const PANEL_COLUMN_WEIGHTS_KEY = 'panelColumnWeights';
/** Wide mode scales each panel's actual grid width by this amount. */
export const PANEL_WIDE_SCALE = 1.5;
/** Minimum base width in CSS pixels; custom column weights still apply. */
export const PANEL_WIDE_MIN_WIDTH = 672;
/** Columns are not dragged narrower than this (or than they already are). */
export const PANEL_RESIZE_MIN_WIDTH = 200;
/** Arrow keys move a focused handle this far. */
export const PANEL_RESIZE_KEY_STEP = 16;
/** Width of the grab area, centered on the gap between two columns. */
export const PANEL_RESIZE_HANDLE_WIDTH = 10;

const round = (value, digits) => Number(value.toFixed(digits));
const sum = (values) => values.reduce((total, value) => total + value, 0);

/**
 * @param {number[]} widths - Column widths in pixels.
 * @param {number} available - Grid width left for columns (no padding or gaps).
 * @param {number} minWidth - Layout minimum column width; 0 for none.
 * @returns {number[]}
 */
export function getColumnWeights(widths, available, minWidth) {
  const base = Math.max(minWidth, available / widths.length);
  return widths.map((width) => round(width / base, 4));
}

/**
 * @param {number[]} weights
 * @param {number} minWidth
 * @returns {string} grid-template-columns value.
 */
export function getColumnTemplate(weights, minWidth) {
  return weights
    .map((weight) => `minmax(${round(minWidth * weight, 2)}px, ${weight}fr)`)
    .join(' ');
}

/**
 * @param {number[]} weights
 * @param {number} available - Grid width left for columns (no padding or gaps).
 * @param {number} minWidth
 * @param {number} scale
 * @returns {string} Fixed pixel widths for wide mode.
 */
export function getWideColumnTemplate(weights, available, minWidth, scale = PANEL_WIDE_SCALE) {
  if (weights.length < 2 || !(scale > 1)) {
    return '';
  }
  const base = Math.max(PANEL_WIDE_MIN_WIDTH, Math.max(minWidth, available / weights.length) * scale);
  return weights.map((weight) => `${Math.round(base * weight)}px`).join(' ');
}

/**
 * Moves the edge between column `index` and the next one by `delta` pixels.
 * Columns that fit the window trade width with their neighbor; columns that
 * already scroll sideways grow or shrink alone, but not below fitting again.
 * @param {number[]} widths
 * @param {number} index
 * @param {number} delta
 * @param {{scrolls: boolean, available: number}} options
 * @returns {number[]}
 */
export function resizeColumns(widths, index, delta, { scrolls, available }) {
  const next = widths.slice();
  if (scrolls) {
    const floor = Math.min(PANEL_RESIZE_MIN_WIDTH, widths[index]);
    const fitFloor = available - (sum(widths) - widths[index]);
    next[index] = Math.max(floor, fitFloor, widths[index] + delta);
    return next;
  }
  const pair = widths[index] + widths[index + 1];
  const floor = Math.min(PANEL_RESIZE_MIN_WIDTH, widths[index], widths[index + 1]);
  next[index] = Math.min(pair - floor, Math.max(floor, widths[index] + delta));
  next[index + 1] = pair - next[index];
  return next;
}

/**
 * @param {unknown} weights
 * @param {number} count
 * @returns {boolean}
 */
export function isValidColumnWeights(weights, count) {
  return Array.isArray(weights) && weights.length === count
    && weights.every((weight) => Number.isFinite(weight) && weight > 0);
}

/**
 * Splits the grid's computed columns into resizeable panel columns and the AI
 * summary card's column, which has no resize handle.
 *
 * A card after every layout column lives in an implicit trailing track: it is
 * left out of `widths` and deducted from the available width. A card in an
 * unused explicit column keeps that track in `widths` (the saved column weights
 * still cover the layout's columns) and is reported through `summaryIndex`.
 * @param {{
 *   templateColumns: string,
 *   columnGap: string,
 *   paddingLeft: string,
 *   paddingRight: string,
 *   clientWidth: number,
 *   scrollWidth: number,
 *   summaryIndex?: number,
 *   minWidth?: number
 * }} metrics
 * @returns {{
 *   widths: number[],
 *   gap: number,
 *   paddingLeft: number,
 *   summaryWidth: number,
 *   summaryIndex: number,
 *   minWidth: number,
 *   available: number,
 *   scrolls: boolean
 * }}
 */
export function getPanelGridMetrics({
  templateColumns,
  columnGap,
  paddingLeft,
  paddingRight,
  clientWidth,
  scrollWidth,
  summaryIndex = -1,
  minWidth = 0
}) {
  const tracks = String(templateColumns || '').split(' ').map(parseFloat).filter(Number.isFinite);
  const hasCard = Number.isInteger(summaryIndex) && summaryIndex >= 0 && summaryIndex < tracks.length;
  const trailingCard = hasCard && summaryIndex === tracks.length - 1;
  const widths = trailingCard ? tracks.slice(0, -1) : tracks;
  const summaryWidth = hasCard ? tracks[summaryIndex] : 0;
  const gap = parseFloat(columnGap) || 0;
  const left = parseFloat(paddingLeft) || 0;
  const right = parseFloat(paddingRight) || 0;
  return {
    widths,
    gap,
    paddingLeft: left,
    summaryWidth,
    // Inside the layout columns the card's track still carries a column weight.
    summaryIndex: hasCard && !trailingCard ? summaryIndex : -1,
    minWidth: Number(minWidth) || 0,
    // Gaps span every track, including the one before the summary card.
    available: clientWidth - left - right - gap * Math.max(0, tracks.length - 1)
      - (trailingCard ? summaryWidth : 0),
    scrolls: scrollWidth > clientWidth + 1
  };
}

function readSummaryColumnIndex(card, trackCount) {
  const start = parseInt(window.getComputedStyle(card).gridColumnStart, 10);
  // Without a placed start line the card falls back to the trailing column.
  return Number.isInteger(start) && start > 0 ? start - 1 : Math.max(0, trackCount - 1);
}

function readGrid(grid) {
  const style = window.getComputedStyle(grid);
  const tracks = String(style.gridTemplateColumns || '').split(' ').map(parseFloat).filter(Number.isFinite);
  // The card has no resize handle, wherever summary.js placed it.
  const card = [...grid.children].find(element => element.classList.contains('ai-summary-panel'));
  const hasSummaryColumn = Boolean(card && !card.hidden
    && !card.classList.contains('ai-summary-expanded')
    && card.offsetParent !== null);
  return getPanelGridMetrics({
    templateColumns: style.gridTemplateColumns,
    columnGap: style.columnGap,
    paddingLeft: style.paddingLeft,
    paddingRight: style.paddingRight,
    clientWidth: grid.clientWidth,
    scrollWidth: grid.scrollWidth,
    summaryIndex: hasSummaryColumn ? readSummaryColumnIndex(card, tracks.length) : -1,
    minWidth: parseFloat(style.getPropertyValue('--panel-min-width')) || 0
  });
}

/**
 * @param {{
 *   grid: HTMLElement,
 *   getLayout: () => string,
 *   getWideScale?: () => number,
 *   storage: {get: Function, set: Function},
 *   label: string
 * }} options - Does nothing without a grid.
 * @returns {Promise<{refresh: () => void} | undefined>}
 */
export async function setupPanelResize({ grid, getLayout, getWideScale = () => 1, storage, label }) {
  if (!grid) {
    return;
  }
  let weightsByLayout = {};
  try {
    const stored = await storage.get(PANEL_COLUMN_WEIGHTS_KEY);
    weightsByLayout = stored?.[PANEL_COLUMN_WEIGHTS_KEY] || {};
  } catch (error) {
    console.warn('[Panel resize] Could not load column widths:', error);
  }

  const layer = document.createElement('div');
  layer.className = 'panel-resize-handles';
  grid.prepend(layer);
  let drag = null;

  const save = () => {
    storage.set({ [PANEL_COLUMN_WEIGHTS_KEY]: weightsByLayout }).catch((error) => {
      console.warn('[Panel resize] Could not save column widths:', error);
    });
  };

  const renderHandles = () => {
    const { widths, gap, paddingLeft, summaryIndex } = readGrid(grid);
    // The summary card has no handle: skip the gaps on both of its sides.
    const handleIndexes = [];
    for (let index = 0; index < widths.length - 1; index += 1) {
      if (summaryIndex < 0 || (index !== summaryIndex - 1 && index !== summaryIndex)) {
        handleIndexes.push(index);
      }
    }
    while (layer.children.length > handleIndexes.length) {
      layer.lastElementChild.remove();
    }
    while (layer.children.length < handleIndexes.length) {
      const handle = document.createElement('div');
      handle.className = 'panel-resize-handle';
      handle.tabIndex = 0;
      handle.setAttribute('role', 'separator');
      handle.setAttribute('aria-orientation', 'vertical');
      handle.setAttribute('aria-label', label);
      handle.title = label;
      layer.appendChild(handle);
    }
    // Keep the existing elements so a pointer capture survives a refresh.
    let edge = paddingLeft;
    let nextHandle = 0;
    for (let index = 0; index < widths.length - 1; index += 1) {
      edge += widths[index];
      if (handleIndexes[nextHandle] === index) {
        const handle = layer.children[nextHandle];
        handle.dataset.index = String(index);
        handle.style.left = `${edge + gap / 2 - PANEL_RESIZE_HANDLE_WIDTH / 2}px`;
        nextHandle += 1;
      }
      edge += gap;
    }
  };

  const applyWeights = (weights, minWidth, count, available) => {
    const scale = getWideScale();
    if (scale > 1 && count > 1) {
      const columnWeights = weights || Array(count).fill(1);
      grid.style.gridTemplateColumns = getWideColumnTemplate(columnWeights, available, minWidth, scale);
    } else {
      grid.style.gridTemplateColumns = weights ? getColumnTemplate(weights, minWidth) : '';
    }
    renderHandles();
  };

  const applyLayout = () => {
    grid.style.gridTemplateColumns = '';
    const { widths, minWidth, available } = readGrid(grid);
    const weights = weightsByLayout[getLayout()];
    const hasCustomWeights = isValidColumnWeights(weights, widths.length) && widths.length > 1;
    applyWeights(hasCustomWeights ? weights : null, minWidth, widths.length, available);
  };

  const moveEdge = (state, delta) => {
    const widths = resizeColumns(state.widths, state.index, delta, state);
    const scale = getWideScale();
    const minWidth = scale > 1 ? Math.max(state.minWidth, PANEL_WIDE_MIN_WIDTH / scale) : state.minWidth;
    const weights = getColumnWeights(widths, state.available, minWidth).map((weight) =>
      round(weight / (scale > 1 ? scale : 1), 4));
    weightsByLayout[getLayout()] = weights;
    applyWeights(weights, state.minWidth, widths.length, state.available);
  };

  const startState = (handle) => ({ ...readGrid(grid), index: Number(handle.dataset.index) });

  layer.addEventListener('pointerdown', (event) => {
    const handle = event.target.closest('.panel-resize-handle');
    if (!handle || event.button !== 0) {
      return;
    }
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    drag = { ...startState(handle), handle, startX: event.clientX };
    handle.classList.add('active');
    document.body.classList.add('panel-resizing');
  });

  layer.addEventListener('pointermove', (event) => {
    if (drag) {
      moveEdge(drag, event.clientX - drag.startX);
    }
  });

  const endDrag = () => {
    if (!drag) {
      return;
    }
    drag.handle.classList.remove('active');
    drag = null;
    document.body.classList.remove('panel-resizing');
    save();
  };
  layer.addEventListener('pointerup', endDrag);
  layer.addEventListener('pointercancel', endDrag);
  layer.addEventListener('lostpointercapture', endDrag);

  layer.addEventListener('dblclick', (event) => {
    if (!event.target.closest('.panel-resize-handle')) {
      return;
    }
    delete weightsByLayout[getLayout()];
    applyLayout();
    save();
  });

  layer.addEventListener('keydown', (event) => {
    const handle = event.target.closest('.panel-resize-handle');
    const direction = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (!handle || !direction) {
      return;
    }
    event.preventDefault();
    moveEdge(startState(handle), direction * PANEL_RESIZE_KEY_STEP);
    save();
  });

  new MutationObserver(applyLayout).observe(grid, { attributes: true, attributeFilter: ['class'] });
  new ResizeObserver(() => {
    if (getWideScale() > 1) {
      applyLayout();
    } else {
      renderHandles();
    }
  }).observe(grid);
  applyLayout();
  return { refresh: applyLayout };
}
