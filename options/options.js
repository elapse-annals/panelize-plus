// T050-T064: Settings Page Implementation
import { PROVIDERS, getProviderIcon } from '../modules/providers.js';
import { DEFAULT_PROVIDER_IDS } from '../modules/provider-defaults.js';
import { appendProviderToOrder, normalizeProviderOrder } from '../modules/provider-order.js';
import {
  getFrequentProviderOrder,
  normalizeProviderSortMode,
  PROVIDER_SORT_MODE_FREQUENT
} from '../modules/provider-ranking.js';
import { normalizeStartupProviders } from '../modules/startup-providers.js';
import { getProviderBillingType, PROVIDER_BILLING_TYPES } from '../modules/provider-billing.js';
import {
  hasOptionalProviderPermission,
  requestOptionalProviderPermission,
  requestOptionalProvidersPermission
} from '../modules/optional-provider-access.js';
import { getSettings, getSetting, saveSettings, saveSetting, resetSettings, exportSettings, importSettings } from '../modules/settings.js';
import {
  DEFAULT_GOOGLE_PROVIDER_MODE,
  GOOGLE_PROVIDER_MODE_AI,
  GOOGLE_PROVIDER_MODE_SEARCH,
  normalizeGoogleProviderMode
} from '../modules/google-mode.js';
import { applyTheme } from '../modules/theme-manager.js';
import {
  getSummaryOriginPattern,
  isSummaryConfigured,
  requestSummary
} from '../modules/ai-summary.js';
import {
  AI_SUMMARY_ACTIVE_PROFILE_STORAGE_KEY,
  AI_SUMMARY_API_KEYS_STORAGE_KEY,
  AI_SUMMARY_PROFILES_STORAGE_KEY,
  MAX_AI_SUMMARY_PROFILES,
  createAiSummaryProfileId,
  getAiSummaryProfileLabel,
  loadAiSummarySetup,
  saveAiSummarySetup
} from '../modules/ai-summary-profiles.js';
import {
  getAllPrompts,
  savePrompt,
  exportPrompts,
  importPrompts,
  clearAllPrompts,
  importDefaultLibrary
} from '../modules/prompt-manager.js';
import { restoreDefaultModePrompts } from '../modules/prompt-modes.js';
import {
  loadVersionInfo,
  checkForUpdates
} from '../modules/version-checker.js';
import { t, translatePage, initializeLanguage } from '../modules/i18n.js';
import { normalizeLocale } from '../modules/locale.js';
import {
  DEFAULT_TIER_RECIPES,
  PROVIDER_TIER_IDS,
  TIER_RECIPE_PROVIDERS,
  buildTierRecipeOverrides,
  getEffectiveTierRecipes,
  tierRecipeFromFields,
  tierRecipeToFields
} from '../modules/provider-tiers.js';
const DEFAULT_ENABLED_PROVIDERS = DEFAULT_PROVIDER_IDS;

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

function getGoogleProviderModeOrDefault(settings) {
  return normalizeGoogleProviderMode(settings.googleProviderMode || DEFAULT_GOOGLE_PROVIDER_MODE);
}

function renderGoogleModeSelectMarkup(currentMode, isEnabled) {
  const normalizedMode = normalizeGoogleProviderMode(currentMode);
  return `
    <select
      class="google-mode-select"
      data-google-mode-select="true"
      ${isEnabled ? '' : 'disabled'}
      title="Google provider mode"
    >
      <option value="${GOOGLE_PROVIDER_MODE_AI}" ${normalizedMode === GOOGLE_PROVIDER_MODE_AI ? 'selected' : ''}>AI Mode</option>
      <option value="${GOOGLE_PROVIDER_MODE_SEARCH}" ${normalizedMode === GOOGLE_PROVIDER_MODE_SEARCH ? 'selected' : ''}>Search</option>
    </select>
  `;
}

function getEnabledProvidersOrDefault(settings) {
  if (settings.enabledProviders && Array.isArray(settings.enabledProviders)) {
    return [...settings.enabledProviders];
  }
  return [...DEFAULT_ENABLED_PROVIDERS];
}

