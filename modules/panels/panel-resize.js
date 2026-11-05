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

function readGrid(grid) {
  const style = window.getComputedStyle(grid);
  const widths = style.gridTemplateColumns.split(' ').map(parseFloat).filter(Number.isFinite);
  const gap = parseFloat(style.columnGap) || 0;
  const paddingLeft = parseFloat(style.paddingLeft) || 0;
  const paddingRight = parseFloat(style.paddingRight) || 0;
  return {
    widths,
    gap,
    paddingLeft,
    minWidth: parseFloat(style.getPropertyValue('--panel-min-width')) || 0,
    available: grid.clientWidth - paddingLeft - paddingRight - gap * Math.max(0, widths.length - 1),
    scrolls: grid.scrollWidth > grid.clientWidth + 1
  };
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
    const { widths, gap, paddingLeft } = readGrid(grid);
    const count = Math.max(0, widths.length - 1);
    while (layer.children.length > count) {
      layer.lastElementChild.remove();
    }
    while (layer.children.length < count) {
      const handle = document.createElement('div');
      handle.className = 'panel-resize-handle';
      handle.tabIndex = 0;
      handle.setAttribute('role', 'separator');
      handle.setAttribute('aria-orientation', 'vertical');
      handle.setAttribute('aria-label', label);
      handle.title = label;
      handle.dataset.index = String(layer.children.length);
      layer.appendChild(handle);
    }
    let edge = paddingLeft;
    Array.from(layer.children).forEach((handle, index) => {
      edge += widths[index];
      handle.style.left = `${edge + gap / 2 - PANEL_RESIZE_HANDLE_WIDTH / 2}px`;
      edge += gap;
    });
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
