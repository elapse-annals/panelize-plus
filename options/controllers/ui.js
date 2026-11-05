/** Ui helpers shared by this page's controllers. */
import { t } from '../../modules/platform/i18n.js';
import { normalizeLocale } from '../../modules/platform/locale.js';

function fitSelectWidth(select) {
  if (!(select instanceof HTMLSelectElement)) {
    return;
  }

  const selectedOption = select.options[select.selectedIndex];
  const text = selectedOption?.textContent || select.value || '';
  const sizingProbe = document.createElement('span');
  const computedStyle = window.getComputedStyle(select);

  sizingProbe.textContent = text;
  sizingProbe.style.position = 'absolute';
  sizingProbe.style.visibility = 'hidden';
  sizingProbe.style.whiteSpace = 'pre';
  sizingProbe.style.font = computedStyle.font;
  sizingProbe.style.fontSize = computedStyle.fontSize;
  sizingProbe.style.fontWeight = computedStyle.fontWeight;
  sizingProbe.style.letterSpacing = computedStyle.letterSpacing;

  document.body.appendChild(sizingProbe);
  const measuredWidth = Math.ceil(sizingProbe.getBoundingClientRect().width);
  sizingProbe.remove();

  const horizontalPadding = (parseFloat(computedStyle.paddingLeft) || 0) +
    (parseFloat(computedStyle.paddingRight) || 0);
  const horizontalBorder = (parseFloat(computedStyle.borderLeftWidth) || 0) +
    (parseFloat(computedStyle.borderRightWidth) || 0);
  const safetyAllowance = 8;

  select.style.width = `${Math.max(
    56,
    Math.ceil(measuredWidth + horizontalPadding + horizontalBorder + safetyAllowance)
  )}px`;
}

function setupAutoSizedSelect(select) {
  if (!(select instanceof HTMLSelectElement) || select.dataset.autoSizeBound === 'true') {
    fitSelectWidth(select);
    return;
  }

  select.dataset.autoSizeBound = 'true';
  select.addEventListener('change', () => {
    fitSelectWidth(select);
  });

  fitSelectWidth(select);
}

function refreshAutoSizedSelects(root = document) {
  root.querySelectorAll('select').forEach((select) => {
    setupAutoSizedSelect(select);
  });
}

function isEdgeBrowser() {
  const uaData = navigator.userAgentData;
  if (uaData && Array.isArray(uaData.brands)) {
    return uaData.brands.some(brand => /Edge/i.test(brand.brand));
  }
  return navigator.userAgent.includes('Edg/');
}

function openShortcutSettings(browserOverride) {
  const isEdge = browserOverride === 'edge' || (browserOverride !== 'chrome' && isEdgeBrowser());
  const url = isEdge ? 'edge://extensions/shortcuts' : 'chrome://extensions/shortcuts';

  try {
    chrome.tabs.create({ url });
  } catch (error) {
    // Fallback to window.open if chrome.tabs unavailable
    window.open(url, '_blank');
  }
}

function getExtensionResourceUrl(path) {
  if (chrome?.runtime?.getURL) {
    return chrome.runtime.getURL(path);
  }
  return new URL(path, `${window.location.origin}/`).href;
}

function getPromptGuidePath(locale) {
  const guidePaths = {
    en: 'data/prompt-libraries/guide.en.html',
    zh_CN: 'data/prompt-libraries/guide.zh_CN.html'
  };

  return guidePaths[normalizeLocale(locale)];
}

function setupShortcutHelpers() {
  const openShortcutsBtn = document.getElementById('open-shortcuts-btn');
  if (openShortcutsBtn) {
    openShortcutsBtn.addEventListener('click', () => openShortcutSettings());
  }

  const edgeHelper = document.getElementById('edge-shortcut-helper');
  const edgeButton = document.getElementById('open-edge-shortcuts-btn');

  if (edgeHelper && edgeButton) {
    edgeButton.addEventListener('click', () => openShortcutSettings('edge'));
  }
}

function translated(key, fallback) {
  const message = t(key);
  return message && message !== key ? message : fallback;
}

// Status message helpers
function showStatus(type, message) {
  const elementId = type === 'error' ? 'status-error' : 'status-success';
  const element = document.getElementById(elementId);

  element.textContent = message;
  element.classList.add('show');

  setTimeout(() => {
    element.classList.remove('show');
  }, 3000);
}

// Toast notification helper - lightweight, non-intrusive notifications
function showToast(type, messageKey, params = []) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  // Get translated message
  const message = t(messageKey, params);

  // Create toast element
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  // Icon based on type
  const icons = {
    success: '✓',
    error: '✕',
    info: 'ℹ'
  };

  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || '•'}</span>
    <span class="toast-message">${message}</span>
  `;

  container.appendChild(toast);

  // Auto remove after 3 seconds
  setTimeout(() => {
    toast.classList.add('hiding');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 3000);
}

export { fitSelectWidth, getExtensionResourceUrl, getPromptGuidePath, isEdgeBrowser, refreshAutoSizedSelects, setupShortcutHelpers, showStatus, showToast, translated };
