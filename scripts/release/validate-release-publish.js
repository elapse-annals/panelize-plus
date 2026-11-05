#!/usr/bin/env node

import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  getVersionState,
  isValidSemver,
  readText
} from './release-utils.js';
import {
  assertReleaseMetadata,
  assertReleaseTargetsMissing
} from './release-gate.js';

async function githubRequest(repository, path, token, { allowNotFound = false } = {}) {
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });

  if (allowNotFound && response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`GitHub API request failed (${response.status}) for ${path}`);
  }

  return response.json();
}

async function main() {
  const repoRoot = process.cwd();
  const version = process.env.RELEASE_VERSION || '';
  const repository = process.env.GITHUB_REPOSITORY || '';
  const token = process.env.GITHUB_TOKEN || '';

  if (!isValidSemver(version)) {
    throw new Error(`Invalid release version "${version}". Expected x.y.z`);
  }
  if (!/^[^/]+\/[^/]+$/.test(repository)) {
    throw new Error('GITHUB_REPOSITORY must use owner/repository format');
  }
  if (!token) {
    throw new Error('GITHUB_TOKEN is required');
  }

  const releaseSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8'
  }).trim();

  assertReleaseMetadata(
    await getVersionState(repoRoot),
    await readText(repoRoot, 'CHANGELOG.md'),
    version
  );

  const tag = `v${version}`;
  const [tagReference, release] = await Promise.all([
    githubRequest(repository, `/git/ref/tags/${encodeURIComponent(tag)}`, token, { allowNotFound: true }),
    githubRequest(repository, `/releases/tags/${encodeURIComponent(tag)}`, token, { allowNotFound: true })
  ]);
  assertReleaseTargetsMissing({ tagExists: Boolean(tagReference), releaseExists: Boolean(release) }, version);

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `release_sha=${releaseSha}\n`);
  }

  console.log(`[release-publish] Validated v${version} at ${releaseSha}`);
}

main().catch(error => {
  console.error(`[release-publish] ${error.message}`);
  process.exit(1);
});
