import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KNOWN_LAYOUT_IDS } from '../../../modules/panels/layout-auto-adjust.js';
import { readProjectSource } from '../../helpers/project-sources.js';

const readProjectFile = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

const multiPanelHtml = readProjectFile('multi-panel/multi-panel.html');
const multiPanelCss = readProjectSource('multi-panel/multi-panel.css');
const optionsHtml = readProjectFile('options/options.html');

describe('panel layout options', () => {
  it.each(KNOWN_LAYOUT_IDS)('shows the %s layout in both selectors', (layout) => {
    expect(multiPanelHtml).toContain(`data-layout="${layout}"`);
    expect(optionsHtml).toContain(`<option value="${layout}"`);
  });

  it.each(KNOWN_LAYOUT_IDS)('defines the %s grid and preview styles', (layout) => {
    expect(multiPanelCss).toContain(`.layout-${layout} {`);
    expect(multiPanelCss).toContain(`.layout-${layout}-preview {`);
  });
});