function getProviderDisplayOrder(settings) {
  const allIds = PROVIDERS.map(provider => provider.id);
  return normalizeProviderOrder(settings.providerOrder, allIds);
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

// Helper to detect if extension is installed from Chrome Web Store
async function isWebStoreInstall() {
  try {
    const info = await chrome.management.getSelf();
    // installType: 'normal' = Chrome Web Store, 'development' = loaded unpacked
    return info.installType === 'normal';
  } catch (error) {
    console.error('Error detecting install type:', error);
    // Default to false (show update checking) if detection fails
    return false;
  }
}

// Hide update checking UI for web store installations
async function hideUpdateCheckingIfNeeded() {
  const isFromStore = await isWebStoreInstall();

  if (isFromStore) {
    // Hide "Check for Updates" button
    const checkUpdatesBtn = document.getElementById('check-updates-btn');
    if (checkUpdatesBtn) {
      checkUpdatesBtn.style.display = 'none';
    }

    // Hide update status message area
    const updateStatus = document.getElementById('update-status');
    if (updateStatus) {
      updateStatus.style.display = 'none';
    }

    // Hide "Download Latest Version" link
    const downloadLink = document.getElementById('download-latest-link');
    if (downloadLink) {
      const downloadContainer = downloadLink.closest('.version-download');
      if (downloadContainer) {
        downloadContainer.style.display = 'none';
      }
    }
  }

  return isFromStore;
}

function updateShortcutHelperVisibility(isEnabled) {
  const edgeHelper = document.getElementById('edge-shortcut-helper');
  if (!edgeHelper) return;

  if (isEdgeBrowser() && isEnabled) {
    edgeHelper.style.display = 'flex';
  } else {
    edgeHelper.style.display = 'none';
  }
}


// T050: Initialize settings page
async function init() {
  await applyTheme();  // Apply theme first
  await initializeLanguage();  // Initialize language from user settings
  translatePage();  // Translate all static text
  await loadSettings();
  await loadDataStats();
  const isFromWebStore = await hideUpdateCheckingIfNeeded();
  await loadVersionDisplay(!isFromWebStore);  // T073: Load and display version info
  await renderProviderList();
  await renderTierRecipeEditor();
  setupEventListeners();
  setupStorageChangeListener();
  setupPermissionChangeListeners();
  setupProviderAccessNotice();
  setupShortcutHelpers();
  refreshAutoSizedSelects();
  focusHashTarget();
  window.addEventListener('hashchange', focusHashTarget);
}

// The macOS client opens this page with a fragment so the user lands on the
// switch that reconnects the global input bridge instead of the page top.
function focusHashTarget() {
  const id = location.hash.slice(1);
  if (!id) return;
  const element = document.getElementById(id);
  const row = element?.closest('.setting-item') || element;
  if (!row) return;
  row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  row.classList.add('setting-highlight');
  setTimeout(() => row.classList.remove('setting-highlight'), 2400);
}

// T051: Load and display current settings
async function loadSettings() {
  const settings = await getSettings();

  // Theme
  document.getElementById('theme-select').value = settings.theme || 'auto';

  // Language
  const currentLanguage = settings.language;
  document.getElementById('language-select').value = currentLanguage;

  const keyboardShortcutEnabled = settings.keyboardShortcutEnabled !== false;
  const shortcutToggle = document.getElementById('keyboard-shortcut-toggle');
  if (shortcutToggle) {
    shortcutToggle.checked = keyboardShortcutEnabled;
  }
  updateShortcutHelperVisibility(keyboardShortcutEnabled);

  const providerSortModeSelect = document.getElementById('provider-sort-mode-select');
  if (providerSortModeSelect) {
    providerSortModeSelect.value = normalizeProviderSortMode(settings.providerSortMode);
  }

  // Source URL placement setting
  const sourceUrlPlacementSelect = document.getElementById('source-url-placement-select');
  if (sourceUrlPlacementSelect) {
    sourceUrlPlacementSelect.value = settings.sourceUrlPlacement || 'none';
  }

  // Open mode setting
  const openModeSelect = document.getElementById('open-mode-select');
  if (openModeSelect) {
    openModeSelect.value = settings.openMode || 'tab';
  }

  // Share snapshot watermark setting
  const shareWatermarkToggle = document.getElementById('share-watermark-toggle');
  if (shareWatermarkToggle) {
    shareWatermarkToggle.checked = settings.shareWatermarkEnabled !== false;
  }

  // Answer complete notification setting
  const answerCompleteNotificationToggle = document.getElementById('answer-complete-notification-toggle');
  if (answerCompleteNotificationToggle) {
    answerCompleteNotificationToggle.checked = settings.answerCompleteNotificationEnabled !== false;
  }

  // macOS global input bridge (off unless explicitly enabled)
  const globalSendBridgeToggle = document.getElementById('global-send-bridge-toggle');
  if (globalSendBridgeToggle) {
    globalSendBridgeToggle.checked = settings.globalSendBridgeEnabled === true;
  }

  await loadAiSummarySettings(settings);

  // Enter key behavior settings
  const enterBehavior = settings.enterKeyBehavior || {
    enabled: true,
    preset: 'default',
    newlineModifiers: { shift: true, ctrl: false, alt: false, meta: false },
    sendModifiers: { shift: false, ctrl: false, alt: false, meta: false }
  };

  const enterBehaviorToggle = document.getElementById('enter-behavior-toggle');
  if (enterBehaviorToggle) {
    enterBehaviorToggle.checked = enterBehavior.enabled;
    updateEnterBehaviorVisibility(enterBehavior.enabled);
  }

  const enterPresetSelect = document.getElementById('enter-preset-select');
  if (enterPresetSelect) {
    enterPresetSelect.value = enterBehavior.preset || 'default';
    updateCustomEnterSettingsVisibility(enterBehavior.preset);
  }

  // Load custom settings
  loadCustomEnterSettings(enterBehavior);
  refreshAutoSizedSelects();
}

// T052-T053: Render provider enable/disable toggles with drag-and-drop reordering
const TIER_COLUMN_LABELS = {
  fast: ['composerTierFast', 'Fast'],
  balanced: ['composerTierBalanced', 'Balanced'],
  deep: ['composerTierDeep', 'Deep']
};

function translated(key, fallback) {
  const message = t(key);
  return message && message !== key ? message : fallback;
}

function createRecipeInput(providerId, tier, field, value, label) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'tier-recipe-input';
  input.value = value;
  input.placeholder = label;
  input.maxLength = 120;
  input.dataset.provider = providerId;
  input.dataset.tier = tier;
  input.dataset.field = field;
  input.setAttribute('aria-label', label);
  return input;
}

// The options page lists every recipe provider, enabled or not, so a
// mapping can be prepared before the provider is turned on.
async function renderTierRecipeEditor() {
  const table = document.getElementById('tier-recipe-table');
  if (!table) return;
  const overrides = await getSetting('providerTierRecipes');
  const modelLabel = translated('labelTierModel', 'Model');
  const thinkingLabel = translated('labelTierThinking', 'Thinking');
  table.replaceChildren();

  const head = table.createTHead().insertRow();
  [translated('labelTierProvider', 'AI'), ...PROVIDER_TIER_IDS.map(tier => translated(...TIER_COLUMN_LABELS[tier]))]
    .forEach(text => {
      const cell = document.createElement('th');
      cell.textContent = text;
      head.append(cell);
    });

  const body = table.createTBody();
  TIER_RECIPE_PROVIDERS.forEach(providerId => {
    const provider = PROVIDERS.find(candidate => candidate.id === providerId);
    if (!provider) return;
    const recipes = getEffectiveTierRecipes(providerId, overrides);
    const row = body.insertRow();
    const nameCell = document.createElement('th');
    nameCell.scope = 'row';
    nameCell.textContent = provider.name;
    row.append(nameCell);
    PROVIDER_TIER_IDS.forEach(tier => {
      const cell = row.insertCell();
      const fields = tierRecipeToFields(recipes[tier]);
      if (fields.toggleOn !== null) {
        const label = document.createElement('label');
        label.className = 'tier-recipe-toggle';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = fields.toggleOn;
        checkbox.dataset.provider = providerId;
        checkbox.dataset.tier = tier;
        checkbox.dataset.field = 'toggleOn';
        label.append(checkbox, document.createTextNode(` ${thinkingLabel}`));
        // Yuanbao pairs a model pick with its DeepThink toggle.
        if (DEFAULT_TIER_RECIPES[providerId][tier].some(item => item.kind === 'model')) {
          cell.append(createRecipeInput(providerId, tier, 'model', fields.model, modelLabel));
        }
        cell.append(label);
        return;
      }
      cell.append(
        createRecipeInput(providerId, tier, 'model', fields.model, modelLabel),
        createRecipeInput(providerId, tier, 'thinking', fields.thinking, thinkingLabel)
      );
    });
  });
}

async function saveTierRecipesFromEditor() {
  const table = document.getElementById('tier-recipe-table');
  const fieldsByCell = {};
  table.querySelectorAll('[data-provider][data-tier][data-field]').forEach(control => {
    const { provider, tier, field } = control.dataset;
    fieldsByCell[provider] ??= {};
    fieldsByCell[provider][tier] ??= {};
    fieldsByCell[provider][tier][field] = control.type === 'checkbox' ? control.checked : control.value;
  });
  const recipes = Object.fromEntries(Object.entries(fieldsByCell).map(([provider, tiers]) => [
    provider,
    Object.fromEntries(Object.entries(tiers).map(([tier, fields]) => [tier, tierRecipeFromFields(provider, tier, fields)]))
  ]));
  await saveSetting('providerTierRecipes', buildTierRecipeOverrides(recipes));
  showToast('success', 'toastTierRecipesSaved');
}

