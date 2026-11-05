/** Ui helpers shared by this page's controllers. */
import { getProviderById, getProviderIcon } from '../../modules/providers/providers.js';
import { t } from '../../modules/platform/i18n.js';

function getThemeAwareProviderIcon(provider) {
  return getProviderIcon(provider);
}

function isDarkThemeActive() {
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

function getDropdownThemePalette() {
  if (isDarkThemeActive()) {
    return {
      menuBackground: '#2d2d2d',
      menuBorder: '#444',
      menuText: '#e0e0e0',
      itemHoverBackground: '#3a3a3a',
      selectedBackground: '#1a3a5a',
      selectedText: '#64b5f6'
    };
  }

  return {
    menuBackground: 'white',
    menuBorder: '#e0e0e0',
    menuText: '#333',
    itemHoverBackground: '#f5f5f5',
    selectedBackground: '#e3f2fd',
    selectedText: '#1976d2'
  };
}

function getLocalizedText(key, fallback, substitutions = null) {
  const message = t(key, substitutions);
  const fallbackValues = substitutions === null
    ? []
    : (Array.isArray(substitutions) ? substitutions : [substitutions]);
  const resolvedFallback = fallbackValues.reduce(
    (text, value, index) => text.replaceAll(`$${index + 1}`, value),
    fallback
  );
  return message && message !== key ? message : resolvedFallback;
}

function refreshThemeAwareProviderIcons() {
  document.querySelectorAll('img[data-provider-id]').forEach((img) => {
    const provider = getProviderById(img.dataset.providerId);
    if (!provider) return;
    img.src = getThemeAwareProviderIcon(provider);
  });
}

function isModalOpen(modal) {
  return Boolean(modal) && window.getComputedStyle(modal).display !== 'none';
}

function isAnyModalOpen() {
  return Array.from(document.querySelectorAll('.modal')).some(isModalOpen);
}

function isFocusInOpenModal() {
  const modal = document.activeElement?.closest?.('.modal');
  return Boolean(modal) && modal.style.display !== 'none';
}

function isGoogleProvider(providerId) {
  return providerId === 'google';
}

function isChatgptProvider(providerId) {
  return providerId === 'chatgpt';
}

function fitPanelSelectWidth(select) {
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
  const safetyAllowance = 6;

  select.style.width = `${Math.max(
    72,
    Math.ceil(measuredWidth + horizontalPadding + horizontalBorder + safetyAllowance)
  )}px`;
}

// ===== Utility Functions =====
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'panelize-toast';
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 100px;
    left: 50%;
    transform: translateX(-50%);
    background: #333;
    color: white;
    padding: 12px 24px;
    border-radius: 8px;
    font-size: 14px;
    z-index: 10000;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  `;

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

export { escapeHtml, fitPanelSelectWidth, getDropdownThemePalette, getLocalizedText, getThemeAwareProviderIcon, isAnyModalOpen, isChatgptProvider, isFocusInOpenModal, isGoogleProvider, isModalOpen, refreshThemeAwareProviderIcons, showToast };
