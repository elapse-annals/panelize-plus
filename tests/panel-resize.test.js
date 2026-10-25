import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PANEL_WIDE_MIN_WIDTH,
  PANEL_WIDE_SCALE,
  PANEL_COLUMN_WEIGHTS_KEY,
  PANEL_RESIZE_MIN_WIDTH,
  getColumnTemplate,
  getColumnWeights,
  getWideColumnTemplate,
  isValidColumnWeights,
  resizeColumns,
  setupPanelResize
} from '../modules/panel-resize.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('resizeColumns', () => {
  it('trades width with the neighbor when the columns fit the window', () => {
    expect(resizeColumns([600, 600, 600], 0, 150, { scrolls: false, available: 1800 }))
      .toEqual([750, 450, 600]);
    expect(resizeColumns([600, 600, 600], 1, -100, { scrolls: false, available: 1800 }))
      .toEqual([600, 500, 700]);
  });

  it('keeps both neighbors at least the minimum width', () => {
    expect(resizeColumns([600, 600], 0, 900, { scrolls: false, available: 1200 }))
      .toEqual([1200 - PANEL_RESIZE_MIN_WIDTH, PANEL_RESIZE_MIN_WIDTH]);
    expect(resizeColumns([600, 600], 0, -900, { scrolls: false, available: 1200 }))
      .toEqual([PANEL_RESIZE_MIN_WIDTH, 1200 - PANEL_RESIZE_MIN_WIDTH]);
  });

  it('does not force columns already narrower than the minimum wider', () => {
    expect(resizeColumns([150, 150], 0, 10, { scrolls: false, available: 300 })).toEqual([150, 150]);
  });

  it('grows a column alone when the columns scroll sideways', () => {
    expect(resizeColumns([320, 320, 320, 320], 1, 100, { scrolls: true, available: 1000 }))
      .toEqual([320, 420, 320, 320]);
  });

  it('shrinks a scrolling column no further than fitting the window again', () => {
    expect(resizeColumns([320, 320, 320, 320], 1, -100, { scrolls: true, available: 1000 }))
      .toEqual([320, 220, 320, 320]);
    expect(resizeColumns([320, 320, 320, 320], 1, -300, { scrolls: true, available: 1240 }))
      .toEqual([320, 280, 320, 320]);
  });
});

describe('getColumnWeights', () => {
  it('weights columns that fit the window by their share of it', () => {
    expect(getColumnWeights([750, 450, 600], 1800, 400)).toEqual([1.25, 0.75, 1]);
  });

  it('weights scrolling columns against the layout minimum', () => {
    expect(getColumnWeights([480, 320, 320], 900, 320)).toEqual([1.5, 1, 1]);
  });

  it('works for layouts without a minimum', () => {
    expect(getColumnWeights([300, 500], 800, 0)).toEqual([0.75, 1.25]);
  });
});

describe('getColumnTemplate', () => {
  it('gives each column a minimum and a share in proportion to its weight', () => {
    expect(getColumnTemplate([1.5, 1], 320)).toBe('minmax(480px, 1.5fr) minmax(320px, 1fr)');
    expect(getColumnTemplate([0.75, 1.25], 0)).toBe('minmax(0px, 0.75fr) minmax(0px, 1.25fr)');
  });

  it('reproduces the dragged widths', () => {
    const widths = [750, 450, 600];
    const weights = getColumnWeights(widths, 1800, 400);
    // 1fr resolves to available / sum(weights) when no minimum binds.
    const fr = 1800 / weights.reduce((total, weight) => total + weight, 0);
    expect(weights.map((weight) => weight * fr)).toEqual(widths);
  });
});

describe('getWideColumnTemplate', () => {
  it('uses fixed columns at one and a half times their base width', () => {
    expect(getWideColumnTemplate([1, 1], 1000, 400)).toBe('750px 750px');
    expect(getWideColumnTemplate([1.25, 0.75], 1800, 400)).toBe('1688px 1013px');
  });

  it('keeps dense and narrow layouts at the reference ChatGPT width', () => {
    expect(getWideColumnTemplate([1, 1], 700, 400)).toBe('672px 672px');
    expect(getWideColumnTemplate(Array(8).fill(1), 1402, 320)).toBe(Array(8).fill('672px').join(' '));
    expect(getWideColumnTemplate([1.25, 0.75], 700, 400)).toBe('840px 504px');
  });
});

describe('isValidColumnWeights', () => {
  it('accepts positive weights for every column only', () => {
    expect(isValidColumnWeights([1, 1.5], 2)).toBe(true);
    expect(isValidColumnWeights([1, 1.5], 3)).toBe(false);
    expect(isValidColumnWeights([1, 0], 2)).toBe(false);
    expect(isValidColumnWeights([1, 'x'], 2)).toBe(false);
    expect(isValidColumnWeights(null, 2)).toBe(false);
  });
});