async function renderProviderList() {
  const settings = await getSettings();
  const enabledProviders = getEnabledProvidersOrDefault(settings);
  const googleProviderMode = getGoogleProviderModeOrDefault(settings);
  const manualDisplayOrder = getProviderDisplayOrder(settings);
  const sortMode = normalizeProviderSortMode(settings.providerSortMode);
  const allProviderIds = PROVIDERS.map(provider => provider.id);
  const displayOrder = sortMode === PROVIDER_SORT_MODE_FREQUENT
    ? await getFrequentProviderOrder(allProviderIds, manualDisplayOrder)
    : manualDisplayOrder;
  const startupProviders = normalizeStartupProviders(settings.startupProviders) || [];
  const listContainer = document.getElementById('provider-list');
  listContainer.dataset.sortMode = sortMode;
  const providerAccessEntries = await Promise.all(PROVIDERS.map(async (provider) => [
    provider.id,
    await hasOptionalProviderPermission(provider.id)
  ]));
  const providerAccess = new Map(providerAccessEntries);
  renderProviderAccessNotice(PROVIDERS.filter(provider =>
    provider.optionalOrigins
    && enabledProviders.includes(provider.id)
    && providerAccess.get(provider.id) === false
  ));

  const orderIndex = new Map(displayOrder.map((id, index) => [id, index]));
  const sortedProviders = [...PROVIDERS].sort((a, b) => {
    return (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0);
  });

  listContainer.innerHTML = sortedProviders.map(provider => {
    const isEnabledPreference = enabledProviders.includes(provider.id);
    const hasAccess = providerAccess.get(provider.id) !== false;
    const isEnabled = isEnabledPreference && hasAccess;
    const isDraggable = isEnabled && sortMode !== PROVIDER_SORT_MODE_FREQUENT;
    const billingType = getProviderBillingType(provider.id, settings.providerBillingTypes);
    const googleModeControl = provider.id === 'google'
      ? renderGoogleModeSelectMarkup(googleProviderMode, isEnabled)
      : '';
    const startupControl = isEnabled
      ? `
        <label class="startup-provider-toggle" title="${t('labelOpenOnStartup')}">
          <input type="checkbox" data-startup-provider-id="${provider.id}"
                 ${startupProviders.includes(provider.id) ? 'checked' : ''} />
          <span>${t('labelOpenOnStartup')}</span>
        </label>
      `
      : '';

    return `
      <div class="provider-item ${isDraggable ? 'draggable' : ''}"
           data-provider-id="${provider.id}"
           data-enabled-preference="${isEnabledPreference}"
           data-has-access="${hasAccess}"
           draggable="${isDraggable}">
        <div class="provider-info">
          ${isEnabled ? '<span class="drag-handle material-symbols-outlined">drag_indicator</span>' : ''}
          <div class="provider-icon">
            <img src="${getProviderIcon(provider)}" alt="${provider.name}" width="24" height="24"
                 onerror="this.style.display='none'" />
          </div>
          <div class="provider-details">
            <span class="provider-name">${provider.name}</span>
            <select class="provider-billing-select" data-billing-provider-id="${provider.id}"
                    aria-label="${provider.name}: ${t('labelProviderBilling')}"
                    title="${t('labelProviderBilling')}">
              ${Object.entries(PROVIDER_BILLING_TYPES).map(([value, key]) => `
                <option value="${value}" ${billingType === value ? 'selected' : ''}>${t(key)}</option>
              `).join('')}
            </select>
          </div>
        </div>
        <div class="provider-controls">
          ${googleModeControl}
          ${startupControl}
          <div class="toggle-switch ${isEnabled ? 'active' : ''}" data-provider-id="${provider.id}"></div>
        </div>
      </div>
    `;
  }).join('');

  // Add click listeners to toggles
  listContainer.querySelectorAll('.toggle-switch').forEach(toggle => {
    toggle.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const providerItem = toggle.closest('.provider-item');
      const providerId = providerItem?.dataset.providerId || toggle.dataset.providerId;
      if (!providerId) return;

      const provider = PROVIDERS.find(({ id }) => id === providerId);
      const hasAccess = providerItem?.dataset.hasAccess !== 'false';
      const isEnabledPreference = providerItem?.dataset.enabledPreference === 'true';

      if (!hasAccess && provider?.optionalOrigins) {
        try {
          const permissionGranted = await requestOptionalProviderPermission(providerId);
          if (!permissionGranted) {
            showStatus('error', t('msgProviderPermissionRequired', provider.name));
            return;
          }
        } catch (error) {
          console.error(`Failed to request site access for ${providerId}:`, error);
          showStatus('error', t('msgProviderPermissionRequestFailed', provider.name));
          return;
        }

        // A synced preference can already be enabled while this device still
        // needs permission. Granting access should activate it, not toggle it off.
        if (isEnabledPreference) {
          await renderProviderList();
          showStatus('success', t('msgProviderSettingsUpdated'));
          return;
        }
      }

      await toggleProvider(providerId);
    });
  });

  listContainer.querySelectorAll('[data-google-mode-select="true"]').forEach(select => {
    select.addEventListener('mousedown', (event) => {
      event.stopPropagation();
    });

    select.addEventListener('click', (event) => {
      event.stopPropagation();
    });

    select.addEventListener('change', async (event) => {
      await saveSetting('googleProviderMode', normalizeGoogleProviderMode(event.target.value));
      fitSelectWidth(event.target);
      showStatus('success', 'Google mode updated');
    });
  });

  listContainer.querySelectorAll('[data-billing-provider-id]').forEach(select => {
    ['mousedown', 'click'].forEach(eventName => {
      select.addEventListener(eventName, event => event.stopPropagation());
    });
    select.addEventListener('change', async (event) => {
      const providerId = event.target.dataset.billingProviderId;
      const currentSettings = await getSettings();
      await saveSetting('providerBillingTypes', {
        ...currentSettings.providerBillingTypes,
        [providerId]: getProviderBillingType(providerId, { [providerId]: event.target.value })
      });
      fitSelectWidth(event.target);
      showStatus('success', t('msgProviderBillingUpdated'));
    });
  });

  listContainer.querySelectorAll('.startup-provider-toggle').forEach(label => {
    label.addEventListener('mousedown', (event) => {
      event.stopPropagation();
    });
  });

  listContainer.querySelectorAll('[data-startup-provider-id]').forEach(checkbox => {
    checkbox.addEventListener('change', async (event) => {
      await toggleStartupProvider(event.target.dataset.startupProviderId, event.target.checked);
    });
  });

  // Setup drag-and-drop for enabled providers
  setupProviderDragAndDrop(listContainer);
  refreshAutoSizedSelects(listContainer);
}

function setupStorageChangeListener() {
  if (!chrome?.storage?.onChanged?.addListener) {
    return;
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync' && areaName !== 'local') {
      return;
    }

    if (changes.googleProviderMode || changes.providerBillingTypes) {
      renderProviderList().catch((error) => {
        console.error('Error syncing provider controls:', error);
      });
    }

    // Skip echoes of this page's own saves so typing is never interrupted.
    if (changes.providerTierRecipes && !document.getElementById('tier-recipe-table')?.contains(document.activeElement)) {
      renderTierRecipeEditor().catch((error) => {
        console.error('Error syncing reasoning level mapping:', error);
      });
    }

    if (changes.providerSortMode || changes.providerOrder || changes.enabledProviders) {
      renderProviderList().catch((error) => {
        console.error('Error syncing provider order:', error);
      });
    }

    // Keep the AI summary list in step with another window, but never replace
    // inputs the user is currently editing.
    if (changes[AI_SUMMARY_PROFILES_STORAGE_KEY]
      || changes[AI_SUMMARY_ACTIVE_PROFILE_STORAGE_KEY]
      || (areaName === 'local' && changes[AI_SUMMARY_API_KEYS_STORAGE_KEY])) {
      const profilesContainer = document.getElementById('ai-summary-profiles');
      if (!profilesContainer?.contains(document.activeElement)) {
        refreshAiSummaryProfiles().catch((error) => {
          console.error('Error syncing the AI summary models:', error);
        });
      }
    }
  });
}

