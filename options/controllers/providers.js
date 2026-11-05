/**
 * Owns providers behavior and its page-local state.
 * Deferred controller getters keep composition in the entry point.
 */
import { PROVIDERS, getProviderIcon } from '../../modules/providers/providers.js';
import { DEFAULT_PROVIDER_IDS } from '../../modules/providers/provider-defaults.js';
import { appendProviderToOrder, normalizeProviderOrder } from '../../modules/providers/provider-order.js';
import { getFrequentProviderOrder, normalizeProviderSortMode, PROVIDER_SORT_MODE_FREQUENT } from '../../modules/providers/provider-ranking.js';
import { normalizeStartupProviders } from '../../modules/panels/startup-providers.js';
import { getProviderBillingType, PROVIDER_BILLING_TYPES } from '../../modules/providers/provider-billing.js';
import {
  hasOptionalProviderPermission,
  requestOptionalProviderPermission,
  requestOptionalProvidersPermission
} from '../../modules/providers/optional-provider-access.js';
import { getSettings, getSetting, saveSettings, saveSetting } from '../../modules/platform/settings.js';
import {
  DEFAULT_GOOGLE_PROVIDER_MODE,
  GOOGLE_PROVIDER_MODE_AI,
  GOOGLE_PROVIDER_MODE_SEARCH,
  normalizeGoogleProviderMode
} from '../../modules/providers/google-mode.js';
import { t } from '../../modules/platform/i18n.js';
import {
  DEFAULT_TIER_RECIPES,
  PROVIDER_TIER_IDS,
  TIER_RECIPE_PROVIDERS,
  buildTierRecipeOverrides,
  getEffectiveTierRecipes,
  tierRecipeFromFields,
  tierRecipeToFields
} from '../../modules/providers/provider-tiers.js';
import { fitSelectWidth, refreshAutoSizedSelects, showStatus, showToast, translated } from './ui.js';

export function createProvidersController() {
  const DEFAULT_ENABLED_PROVIDERS = DEFAULT_PROVIDER_IDS;

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

  // T052-T053: Render provider enable/disable toggles with drag-and-drop reordering
  const TIER_COLUMN_LABELS = {
    fast: ['composerTierFast', 'Fast'],
    balanced: ['composerTierBalanced', 'Balanced'],
    deep: ['composerTierDeep', 'Deep']
  };

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

  return {
    renderProviderList,
    renderTierRecipeEditor,
    saveTierRecipesFromEditor,
    setupPermissionChangeListeners,
    setupProviderAccessNotice,
  };
}
