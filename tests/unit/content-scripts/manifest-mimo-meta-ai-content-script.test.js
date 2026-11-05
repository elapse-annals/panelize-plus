import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(
  readFileSync(resolve(process.cwd(), 'manifest.json'), 'utf8')
);

describe.each([
  ['MiMo', 'aistudio.xiaomimimo.com', 'https://aistudio.xiaomimimo.com/*'],
  ['MiMo session cookies', 'xiaomimimo.com', 'https://xiaomimimo.com/*'],
  ['Xiaomi Account', 'account.xiaomi.com', 'https://account.xiaomi.com/*'],
  ['Meta AI', 'meta.ai', 'https://www.meta.ai/*'],
])('%s manifest permission coverage', (_name, host, origin) => {
  it('declares only an optional host permission', () => {
    expect(manifest.optional_host_permissions).toContain(origin);
    expect(manifest.host_permissions.some((entry) => entry.includes(host))).toBe(false);
  });

  it('uses dynamic content-script registration', () => {
    expect(manifest.content_scripts.some(({ matches }) =>
      matches.some((match) => match.includes(host))
    )).toBe(false);
  });
});
