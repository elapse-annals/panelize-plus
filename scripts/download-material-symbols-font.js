import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(repoRoot, 'fonts/material-symbols-outlined-icons.json');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const axes = 'opsz,wght,FILL,GRAD@24,400,0..1,-25..0';
const query = new URLSearchParams({
  family: `${manifest.family}:${axes}`,
  icon_names: manifest.icons.join(','),
  display: 'block'
});
const cssUrl = `https://fonts.googleapis.com/css2?${query}`;
const headers = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
};

const cssResponse = await fetch(cssUrl, { headers });
if (!cssResponse.ok) {
  throw new Error(`Google Fonts CSS request failed: ${cssResponse.status} ${cssResponse.statusText}`);
}

const css = await cssResponse.text();
const fontUrl = css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)\s*format\(['"]woff2['"]\)/i)?.[1];
if (!fontUrl) {
  throw new Error('Google Fonts did not return a WOFF2 font URL');
}

const fontResponse = await fetch(fontUrl);
if (!fontResponse.ok) {
  throw new Error(`Google Fonts WOFF2 request failed: ${fontResponse.status} ${fontResponse.statusText}`);
}

const font = Buffer.from(await fontResponse.arrayBuffer());
if (font.subarray(0, 4).toString('ascii') !== 'wOF2') {
  throw new Error('Google Fonts response is not a valid WOFF2 file');
}

const outputPath = path.join(repoRoot, 'fonts', manifest.fontFile);
await fs.writeFile(outputPath, font);
console.log(`Saved ${path.relative(repoRoot, outputPath)} (${font.byteLength} bytes)`);