// Enabled providers that still need site access on this device, such as the
// optional providers in the default setup after a fresh install.
function renderProviderAccessNotice(providersMissingAccess) {
  const notice = document.getElementById('provider-access-notice');
  if (!notice) return;

  notice.hidden = providersMissingAccess.length === 0;
  notice.dataset.providerIds = providersMissingAccess.map(({ id }) => id).join(',');
  document.getElementById('provider-access-notice-text').textContent = t(
    'msgProviderAccessMissing',
    providersMissingAccess.map(({ name }) => name).join(', ')
  );
}

function setupProviderAccessNotice() {
  const button = document.getElementById('grant-provider-access-btn');
  button?.addEventListener('click', async () => {
    const notice = document.getElementById('provider-access-notice');
    const providerIds = (notice?.dataset.providerIds || '').split(',').filter(Boolean);
    if (providerIds.length === 0) return;

    try {
      const permissionGranted = await requestOptionalProvidersPermission(providerIds);
      if (!permissionGranted) {
        return;
      }
    } catch (error) {
      console.error('Failed to request site access for enabled providers:', error);
      showStatus('error', t('msgProviderAccessRequestFailed'));
      return;
    }

    await renderProviderList();
    showStatus('success', t('msgProviderSettingsUpdated'));
  });
}

function setupPermissionChangeListeners() {
  const refreshProviders = () => {
    renderProviderList().catch((error) => {
      console.error('Error syncing optional provider access:', error);
    });
  };

  chrome.permissions?.onAdded?.addListener(refreshProviders);
  chrome.permissions?.onRemoved?.addListener(refreshProviders);
}

// Setup drag-and-drop reordering
function setupProviderDragAndDrop(container) {
  let draggedItem = null;

  container.querySelectorAll('.provider-item.draggable').forEach(item => {
    item.addEventListener('dragstart', (e) => {
      draggedItem = item;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      draggedItem = null;
      // Save new order
      saveProviderOrder(container);
    });

    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!draggedItem || draggedItem === item) return;

      const rect = item.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;

      if (e.clientY < midY) {
        item.parentNode.insertBefore(draggedItem, item);
      } else {
        item.parentNode.insertBefore(draggedItem, item.nextSibling);
      }
    });
  });
}

// Save the new provider order
async function saveProviderOrder(container) {
  const settings = await getSettings();
  if (normalizeProviderSortMode(settings.providerSortMode) === PROVIDER_SORT_MODE_FREQUENT) {
    return;
  }

  const enabledProviders = getEnabledProvidersOrDefault(settings);
  const items = container.querySelectorAll('.provider-item');
  const newOrder = Array.from(items).map(item => item.dataset.providerId);
  const newEnabledOrder = newOrder.filter(id => enabledProviders.includes(id));

  await saveSetting('providerOrder', newOrder);
  // Also update enabledProviders to match the new order among enabled items
  await saveSetting('enabledProviders', newEnabledOrder);
  showStatus('success', t('msgProviderSettingsUpdated'));
}

async function toggleProvider(providerId) {
  const settings = await getSettings();
  let enabledProviders = getEnabledProvidersOrDefault(settings);
  const provider = PROVIDERS.find(({ id }) => id === providerId);

  if (!provider) {
    return;
  }

  if (enabledProviders.includes(providerId)) {
    // Disable - but ensure at least one provider remains enabled
    if (enabledProviders.length === 1) {
      showStatus('error', t('msgOneProviderRequired'));
      return;
    }
    enabledProviders = enabledProviders.filter(id => id !== providerId);

  } else {
    // Enable
    enabledProviders.push(providerId);
  }

  const providerOrder = appendProviderToOrder(
    settings.providerOrder,
    getEnabledProvidersOrDefault(settings),
    providerId,
    PROVIDERS.map(({ id }) => id)
  );

  await saveSettings({ enabledProviders, providerOrder });
  await renderProviderList();
  showStatus('success', t('msgProviderSettingsUpdated'));
}

async function toggleStartupProvider(providerId, shouldOpen) {
  const settings = await getSettings();
  const startupProviders = (normalizeStartupProviders(settings.startupProviders) || [])
    .filter(id => id !== providerId);

  if (shouldOpen) {
    startupProviders.push(providerId);
  }

  await saveSetting('startupProviders', startupProviders.length > 0 ? startupProviders : null);
  showStatus('success', t('msgProviderSettingsUpdated'));
}

// T056: Load and display data statistics
async function loadDataStats() {
  try {
    const prompts = await getAllPrompts();

    document.getElementById('stat-prompts').textContent = prompts.length;

    // Estimate storage size
    const promptsSize = JSON.stringify(prompts).length;
    const sizeKB = Math.round(promptsSize / 1024);
    document.getElementById('stat-storage').textContent = `~${sizeKB} KB`;
  } catch (error) {
    // Silently handle data stats errors
    document.getElementById('stat-prompts').textContent = '0';
    document.getElementById('stat-storage').textContent = '0 KB';
  }
}

