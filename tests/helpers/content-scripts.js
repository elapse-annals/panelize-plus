import { readFileSync } from 'node:fs';
import path from 'node:path';
import { TEXT_INJECTION_FILES, PROVIDER_TIER_FILES } from '../../modules/providers/content-script-files.js';
import { PROJECT_ROOT } from './project-sources.js';

/** Evaluate the same ordered classic scripts that Chrome loads for a frame. */
export function readContentScriptSource(filePath, encoding = 'utf8') {
  const files = [TEXT_INJECTION_FILES, PROVIDER_TIER_FILES].find(
    files => path.resolve(filePath) === path.join(PROJECT_ROOT, files.at(-1))
  );
  if (files) {
    return files.map(file => readFileSync(path.join(PROJECT_ROOT, file), encoding)).join('\n');
  }
  return readFileSync(filePath, encoding);
}
