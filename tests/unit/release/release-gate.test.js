import { describe, expect, it } from 'vitest';

import { BUMP_COMMIT_FILES } from '../../../scripts/release/release-utils.js';
import {
  assertReleaseChangedFiles,
  assertReleaseMetadata,
  assertReleaseTargetsMissing,
  buildReleaseNotes,
  extractChangelogSection,
  getReleaseVersionFromBranch
} from '../../../scripts/release/release-gate.js';

const versionState = {
  manifest: '1.2.6',
  packageJson: '1.2.6',
  packageLock: '1.2.6',
  packageLockRootPackage: '1.2.6',
  versionInfo: '1.2.6'
};

describe('release gate', () => {
  it('extracts a version from a release branch', () => {
    expect(getReleaseVersionFromBranch('release/1.2.6')).toBe('1.2.6');
    expect(() => getReleaseVersionFromBranch('fix/release')).toThrow(/release\/x\.y\.z/);
  });

  it('requires exactly the configured release metadata files', () => {
    expect(() => assertReleaseChangedFiles([...BUMP_COMMIT_FILES])).not.toThrow();
    expect(() => assertReleaseChangedFiles([...BUMP_COMMIT_FILES, 'options/options.js']))
      .toThrow(/unexpected/);
    expect(() => assertReleaseChangedFiles(BUMP_COMMIT_FILES.slice(1)))
      .toThrow(/missing/);
  });

  it('validates synchronized release metadata and changelog', () => {
    const changelog = '# Changelog\n\n## 1.2.6 - 2026-07-17\n- Fixed updates\n';
    expect(() => assertReleaseMetadata(versionState, changelog, '1.2.6')).not.toThrow();
    expect(() => assertReleaseMetadata(
      { ...versionState, manifest: '1.2.5' },
      changelog,
      '1.2.6'
    )).toThrow(/out of sync/);
    expect(() => assertReleaseMetadata(versionState, '# Changelog\n', '1.2.6'))
      .toThrow(/missing/);
  });

  it('rejects existing release targets', () => {
    expect(() => assertReleaseTargetsMissing({ tagExists: false, releaseExists: false }, '1.2.6'))
      .not.toThrow();
    expect(() => assertReleaseTargetsMissing({ tagExists: true, releaseExists: false }, '1.2.6'))
      .toThrow(/Tag v1\.2\.6 already exists/);
    expect(() => assertReleaseTargetsMissing({ tagExists: false, releaseExists: true }, '1.2.6'))
      .toThrow(/GitHub Release v1\.2\.6 already exists/);
  });

  it('extracts only the requested changelog section', () => {
    const changelog = [
      '# Changelog',
      '',
      '## 1.2.6 - 2026-07-17',
      '- Fixed updates',
      '',
      '## 1.2.5 - 2026-07-16',
      '- Previous release',
      ''
    ].join('\n');

    expect(extractChangelogSection(changelog, '1.2.6')).toBe(
      '## 1.2.6 - 2026-07-17\n- Fixed updates\n'
    );
    expect(buildReleaseNotes(changelog, '1.2.6')).toContain(
      'Chrome Web Store package: `panelize-1.2.6-cws.zip`'
    );
    expect(buildReleaseNotes(changelog, '1.2.6')).toContain(
      'macOS client (universal, ad-hoc signed): `panelize-link-1.2.6-macos-universal.zip`'
    );
  });
});