// T057-T064: Setup event listeners
function setupEventListeners() {
  const tierRecipeTable = document.getElementById('tier-recipe-table');
  // Text fields save when they lose focus; checkboxes save right away.
  tierRecipeTable?.addEventListener('change', () => {
    saveTierRecipesFromEditor().catch((error) => {
      console.error('Failed to save reasoning level mapping:', error);
    });
  });
  document.getElementById('reset-tier-recipes-btn')?.addEventListener('click', async () => {
    await saveSetting('providerTierRecipes', null);
    await renderTierRecipeEditor();
    showToast('success', 'toastTierRecipesReset');
  });

  document.addEventListener('panelize:themechange', () => {
    renderProviderList().catch((error) => {
      console.error('Failed to refresh provider icons after theme change:', error);
    });
  });

  // Theme change
  document.getElementById('theme-select').addEventListener('change', async (e) => {
    await saveSetting('theme', e.target.value);
    await applyTheme();  // Re-apply theme immediately
    await renderProviderList();
    showStatus('success', t('msgThemeUpdated'));
  });

  // Language change
  document.getElementById('language-select').addEventListener('change', async (e) => {
    const newLanguage = e.target.value;
    await saveSetting('language', newLanguage);

    // Reload translations with new language
    await initializeLanguage(newLanguage);

    // Re-translate the entire page
    translatePage();
    await renderProviderList();
    await refreshAiSummaryProfiles();

    // Show success message (now in the new language)
    showStatus('success', t('msgLanguageUpdated'));
  });

  // Keyboard shortcut toggle
  const shortcutToggle = document.getElementById('keyboard-shortcut-toggle');
  if (shortcutToggle) {
    shortcutToggle.addEventListener('change', async (e) => {
      const enabled = e.target.checked;
      await saveSetting('keyboardShortcutEnabled', enabled);
      updateShortcutHelperVisibility(enabled);
      showStatus('success', enabled ? t('msgShortcutEnabled') : t('msgShortcutDisabled'));
    });
  }

  // Source URL placement change
  const sourceUrlPlacementSelect = document.getElementById('source-url-placement-select');
  if (sourceUrlPlacementSelect) {
    sourceUrlPlacementSelect.addEventListener('change', async (e) => {
      await saveSetting('sourceUrlPlacement', e.target.value);
      showStatus('success', t('msgSourceUrlPlacementUpdated'));
    });
  }

  // Export data
  document.getElementById('export-btn').addEventListener('click', exportData);

  // Import data
  document.getElementById('import-btn').addEventListener('click', () => {
    const fileInput = document.getElementById('import-file');
    fileInput.value = ''; // Reset file input before opening to allow re-importing same file
    fileInput.click();
  });

  document.getElementById('import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
      await importData(file);
    }
  });

  // Danger Zone - Clear buttons
  document.getElementById('clear-prompts-btn').addEventListener('click', clearPrompts);
  document.getElementById('reset-settings-btn').addEventListener('click', resetSettingsOnly);

  // Default library import button
  document.getElementById('import-default-library')?.addEventListener('click', importDefaultLibraryHandler);

  // Custom library import button
  document.getElementById('import-custom-library')?.addEventListener('click', () => {
    const fileInput = document.getElementById('import-custom-library-file');
    fileInput.value = ''; // Reset file input before opening to allow re-importing same file
    fileInput.click();
  });

  document.getElementById('import-custom-library-file')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
      await importCustomLibraryHandler(file);
    }
  });

  // Custom prompt guide and template
  document.getElementById('open-custom-prompt-guide')?.addEventListener('click', async () => {
    const settings = await getSettings();
    const locale = settings.language;
    const guidePath = getPromptGuidePath(locale);
    const url = getExtensionResourceUrl(guidePath);
    window.open(url, '_blank', 'noopener');
  });

  document.getElementById('download-custom-prompt-template')?.addEventListener('click', () => {
    const url = getExtensionResourceUrl('data/prompt-libraries/custom-prompt-template.json');
    const link = document.createElement('a');
    link.href = url;
    link.download = 'custom-prompt-template.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
  });

  // Enter key behavior toggle
  const enterBehaviorToggle = document.getElementById('enter-behavior-toggle');
  if (enterBehaviorToggle) {
    enterBehaviorToggle.addEventListener('change', async (e) => {
      const enabled = e.target.checked;
      const settings = await getSettings();
      const enterBehavior = settings.enterKeyBehavior || {};
      enterBehavior.enabled = enabled;
      await saveSetting('enterKeyBehavior', enterBehavior);
      updateEnterBehaviorVisibility(enabled);
      showStatus('success', enabled ? t('msgEnterCustomEnabled') : t('msgEnterCustomDisabled'));
    });
  }

  // Preset selection
  const enterPresetSelect = document.getElementById('enter-preset-select');
  if (enterPresetSelect) {
    enterPresetSelect.addEventListener('change', async (e) => {
      await applyEnterKeyPreset(e.target.value);
      updateCustomEnterSettingsVisibility(e.target.value);
    });
  }

  // Custom modifier checkboxes
  ['newline-shift', 'newline-ctrl', 'newline-alt', 'newline-meta',
   'send-shift', 'send-ctrl', 'send-alt', 'send-meta'].forEach(id => {
    const checkbox = document.getElementById(id);
    if (checkbox) {
      checkbox.addEventListener('change', saveCustomEnterSettings);
    }
  });

  // T073: Version check button
  const checkUpdatesBtn = document.getElementById('check-updates-btn');
  if (checkUpdatesBtn) {
    checkUpdatesBtn.addEventListener('click', performVersionCheck);
  }

  // Multi-Panel: Open mode selection
  const openModeSelect = document.getElementById('open-mode-select');
  if (openModeSelect) {
    openModeSelect.addEventListener('change', async (e) => {
      await saveSetting('openMode', e.target.value);
      showStatus('success', t('msgOpenModeUpdated') || 'Open mode updated');
    });
  }

  // Multi-Panel: Share snapshot watermark
  const shareWatermarkToggle = document.getElementById('share-watermark-toggle');
  if (shareWatermarkToggle) {
    shareWatermarkToggle.addEventListener('change', async (e) => {
      const enabled = e.target.checked;
      await saveSetting('shareWatermarkEnabled', enabled);
      showStatus('success', enabled ? t('msgShareWatermarkEnabled') : t('msgShareWatermarkDisabled'));
    });
  }

  // Multi-Panel: Answer complete notification
  const answerCompleteNotificationToggle = document.getElementById('answer-complete-notification-toggle');
  if (answerCompleteNotificationToggle) {
    answerCompleteNotificationToggle.addEventListener('change', async (e) => {
      const enabled = e.target.checked;
      await saveSetting('answerCompleteNotificationEnabled', enabled);
      showStatus('success', enabled ? t('msgAnswerCompleteNotificationEnabled') : t('msgAnswerCompleteNotificationDisabled'));
    });
  }

  // macOS global input bridge
  document.getElementById('global-send-bridge-toggle')?.addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    await saveSetting('globalSendBridgeEnabled', enabled);
    showStatus('success', enabled ? t('msgGlobalSendBridgeEnabled') : t('msgGlobalSendBridgeDisabled'));
  });

  // AI summary
  document.getElementById('ai-summary-auto-toggle')?.addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    await saveSetting('aiSummaryAutoEnabled', enabled);
    showStatus('success', enabled ? t('msgAiSummaryAutoEnabled') : t('msgAiSummaryAutoDisabled'));
  });
  document.getElementById('ai-summary-save-btn')?.addEventListener('click', saveAndTestAiSummary);
  document.getElementById('ai-summary-add-profile-btn')?.addEventListener('click', addAiSummaryProfileRow);
  const aiSummaryProfilesContainer = document.getElementById('ai-summary-profiles');
  aiSummaryProfilesContainer?.addEventListener('click', (event) => {
    const removeButton = event.target.closest?.('[data-action="remove-profile"]');
    if (removeButton) {
      removeAiSummaryProfileRow(removeButton.closest('.ai-summary-profile'));
    }
  });
  aiSummaryProfilesContainer?.addEventListener('change', (event) => {
    if (event.target.matches?.('input[name="ai-summary-active-profile"]')) {
      updateAiSummaryProfileControls(aiSummaryProfilesContainer);
    }
  });

  const providerSortModeSelect = document.getElementById('provider-sort-mode-select');
  if (providerSortModeSelect) {
    providerSortModeSelect.addEventListener('change', async (event) => {
      await saveSetting('providerSortMode', normalizeProviderSortMode(event.target.value));
      await renderProviderList();
      showStatus('success', t('msgProviderSettingsUpdated'));
    });
  }

  // Multi-Panel: Layout selection
  const multiPanelLayoutSelect = document.getElementById('multi-panel-layout-select');
  if (multiPanelLayoutSelect) {
    // Load saved layout
    chrome.storage.sync.get({ multiPanelLayout: '1x3' }, (result) => {
      const storedLayout = result.multiPanelLayout;
      const hasOption = Array.from(multiPanelLayoutSelect.options).some(option => option.value === storedLayout);
      multiPanelLayoutSelect.value = hasOption ? storedLayout : '1x3';
    });

    multiPanelLayoutSelect.addEventListener('change', async (e) => {
      await chrome.storage.sync.set({ multiPanelLayout: e.target.value });
      showStatus('success', t('msgLayoutUpdated') || 'Layout updated');
    });
  }
}