describe('setupPanelResize', () => {
  it('does nothing on a page without a panel grid', async () => {
    const storage = { get: vi.fn(), set: vi.fn() };
    await expect(setupPanelResize({ grid: null, getLayout: () => '1x3', storage, label: '' }))
      .resolves.toBeUndefined();
    expect(storage.get).not.toHaveBeenCalled();
  });

  it('recomputes wide pixel widths when the grid resizes', async () => {
    let onResize;
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback) { onResize = callback; }
      observe() {}
      disconnect() {}
    });
    const grid = document.createElement('div');
    document.body.append(grid);
    Object.defineProperty(grid, 'clientWidth', { configurable: true, value: 1000, writable: true });
    Object.defineProperty(grid, 'scrollWidth', { configurable: true, value: 1600 });
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => ({
      gridTemplateColumns: element.style.gridTemplateColumns
        || `${(grid.clientWidth - 4) / 2}px ${(grid.clientWidth - 4) / 2}px`,
      columnGap: '4px',
      paddingLeft: '0px',
      paddingRight: '0px',
      getPropertyValue: () => '400px'
    }));

    const storage = { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) };
    const controller = await setupPanelResize({
      grid,
      getLayout: () => '1x2',
      getWideScale: () => PANEL_WIDE_SCALE,
      storage,
      label: 'Resize panels'
    });

    expect(controller).toEqual({ refresh: expect.any(Function) });
    expect(grid.style.gridTemplateColumns).toBe('747px 747px');
    grid.clientWidth = 1200;
    onResize();
    expect(grid.style.gridTemplateColumns).toBe('897px 897px');
  });

  it('stores drag weights without including the wide scale', async () => {
    vi.stubGlobal('ResizeObserver', class {
      constructor() {}
      observe() {}
      disconnect() {}
    });
    const grid = document.createElement('div');
    document.body.append(grid);
    Object.defineProperty(grid, 'clientWidth', { configurable: true, value: 1000 });
    Object.defineProperty(grid, 'scrollWidth', { configurable: true, value: 1600 });
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => ({
      gridTemplateColumns: element.style.gridTemplateColumns || '498px 498px',
      columnGap: '4px',
      paddingLeft: '0px',
      paddingRight: '0px',
      getPropertyValue: () => '400px'
    }));

    const storage = { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) };
    await setupPanelResize({
      grid,
      getLayout: () => '1x2',
      getWideScale: () => PANEL_WIDE_SCALE,
      storage,
      label: 'Resize panels'
    });
    const handle = grid.querySelector('.panel-resize-handle');
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));

    const saved = storage.set.mock.calls.at(-1)?.[0]?.[PANEL_COLUMN_WEIGHTS_KEY]?.['1x2'];
    expect(saved).toHaveLength(2);
    expect(saved[0]).toBeGreaterThan(1);
    expect(saved[0]).toBeLessThan(1.1);
    expect(saved[1]).toBeCloseTo(1);
    expect(grid.style.gridTemplateColumns).toBe('763px 747px');
  });

  it('normalizes dragged widths against the wide minimum and restores them after toggling', async () => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
    });
    const grid = document.createElement('div');
    document.body.append(grid);
    Object.defineProperty(grid, 'clientWidth', { configurable: true, value: 700 });
    Object.defineProperty(grid, 'scrollWidth', { configurable: true, value: 1348 });
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => ({
      gridTemplateColumns: element.style.gridTemplateColumns || '400px 400px',
      columnGap: '4px',
      paddingLeft: '0px',
      paddingRight: '0px',
      getPropertyValue: () => '400px'
    }));

    let scale = PANEL_WIDE_SCALE;
    const storage = { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) };
    const controller = await setupPanelResize({
      grid,
      getLayout: () => '1x2',
      getWideScale: () => scale,
      storage,
      label: 'Resize panels'
    });
    expect(grid.style.gridTemplateColumns).toBe('672px 672px');
    grid.querySelector('.panel-resize-handle').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));

    const weights = storage.set.mock.calls.at(-1)[0][PANEL_COLUMN_WEIGHTS_KEY]['1x2'];
    expect(weights[0]).toBeCloseTo((PANEL_WIDE_MIN_WIDTH + 16) / PANEL_WIDE_MIN_WIDTH, 3);
    expect(weights[1]).toBe(1);
    expect(grid.style.gridTemplateColumns).toBe('688px 672px');
    scale = 1;
    controller.refresh();
    expect(grid.style.gridTemplateColumns).toBe(getColumnTemplate(weights, 400));
    scale = PANEL_WIDE_SCALE;
    controller.refresh();
    expect(grid.style.gridTemplateColumns).toBe('688px 672px');
  });
});
