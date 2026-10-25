import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PACKAGE_INCLUDE_PATHS } from '../scripts/release-utils.js';

const ROOT = process.cwd();
const read = path => readFileSync(resolve(ROOT, path), 'utf8');
const iconManifest = JSON.parse(read('fonts/material-symbols-outlined-icons.json'));

function collectMarkupIcons(source) {
  return Array.from(source.matchAll(
    /<span\b(?=[^>]*\bclass=(['"])[^'"]*\bmaterial-symbols-outlined\b[^'"]*\1)[^>]*>\s*([a-z][a-z0-9_]*)\s*<\/span>/gi
  ), match => match[2]);
}

function collectAssignedIcons(source) {
  const icons = [];
  const iconVariables = new Set(Array.from(source.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;]*?\.querySelector\(['"]\.material-symbols-outlined['"]\)/g
  ), match => match[1]));
  const assignments = [
    ...source.matchAll(/\.querySelector\(['"]\.material-symbols-outlined['"]\)\.(?:textContent|innerText)\s*=\s*([^;]+);/g)
  ];

  for (const variable of iconVariables) {
    const escapedVariable = variable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const aliasAssignments = new RegExp(
      `\\b${escapedVariable}\\.(?:textContent|innerText)\\s*=\\s*([^;]+);`,
      'g'
    );
    assignments.push(...source.matchAll(aliasAssignments));
  }

  for (const [, expression] of assignments) {
    icons.push(...Array.from(expression.matchAll(/['"]([a-z][a-z0-9_]*)['"]/gi), match => match[1]));
  }

  return icons;
}

function collectCssContentIcons(source) {
  return Array.from(source.matchAll(/\bcontent\s*:\s*(['"])([a-z][a-z0-9_]*)\1/gi), match => match[2]);
}

describe('Material Symbols font subset', () => {
  it('contains every icon name used by both extension pages', () => {
    const sourceFiles = [
      'multi-panel/multi-panel.html',
      'multi-panel/multi-panel.js',
      'multi-panel/multi-panel.css',
      'options/options.html',
      'options/options.js',
      'options/options.css'
    ];
    const usedIcons = sourceFiles.flatMap(path => {
      const source = read(path);
      return [
        ...collectMarkupIcons(source),
        ...collectAssignedIcons(source),
        ...collectCssContentIcons(source)
      ];
    });

    expect([...new Set(iconManifest.icons)].sort()).toEqual([...iconManifest.icons].sort());
    expect([...new Set(usedIcons)].sort()).toEqual([...iconManifest.icons].sort());
  });

  it('uses and packages the local WOFF2 asset', () => {
    const fontPath = resolve(ROOT, 'fonts', iconManifest.fontFile);
    const fontBytes = readFileSync(fontPath);
    const fontFace = read('multi-panel/multi-panel.css');
    const optionsFontFace = read('options/options.css');

    expect(fontBytes.subarray(0, 4).toString('ascii')).toBe('wOF2');
    expect(statSync(fontPath).size).toBeLessThan(100 * 1024);
    expect(fontFace).toContain("font-display: block");
    expect(fontFace).toContain("url('../fonts/material-symbols-outlined.woff2') format('woff2')");
    expect(optionsFontFace).toContain("url('../fonts/material-symbols-outlined.woff2') format('woff2')");
    expect(PACKAGE_INCLUDE_PATHS).toContain('fonts');
  });

  it('preloads the local font and does not request Google Fonts', () => {
    for (const page of ['multi-panel/multi-panel.html', 'options/options.html']) {
      const html = read(page);
      expect(html).toContain('rel="preload"');
      expect(html).toContain('../fonts/material-symbols-outlined.woff2');
      expect(html).not.toMatch(/fonts\.(?:googleapis|gstatic)\.com/i);
    }
  });
});