// T057: Export all data
async function exportData() {
  try {
    // Export prompts
    const promptsData = await exportPrompts();

    // Export settings
    const settingsData = await exportSettings();

    // Combine into single export file
    const exportData = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      prompts: promptsData.prompts,
      settings: settingsData
    };

    // Create download
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `panelize-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);

    showStatus('success', t('msgDataExported'));
  } catch (error) {
    showStatus('error', t('msgDataExportFailed'));
  }
}

// T058-T062: Import data from file
async function importData(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!data.version) {
      throw new Error('Invalid export file format');
    }

    // Confirm import
    const confirmMsg = t('msgImportConfirm', [
      new Date(data.exportDate).toLocaleString(),
      (data.prompts?.length || 0).toString()
    ]);

    if (!confirm(confirmMsg)) {
      return;
    }

    // Import prompts
    let promptImportSummary = null;
    if (data.prompts && Array.isArray(data.prompts)) {
      promptImportSummary = await importPrompts({ prompts: data.prompts }, 'skip');
    }

    // Import settings (but preserve current enabled providers)
    if (data.settings) {
      const currentSettings = await getSettings();
      const settingsToImport = {
        ...data.settings,
        enabledProviders: currentSettings.enabledProviders // Don't overwrite provider settings
      };
      await importSettings(settingsToImport);
    }

    await loadSettings();
    await loadDataStats();

    // Show success toast
    if (promptImportSummary && promptImportSummary.imported > 0) {
      showToast('success', 'msgDataImportedWithCount', [promptImportSummary.imported.toString()]);
    } else {
      showToast('success', 'msgDataImported');
    }
  } catch (error) {
    showStatus('error', t('msgDataImportFailed'));
  }
}

// Danger Zone: Clear Prompts
async function clearPrompts() {
  if (!confirm(t('msgConfirmClearPrompts'))) {
    return;
  }

  try {
    await clearAllPrompts();
    await loadDataStats();
    showStatus('success', t('msgPromptsCleared'));
  } catch (error) {
    showStatus('error', t('msgClearPromptsFailed'));
  }
}

// Danger Zone: Reset Settings
async function resetSettingsOnly() {
  if (!confirm(t('msgConfirmResetSettings'))) {
    return;
  }

  try {
    await resetSettings();
    await loadSettings();
    await renderProviderList();
    showStatus('success', t('msgSettingsReset'));
  } catch (error) {
    showStatus('error', t('msgResetSettingsFailed'));
  }
}

function createAiSummaryProfileField(field, inputType, value, { labelKey, maxLength, placeholder } = {}) {
  const label = document.createElement('label');
  label.className = `ai-summary-profile-field ai-summary-profile-field-${field}`;
  const labelText = document.createElement('span');
  labelText.textContent = t(labelKey);
  const input = document.createElement('input');
  input.type = inputType;
  input.className = 'ai-summary-input';
  input.dataset.field = field;
  input.value = value || '';
  input.autocomplete = 'off';
  input.spellcheck = false;
  if (maxLength) {
    input.maxLength = maxLength;
  }
  if (placeholder) {
    input.placeholder = placeholder;
  }
  label.append(labelText, input);
  return label;
}

function createAiSummaryProfileRow(profile, apiKey, activeProfileId) {
  const row = document.createElement('div');
  row.className = 'ai-summary-profile';
  row.dataset.profileId = profile.id;

  const header = document.createElement('div');
  header.className = 'ai-summary-profile-header';

  const activeLabel = document.createElement('label');
  activeLabel.className = 'ai-summary-profile-active';
  const radio = document.createElement('input');
  radio.type = 'radio';
  radio.name = 'ai-summary-active-profile';
  radio.value = profile.id;
  radio.checked = profile.id === activeProfileId;
  const activeText = document.createElement('span');
  activeText.textContent = t('labelAiSummaryProfileActive');
  activeLabel.append(radio, activeText);

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'ai-summary-profile-remove';
  removeButton.dataset.action = 'remove-profile';
  removeButton.textContent = t('labelAiSummaryProfileRemove');
  header.append(activeLabel, removeButton);

  const fields = document.createElement('div');
  fields.className = 'ai-summary-profile-fields';
  fields.append(
    createAiSummaryProfileField('name', 'text', profile.name, {
      labelKey: 'labelAiSummaryProfileName',
      maxLength: 60
    }),
    createAiSummaryProfileField('model', 'text', profile.model, {
      labelKey: 'labelAiSummaryProfileModel',
      maxLength: 200,
      placeholder: 'gpt-4o-mini'
    }),
    createAiSummaryProfileField('baseUrl', 'url', profile.baseUrl, {
      labelKey: 'labelAiSummaryProfileBaseUrl',
      maxLength: 500,
      placeholder: 'https://api.openai.com/v1'
    }),
    createAiSummaryProfileField('apiKey', 'password', apiKey, {
      labelKey: 'labelAiSummaryProfileApiKey'
    })
  );

  row.append(header, fields);
  return row;
}

function ensureAiSummaryProfileSelection(container) {
  if (!container) {
    return;
  }
  const radios = [...container.querySelectorAll('input[name="ai-summary-active-profile"]')];
  if (radios.length > 0 && !radios.some(radio => radio.checked)) {
    radios[0].checked = true;
  }
}

function updateAiSummaryProfileControls(container = document.getElementById('ai-summary-profiles')) {
  if (!container) {
    return;
  }
  const rows = [...container.querySelectorAll('.ai-summary-profile')];
  const addButton = document.getElementById('ai-summary-add-profile-btn');
  if (addButton) {
    addButton.disabled = rows.length >= MAX_AI_SUMMARY_PROFILES;
  }
  rows.forEach(row => {
    const removeButton = row.querySelector('[data-action="remove-profile"]');
    if (removeButton) {
      removeButton.disabled = rows.length <= 1;
    }
  });
}

function renderAiSummaryProfiles({ profiles, activeProfileId, apiKeys }) {
  const container = document.getElementById('ai-summary-profiles');
  if (!container) {
    return;
  }
  container.replaceChildren(...profiles.map(profile => createAiSummaryProfileRow(
    profile,
    apiKeys[profile.id] || '',
    activeProfileId
  )));
  ensureAiSummaryProfileSelection(container);
  updateAiSummaryProfileControls(container);
}

async function refreshAiSummaryProfiles() {
  const state = await loadAiSummarySetup();
  renderAiSummaryProfiles(state);
}

function addAiSummaryProfileRow() {
  const container = document.getElementById('ai-summary-profiles');
  if (!container) {
    return;
  }
  if (container.querySelectorAll('.ai-summary-profile').length >= MAX_AI_SUMMARY_PROFILES) {
    showStatus('error', t('msgAiSummaryProfileLimit', [String(MAX_AI_SUMMARY_PROFILES)]));
    return;
  }
  const row = createAiSummaryProfileRow(
    { id: createAiSummaryProfileId(), name: '', baseUrl: '', model: '' },
    '',
    ''
  );
  container.append(row);
  ensureAiSummaryProfileSelection(container);
  updateAiSummaryProfileControls(container);
  row.querySelector('[data-field="baseUrl"]')?.focus();
}

function removeAiSummaryProfileRow(row) {
  const container = document.getElementById('ai-summary-profiles');
  if (!container || !row) {
    return;
  }
  if (container.querySelectorAll('.ai-summary-profile').length <= 1) {
    return;
  }
  const wasActive = row.querySelector('input[name="ai-summary-active-profile"]')?.checked === true;
  row.remove();
  if (wasActive) {
    ensureAiSummaryProfileSelection(container);
  }
  updateAiSummaryProfileControls(container);
}

function readAiSummaryProfileRows() {
  const container = document.getElementById('ai-summary-profiles');
  const rows = [...(container?.querySelectorAll('.ai-summary-profile') || [])];
  if (rows.length === 0) {
    return { error: 'empty' };
  }

  const profiles = [];
  const apiKeys = {};
  let activeProfileId = '';
  for (const [index, row] of rows.entries()) {
    const profile = {
      id: row.dataset.profileId || createAiSummaryProfileId(),
      name: row.querySelector('[data-field="name"]')?.value.trim() || '',
      baseUrl: row.querySelector('[data-field="baseUrl"]')?.value.trim() || '',
      model: row.querySelector('[data-field="model"]')?.value.trim() || ''
    };
    if (!profile.baseUrl || !profile.model || !getSummaryOriginPattern(profile.baseUrl)) {
      return { error: 'incomplete', index, profile };
    }
    profiles.push(profile);
    const apiKey = row.querySelector('[data-field="apiKey"]')?.value.trim() || '';
    if (apiKey) {
      apiKeys[profile.id] = apiKey;
    }
    if (row.querySelector('input[name="ai-summary-active-profile"]')?.checked) {
      activeProfileId = profile.id;
    }
  }
  if (!activeProfileId) {
    activeProfileId = profiles[0].id;
  }
  return { profiles, apiKeys, activeProfileId };
}

function describeAiSummaryProfile(profile, index) {
  return profile?.name || profile?.model || `#${index + 1}`;
}

