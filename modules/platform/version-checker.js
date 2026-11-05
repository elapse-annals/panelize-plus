// T073: Version Check Module
// Checks for updates by comparing manifest version with GitHub

import { t } from './i18n.js';
import { compareVersions } from './version-utils.js';

const GITHUB_LATEST_RELEASE_URL = 'https://api.github.com/repos/elapse-annals/panelize-plus/releases/latest';
const GITHUB_RELEASES_URL = 'https://github.com/elapse-annals/panelize-plus/releases/latest';
// Release prep keeps this file in step with manifest.json. Raw content is not
// subject to the REST API's per-IP rate limit.
const GITHUB_RAW_VERSION_INFO_URL = 'https://raw.githubusercontent.com/elapse-annals/panelize-plus/master/data/version-info.json';
const REQUEST_TIMEOUT_MS = 10000;

/**
 * @typedef {Object} LatestReleaseInfo
 * @property {string} version
 * @property {string} releaseUrl
 * @property {string} downloadUrl
 */

/**
 * @typedef {Object} UpdateCheckResult
 * @property {boolean} updateAvailable
 * @property {string|null} currentVersion
 * @property {string|null} latestVersion
 * @property {string} releaseUrl
 * @property {string} downloadUrl
 * @property {string|null} error
 */

/**
 * Load local manifest version
 * @returns {Promise<Object>} {version, manifest}
 */
export async function loadVersionInfo() {
  try {
    const manifest = chrome.runtime.getManifest();
    return {
      version: manifest.version,
      manifest: manifest
    };
  } catch (error) {
    console.error('Error loading manifest:', error);
    return null;
  }
}

/**
 * Fetch the latest published release from GitHub.
 *
 * @returns {Promise<LatestReleaseInfo|null>} Latest release or null on error.
 */
export async function fetchLatestRelease() {
  try {
    const response = await fetch(GITHUB_LATEST_RELEASE_URL, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    if (!response.ok) {
      throw new Error(`GitHub fetch error: ${response.status}`);
    }

    const release = await response.json();
    const versionMatch = /^v?(\d+\.\d+\.\d+)$/.exec(release.tag_name ?? '');

    if (!versionMatch || typeof release.html_url !== 'string') {
      throw new Error('GitHub release metadata is invalid');
    }

    const version = versionMatch[1];
    const expectedAssetName = `panelize-${version}-release.zip`;
    const releaseAsset = Array.isArray(release.assets)
      ? release.assets.find(asset => asset?.name === expectedAssetName)
      : null;

    return {
      version,
      releaseUrl: release.html_url,
      downloadUrl: releaseAsset?.browser_download_url || release.html_url
    };
  } catch (error) {
    console.error('Error fetching latest GitHub release:', error);
    return null;
  }
}

/**
 * Read the version published with the repository's release metadata.
 *
 * This is the fallback when the REST API is rate limited or unreachable: the
 * raw file still answers, and the release page is the download destination.
 *
 * @returns {Promise<LatestReleaseInfo|null>} Published version or null on error.
 */
export async function fetchPublishedVersionInfo() {
  try {
    const response = await fetch(GITHUB_RAW_VERSION_INFO_URL, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    if (!response.ok) {
      throw new Error(`GitHub raw fetch error: ${response.status}`);
    }

    const info = await response.json();
    const versionMatch = /^(\d+\.\d+\.\d+)$/.exec(info?.version ?? '');

    if (!versionMatch) {
      throw new Error('Published version metadata is invalid');
    }

    return {
      version: versionMatch[1],
      releaseUrl: GITHUB_RELEASES_URL,
      downloadUrl: GITHUB_RELEASES_URL
    };
  } catch (error) {
    console.error('Error fetching published version info:', error);
    return null;
  }
}

/**
 * Check if an update is available
 * @returns {Promise<UpdateCheckResult>} Update status.
 */
export async function checkForUpdates() {
  const localInfo = await loadVersionInfo();
  if (!localInfo) {
    return {
      updateAvailable: false,
      currentVersion: null,
      latestVersion: null,
      releaseUrl: GITHUB_RELEASES_URL,
      downloadUrl: GITHUB_RELEASES_URL,
      error: t('errVersionInfoFailed')
    };
  }

  const latestRelease = await fetchLatestRelease() ?? await fetchPublishedVersionInfo();
  if (!latestRelease) {
    return {
      updateAvailable: false,
      currentVersion: localInfo.version,
      latestVersion: null,
      releaseUrl: GITHUB_RELEASES_URL,
      downloadUrl: GITHUB_RELEASES_URL,
      error: t('msgCheckUpdatesFailed')
    };
  }

  const comparison = compareVersions(localInfo.version, latestRelease.version);
  const updateAvailable = comparison < 0;

  return {
    updateAvailable,
    currentVersion: localInfo.version,
    latestVersion: latestRelease.version,
    releaseUrl: latestRelease.releaseUrl,
    downloadUrl: latestRelease.downloadUrl,
    error: null
  };
}

/**
 * Get the latest releases page URL.
 *
 * @returns {string} GitHub releases URL.
 */
export function getReleasesUrl() {
  return GITHUB_RELEASES_URL;
}
