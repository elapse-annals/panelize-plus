/**
 * Owns summary behavior and its page-local state.
 * Deferred controller getters keep composition in the entry point.
 */
import { getSummaryOriginPattern, isSummaryConfigured, requestSummary } from '../../modules/answers/ai-summary.js';
import {
  MAX_AI_SUMMARY_PROFILES,
  createAiSummaryProfileId,
  getAiSummaryProfileLabel,
  loadAiSummarySetup,
  saveAiSummarySetup
} from '../../modules/answers/ai-summary-profiles.js';
import { t } from '../../modules/platform/i18n.js';
import { showStatus } from './ui.js';

export function createSummaryController() {
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

  return {
    addAiSummaryProfileRow,
    loadAiSummarySettings,
    refreshAiSummaryProfiles,
    removeAiSummaryProfileRow,
    saveAndTestAiSummary,
    updateAiSummaryProfileControls,
  };
}