async function loadAiSummarySettings(settings) {
  const autoToggle = document.getElementById('ai-summary-auto-toggle');
  if (!autoToggle) {
    return;
  }
  autoToggle.checked = settings.aiSummaryAutoEnabled === true;
  await refreshAiSummaryProfiles();
}

async function saveAndTestAiSummary() {
  const result = document.getElementById('ai-summary-test-result');
  const button = document.getElementById('ai-summary-save-btn');
  const parsed = readAiSummaryProfileRows();
  if (parsed.error) {
    const message = parsed.error === 'incomplete'
      ? t('msgAiSummaryProfileIncomplete', [describeAiSummaryProfile(parsed.profile, parsed.index)])
      : t('msgAiSummaryIncomplete');
    result.textContent = message;
    showStatus('error', message);
    return;
  }

  const activeProfile = parsed.profiles.find(profile => profile.id === parsed.activeProfileId);
  if (!activeProfile) {
    result.textContent = t('msgAiSummaryIncomplete');
    showStatus('error', t('msgAiSummaryIncomplete'));
    return;
  }
  const origins = [...new Set(parsed.profiles
    .filter(profile => parsed.apiKeys[profile.id])
    .map(profile => getSummaryOriginPattern(profile.baseUrl))
    .filter(Boolean))];

  // The permission prompt needs the click's user gesture, so ask before any
  // other await. A denied prompt still saves the rules, as before.
  let granted = origins.length === 0;
  if (origins.length > 0) {
    try {
      granted = await chrome.permissions.request({ origins });
    } catch (error) {
      console.warn('AI summary permission request failed:', error);
    }
  }

  await saveAiSummarySetup(parsed);
  if (origins.length > 0 && !granted) {
    result.textContent = t('msgAiSummaryPermissionDenied');
    showStatus('error', t('msgAiSummaryPermissionDenied'));
    return;
  }

  const activeKey = parsed.apiKeys[activeProfile.id] || '';
  if (!isSummaryConfigured({
    baseUrl: activeProfile.baseUrl,
    model: activeProfile.model,
    apiKey: activeKey
  })) {
    const message = t('msgAiSummaryProfileApiKeyMissing', [getAiSummaryProfileLabel(activeProfile) || activeProfile.model]);
    result.textContent = message;
    showStatus('error', message);
    return;
  }

  button.disabled = true;
  result.textContent = t('msgAiSummaryProfileTesting', [getAiSummaryProfileLabel(activeProfile) || activeProfile.model]);
  try {
    await requestSummary({
      config: { baseUrl: activeProfile.baseUrl, model: activeProfile.model, apiKey: activeKey },
      messages: [{ role: 'user', content: 'Reply with OK.' }],
      timeoutMs: 30000
    });
    result.textContent = t('msgAiSummaryTestOk');
    showStatus('success', t('msgAiSummaryTestOk'));
  } catch (error) {
    result.textContent = t('msgAiSummaryTestFailed', [error?.message || String(error)]);
    showStatus('error', t('msgAiSummaryTestFailed', [error?.message || String(error)]));
  } finally {
    button.disabled = false;
  }
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

// Validate prompt structure against expected format
function validatePromptStructure(prompt) {
  const errors = [];

  // Required fields
  if (!prompt.title || typeof prompt.title !== 'string') {
    errors.push('Missing or invalid "title" (string)');
  }
  // Either text alone is a complete prompt: `content` is shown in the app,
  // `contentEn` is sent to the AIs instead of it.
  if ((!prompt.content || typeof prompt.content !== 'string') &&
      (!prompt.contentEn || typeof prompt.contentEn !== 'string')) {
    errors.push('Missing or invalid "content" (string)');
  }
  if (prompt.contentEn !== undefined && typeof prompt.contentEn !== 'string') {
    errors.push('"contentEn" should be string');
  }
  if (!prompt.category || typeof prompt.category !== 'string') {
    errors.push('Missing or invalid "category" (string)');
  }

  // Tags should be array
  if (!Array.isArray(prompt.tags)) {
    errors.push('"tags" must be an array of strings');
  }

  // Variables should be array (can be empty)
  if (!Array.isArray(prompt.variables)) {
    errors.push('"variables" must be an array');
  }

  // Optional but typed fields
  if (prompt.isFavorite !== undefined && typeof prompt.isFavorite !== 'boolean') {
    errors.push('"isFavorite" should be boolean');
  }
  if (prompt.isMode !== undefined && typeof prompt.isMode !== 'boolean') {
    errors.push('"isMode" should be boolean');
  }
  if (prompt.modeKey !== undefined && typeof prompt.modeKey !== 'string') {
    errors.push('"modeKey" should be string');
  }
  if (prompt.triggers !== undefined && (!Array.isArray(prompt.triggers) || prompt.triggers.some(trigger => typeof trigger !== 'string'))) {
    errors.push('"triggers" should be an array of strings');
  }
  if (prompt.useCount !== undefined && typeof prompt.useCount !== 'number') {
    errors.push('"useCount" should be number');
  }
  if (prompt.lastUsed !== undefined && prompt.lastUsed !== null && typeof prompt.lastUsed !== 'number') {
    errors.push('"lastUsed" should be number or null');
  }

  return errors;
}

// Generate example prompt structure
function getPromptStructureExample() {
  return `Expected JSON structure (array of prompt objects):

[
  {
    "title": "Short descriptive title",
    "content": "Full prompt text. Use {variables} for placeholders.",
    "contentEn": "Optional English text sent to the AIs instead of content.",
    "category": "Category name",
    "tags": ["tag1", "tag2"],
    "variables": ["variable1", "variable2"],
    "isFavorite": false,
    "useCount": 0,
    "lastUsed": null
  }
]

Required fields:
- title (string)
- content (string, or contentEn when the prompt has no Chinese text)
- category (string)
- tags (array of strings)
- variables (array of strings)

Optional fields:
- contentEn (string, default: ""; sent to the AIs instead of content when set)
- isFavorite (boolean, default: false)
- isMode (boolean, default: false; true lists it in the composer's prompt-mode menu)
- triggers (array of strings, default: []; words like "/study" that apply the mode to one send in Auto mode)
- useCount (number, default: 0)
- lastUsed (number or null, default: null)

${t('msgPromptGuideTip')}`;
}

// Import Custom Prompt Library
async function importCustomLibraryHandler(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);

    // Check if it's an array
    if (!Array.isArray(data)) {
      showStatus('error', t('msgInvalidPromptFormat'));
      alert(`${t('msgInvalidFormat')}\n\n${getPromptStructureExample()}`);
      return;
    }

    // Validate first prompt as a sample
    if (data.length > 0) {
      const errors = validatePromptStructure(data[0]);
      if (errors.length > 0) {
        const errorMsg = `${t('msgInvalidPromptStructure')}:\n\n${errors.join('\n')}\n\n${getPromptStructureExample()}`;
        showStatus('error', t('msgInvalidPromptStructure'));
        alert(errorMsg);
        return;
      }
    }

    // Validate all prompts
    const validationErrors = [];
    data.forEach((prompt, index) => {
      const errors = validatePromptStructure(prompt);
      if (errors.length > 0) {
        validationErrors.push(`Prompt #${index + 1}: ${errors.join(', ')}`);
      }
    });

    if (validationErrors.length > 0) {
      const errorMsg = t('msgValidationErrors', validationErrors.length.toString()) + `:\n\n${validationErrors.slice(0, 5).join('\n')}${validationErrors.length > 5 ? '\n...' : ''}\n\n${getPromptStructureExample()}`;
      showStatus('error', t('msgValidationErrors', validationErrors.length.toString()));
      alert(errorMsg);
      return;
    }

    // Wrap in expected format
    const libraryData = { prompts: data };

    // Import using the prompt manager
    const result = await importDefaultLibrary(libraryData);

    // Show results with toast notification
    if (result.imported > 0) {
      showToast('success', 'msgCustomPromptsImported', [result.imported.toString(), result.skipped.toString()]);
    } else {
      showToast('info', 'msgAllPromptsExist');
    }

    // Refresh stats
    await loadDataStats();

  } catch (error) {
    if (error instanceof SyntaxError) {
      showStatus('error', t('msgInvalidJSON'));
      alert(`${t('msgJSONParseError')}\n\n${getPromptStructureExample()}`);
    } else {
      showStatus('error', t('msgCustomImportFailed'));
      console.error('Import error:', error);
    }
  }
}

