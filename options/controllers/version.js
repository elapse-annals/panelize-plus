/**
 * Owns version behavior and its page-local state.
 * Deferred controller getters keep composition in the entry point.
 */
import { loadVersionInfo, checkForUpdates } from '../../modules/platform/version-checker.js';
import { t } from '../../modules/platform/i18n.js';
import { showStatus } from './ui.js';

export function createVersionController() {
  // T073: Version Check Functions
  async function loadVersionDisplay(shouldCheckForUpdates = true) {
    const versionInfo = await loadVersionInfo();
    if (!versionInfo) {
      document.getElementById('version').textContent = t('msgVersionUnknown');
      document.getElementById('commit-hash').textContent = '';
      return;
    }

    document.getElementById('version').textContent = t('labelVersion', versionInfo.version);
    // Hide commit-hash element since we no longer use it
    const commitHashEl = document.getElementById('commit-hash');
    if (commitHashEl) {
      commitHashEl.style.display = 'none';
    }

    if (shouldCheckForUpdates) {
      await performVersionCheck();
    }
  }

  async function performVersionCheck() {
    const button = document.getElementById('check-updates-btn');
    const statusDiv = document.getElementById('update-status');
    const downloadLink = document.getElementById('download-latest-link');

    try {
      button.disabled = true;
      button.textContent = t('msgChecking');
      statusDiv.style.display = 'none';

      const result = await checkForUpdates();

      if (downloadLink) {
        downloadLink.href = result.downloadUrl || result.releaseUrl;
      }

      if (result.error) {
        statusDiv.textContent = result.error;
        statusDiv.className = 'update-status update-error';
        statusDiv.style.display = 'block';
        showStatus('error', result.error);
      } else if (result.updateAvailable) {
        const latest = result.latestVersion;
        const current = result.currentVersion;
        statusDiv.innerHTML = t('msgUpdateStatusAvailable', [latest, current]);
        statusDiv.className = 'update-status update-available';
        statusDiv.style.display = 'block';
        showStatus('success', t('msgUpdateAvailable'));
      } else {
        statusDiv.textContent = t('msgLatestVersion');
        statusDiv.className = 'update-status update-current';
        statusDiv.style.display = 'block';
        showStatus('success', t('msgUpToDate'));
      }
    } catch (error) {
      statusDiv.textContent = t('msgCheckUpdatesFailed');
      statusDiv.className = 'update-status update-error';
      statusDiv.style.display = 'block';
      showStatus('error', t('msgCheckUpdatesFailed'));
      console.error('Version check error:', error);
    } finally {
      button.disabled = false;
      button.textContent = t('btnCheckUpdates');
    }
  }

  return {
    loadVersionDisplay,
    performVersionCheck,
  };
}
