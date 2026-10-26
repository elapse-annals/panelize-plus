import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LAYOUT_PANEL_COUNTS } from '../modules/layout-auto-adjust.js';

const readProjectFile = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

const multiPanelHtml = readProjectFile('multi-panel/multi-panel.html');
const multiPanelCss = readProjectFile('multi-panel/multi-panel.css');
const optionsHtml = readProjectFile('options/options.html');

describe('panel layout options', () => {
  it.each(Object.keys(LAYOUT_PANEL_COUNTS))('shows the %s layout in both selectors', (layout) => {
    expect(multiPanelHtml).toContain(`data-layout="${layout}"`);
    expect(optionsHtml).toContain(`<option value="${layout}"`);
  });

  it.each(Object.keys(LAYOUT_PANEL_COUNTS))('defines the %s grid and preview styles', (layout) => {
    expect(multiPanelCss).toContain(`.layout-${layout} {`);
    expect(multiPanelCss).toContain(`.layout-${layout}-preview {`);
  });
});