// Import Default Prompt Library
async function importDefaultLibraryHandler() {
  const button = document.getElementById('import-default-library');

  try {
    button.disabled = true;
    button.textContent = t('msgImporting');

    // The default prompts are the built-in modes; ones already present are skipped.
    const imported = await restoreDefaultModePrompts({ getAllPrompts, savePrompt, tr: translated });
    const result = { imported, skipped: 0 };

    // Update UI
    if (result.imported > 0) {
      button.textContent = t('msgImported');
      button.style.background = '#4caf50';
      button.style.color = 'white';
      showToast('success', 'msgDefaultPromptsImported', [result.imported.toString(), result.skipped.toString()]);
    } else {
      button.textContent = t('msgAlreadyImported');
      button.disabled = true;
      showToast('info', 'msgAllPromptsExist');
    }

    // Refresh stats
    await loadDataStats();

  } catch (error) {
    showStatus('error', t('msgDefaultImportFailed'));
    button.disabled = false;
    button.textContent = t('btnImportDefault');
  }
}

// Enter Key Behavior Helper Functions
function updateEnterBehaviorVisibility(enabled) {
  const settingsDiv = document.getElementById('enter-behavior-settings');
  if (settingsDiv) {
    settingsDiv.style.display = enabled ? 'block' : 'none';
  }
}

function updateCustomEnterSettingsVisibility(preset) {
  const customDiv = document.getElementById('custom-enter-settings');
  if (customDiv) {
    customDiv.style.display = preset === 'custom' ? 'block' : 'none';
  }
}

function loadCustomEnterSettings(enterBehavior) {
  // Load newline modifiers
  document.getElementById('newline-shift').checked = enterBehavior.newlineModifiers.shift || false;
  document.getElementById('newline-ctrl').checked = enterBehavior.newlineModifiers.ctrl || false;
  document.getElementById('newline-alt').checked = enterBehavior.newlineModifiers.alt || false;
  document.getElementById('newline-meta').checked = enterBehavior.newlineModifiers.meta || false;

  // Load send modifiers
  document.getElementById('send-shift').checked = enterBehavior.sendModifiers.shift || false;
  document.getElementById('send-ctrl').checked = enterBehavior.sendModifiers.ctrl || false;
  document.getElementById('send-alt').checked = enterBehavior.sendModifiers.alt || false;
  document.getElementById('send-meta').checked = enterBehavior.sendModifiers.meta || false;
}

async function applyEnterKeyPreset(preset) {
  const settings = await getSettings();
  const enterBehavior = settings.enterKeyBehavior || {};

  enterBehavior.preset = preset;

  // Define preset configurations
  const presets = {
    default: {
      newlineModifiers: { shift: true, ctrl: false, alt: false, meta: false },
      sendModifiers: { shift: false, ctrl: false, alt: false, meta: false }
    },
    swapped: {
      newlineModifiers: { shift: false, ctrl: false, alt: false, meta: false },
      sendModifiers: { shift: true, ctrl: false, alt: false, meta: false }
    },
    slack: {
      newlineModifiers: { shift: false, ctrl: true, alt: false, meta: false },
      sendModifiers: { shift: false, ctrl: false, alt: false, meta: false }
    },
    discord: {
      newlineModifiers: { shift: false, ctrl: false, alt: false, meta: false },
      sendModifiers: { shift: false, ctrl: true, alt: false, meta: false }
    }
  };

  if (preset !== 'custom' && presets[preset]) {
    enterBehavior.newlineModifiers = presets[preset].newlineModifiers;
    enterBehavior.sendModifiers = presets[preset].sendModifiers;
    loadCustomEnterSettings(enterBehavior);
  }

  await saveSetting('enterKeyBehavior', enterBehavior);
  showStatus('success', t('msgPresetChanged', preset));
}

async function saveCustomEnterSettings() {
  const settings = await getSettings();
  const enterBehavior = settings.enterKeyBehavior || {};

  enterBehavior.preset = 'custom';
  enterBehavior.newlineModifiers = {
    shift: document.getElementById('newline-shift').checked,
    ctrl: document.getElementById('newline-ctrl').checked,
    alt: document.getElementById('newline-alt').checked,
    meta: document.getElementById('newline-meta').checked
  };
  enterBehavior.sendModifiers = {
    shift: document.getElementById('send-shift').checked,
    ctrl: document.getElementById('send-ctrl').checked,
    alt: document.getElementById('send-alt').checked,
    meta: document.getElementById('send-meta').checked
  };

  await saveSetting('enterKeyBehavior', enterBehavior);

  // Update preset dropdown to show custom
  const presetSelect = document.getElementById('enter-preset-select');
  if (presetSelect) {
    presetSelect.value = 'custom';
  }

  showStatus('success', t('msgCustomMappingSaved'));
}

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

// Initialize on load
init();
