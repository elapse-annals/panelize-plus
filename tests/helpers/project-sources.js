import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Follow local static imports so source assertions also inspect split files. */
export function collectProjectSources(entryPaths) {
  const sources = new Map();

  function visit(filePath) {
    const absolutePath = path.resolve(PROJECT_ROOT, filePath);
    if (sources.has(absolutePath)) return;
    const source = readFileSync(absolutePath, 'utf8');
    sources.set(absolutePath, source);

    const imports = absolutePath.endsWith('.css')
      ? source.matchAll(/@import\s+(?:url\()?['"]([^'"]+)['"]/g)
      : source.matchAll(/(?:\bfrom\s*|\bimport\s*)['"]([^'"]+)['"]/g);
    for (const [, specifier] of imports) {
      if (specifier.startsWith('.')) visit(path.resolve(path.dirname(absolutePath), specifier));
    }
  }

  entryPaths.forEach(visit);
  return [...sources].map(([filePath, source]) => ({ filePath, source }));
}

export function readProjectSource(filePath) {
  return collectProjectSources([filePath]).map(({ source }) => source).join('\n');
}
