/**
 * Owns prompts behavior and its page-local state.
 * Deferred controller getters keep composition in the entry point.
 */
import {
  getAllPrompts,
  searchPrompts,
  recordPromptUsage,
  getRecentlyUsedPrompts,
  getFavoritePrompts,
  savePrompt,
  updatePrompt,
  deletePrompt,
  getPrompt
} from '../../modules/prompts/prompt-manager.js';
import {
  getPromptDisplayContent,
  normalizePromptTriggers,
  restoreDefaultModePrompts
} from '../../modules/prompts/prompt-modes.js';
import { escapeHtml, getLocalizedText, showToast } from './ui.js';

export function createPromptsController({
  getComposerController,
  getSendingController
}) {
  // 提示词编辑器状态
  let currentEditingPromptId = null;

  // 'recent', 'favorites', 'all'
  let currentCategoryFilter = '';

  let selectedPromptForVariables = null;

  async function loadPromptLibrary() {
    await loadCategoryFilter();
    await renderPromptList();
  }

  async function loadCategoryFilter() {
    const categorySelect = document.getElementById('prompt-category-filter');
    if (!categorySelect) return;

    try {
      const prompts = await getAllPrompts();
      const categories = [...new Set(prompts.map(p => p.category).filter(Boolean))];

      categorySelect.innerHTML = '<option value="">All Categories</option>' +
        categories.map(cat => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`).join('');
    } catch (error) {
      console.error('Error loading categories:', error);
    }
  }

  async function renderPromptList(searchQuery = '') {
    const promptList = document.getElementById('prompt-list-modal');

    try {
      let prompts;

      if (searchQuery) {
        prompts = await searchPrompts(searchQuery);
      } else if (getComposerController().currentPromptFilter === 'recent') {
        prompts = await getRecentlyUsedPrompts(20);
        // If no recent prompts, fall back to all
        if (prompts.length === 0) {
          prompts = await getAllPrompts();
        }
      } else if (getComposerController().currentPromptFilter === 'favorites') {
        prompts = await getFavoritePrompts();
      } else {
        prompts = await getAllPrompts();
      }

      // Apply category filter
      if (currentCategoryFilter) {
        prompts = prompts.filter(p => p.category === currentCategoryFilter);
      }

      if (prompts.length === 0) {
        promptList.innerHTML = `
        <div class="prompt-empty">
          <span class="material-symbols-outlined">auto_awesome</span>
          <p>${searchQuery ? 'No matching prompts' : 'No prompts available'}</p>
        </div>
      `;
        return;
      }

      const editLabel = escapeHtml(getLocalizedText('btnEdit', 'Edit'));
      promptList.innerHTML = prompts.slice(0, 30).map(prompt => {
        // Cards read like the rest of the library: Chinese first, English when
        // there is none.
        const preview = getPromptDisplayContent(prompt);
        return `
      <div class="prompt-item-modal${prompt.isFavorite ? ' is-favorite' : ''}" data-id="${prompt.id}">
        <button type="button" class="prompt-item-edit" title="${editLabel}" aria-label="${editLabel}">
          <span class="material-symbols-outlined">edit</span>
        </button>
        ${prompt.isFavorite ? '<div class="prompt-item-favorite"><span class="material-symbols-outlined filled">star</span></div>' : ''}
        <div class="prompt-item-modal-title">${escapeHtml(prompt.title)}</div>
        <div class="prompt-item-modal-preview">${escapeHtml(preview.substring(0, 150))}${preview.length > 150 ? '...' : ''}</div>
        <div class="prompt-item-meta-row">
          ${prompt.isMode ? `<span class="prompt-item-category prompt-item-mode">${escapeHtml(getLocalizedText('promptModeBadge', 'Mode'))}</span>` : ''}
          ${prompt.isMode ? normalizePromptTriggers(prompt.triggers).map(trigger => `<span class="prompt-item-category prompt-item-trigger">${escapeHtml(trigger)}</span>`).join('') : ''}
          ${prompt.category ? `<span class="prompt-item-category">${escapeHtml(prompt.category)}</span>` : ''}
          ${prompt.variables && prompt.variables.length > 0 ? `
            <div class="prompt-item-variables">
              ${prompt.variables.slice(0, 3).map(v => `<span class="prompt-variable-tag">{${escapeHtml(v)}}</span>`).join('')}
              ${prompt.variables.length > 3 ? `<span class="prompt-variable-tag">+${prompt.variables.length - 3}</span>` : ''}
            </div>
          ` : ''}
        </div>
      </div>
    `;
      }).join('');

      // Add click handlers
      promptList.querySelectorAll('.prompt-item-modal').forEach(item => {
        item.addEventListener('click', async () => {
          const promptId = parseInt(item.dataset.id);
          const prompt = prompts.find(p => p.id === promptId);
          if (prompt) {
            await selectPrompt(prompt);
          }
        });
        
        item.querySelector('.prompt-item-edit')?.addEventListener('click', (event) => {
          event.stopPropagation();
          openPromptEditor(parseInt(item.dataset.id));
        });

        // Double click to edit
        item.addEventListener('dblclick', async () => {
          const promptId = parseInt(item.dataset.id);
          openPromptEditor(promptId);
        });
      });
    } catch (error) {
      console.error('Error loading prompts:', error);
      promptList.innerHTML = '<div class="prompt-empty">Failed to load prompts</div>';
    }
  }

  async function selectPrompt(prompt) {
    // Record usage
    try {
      await recordPromptUsage(prompt.id);
    } catch (error) {
      console.error('Error recording prompt usage:', error);
    }

    // Check if prompt has variables
    if (prompt.variables && prompt.variables.length > 0) {
      selectedPromptForVariables = prompt;
      showVariableModal(prompt);
    } else {
      applyPromptToInput(getPromptDisplayContent(prompt));
      closePromptModal();
    }
  }

  function showVariableModal(prompt) {
    const modal = document.getElementById('variable-modal');
    const inputsContainer = document.getElementById('variable-inputs');

    inputsContainer.innerHTML = prompt.variables.map(variable => `
    <div class="variable-input-group">
      <label for="var-${escapeHtml(variable)}">${escapeHtml(variable)}</label>
      <input type="text" id="var-${escapeHtml(variable)}" data-variable="${escapeHtml(variable)}" placeholder="Enter value for ${escapeHtml(variable)}">
    </div>
  `).join('');

    modal.style.display = 'flex';

    // Focus first input
    const firstInput = inputsContainer.querySelector('input');
    if (firstInput) {
      setTimeout(() => firstInput.focus(), 100);
    }
  }

  function applyVariables() {
    if (!selectedPromptForVariables) return;

    const prompt = selectedPromptForVariables;
    const inputs = document.querySelectorAll('#variable-inputs input');
    const withValues = text => {
      let content = text;
      inputs.forEach(input => {
        const variable = input.dataset.variable;
        const value = input.value || `{${variable}}`;
        // Replace all occurrences of {variable} literally: names may hold regex
        // characters and values may hold `$&`.
        content = content.split(`{${variable}}`).join(value);
      });
      return content;
    };

    applyPromptToInput(withValues(getPromptDisplayContent(prompt)));
    closeVariableModal();
    closePromptModal();
    selectedPromptForVariables = null;
  }

  function applyPromptToInput(content) {
    const input = document.getElementById('unified-input');
    input.value = content;
    getSendingController().resetFillRetryState();
    getComposerController().resizeTextarea();
    input.focus();
  }

  function closeVariableModal() {
    document.getElementById('variable-modal').style.display = 'none';
    selectedPromptForVariables = null;
  }

  async function searchPromptLibrary(query) {
    await renderPromptList(query);
  }

  function openPromptModal() {
    const modal = document.getElementById('prompt-modal');
    modal.style.display = 'flex';
    loadPromptLibrary();
  }

  // Adds back built-in modes that were deleted; the modes still there keep their edits.
  async function restoreModePrompts() {
    try {
      const added = await restoreDefaultModePrompts({ getAllPrompts, savePrompt, tr: getLocalizedText });
      showToast(added ? `Restored ${added} built-in mode${added === 1 ? '' : 's'}` : 'All built-in modes are already in your library');
      await loadPromptLibrary();
      await getComposerController().composerControls?.refreshPromptModes();
    } catch (error) {
      console.warn('Could not restore the built-in modes', error);
      showToast('Could not restore the built-in modes');
    }
  }

  function closePromptModal() {
    document.getElementById('prompt-modal').style.display = 'none';
    document.getElementById('prompt-search').value = '';
    // Reset filters to show all prompts on next open
    getComposerController().currentPromptFilter = 'all';
    currentCategoryFilter = '';
  }

  // ===== Prompt Editor Functions =====

  // 打开提示词编辑器（新增或编辑）
  function openPromptEditor(promptId = null, { asMode = false } = {}) {
    currentEditingPromptId = promptId;
    const modal = document.getElementById('prompt-editor-modal');
    const title = document.getElementById('prompt-editor-title');
    const deleteBtn = document.getElementById('delete-prompt-btn');

    if (promptId) {
      // 编辑模式
      title.textContent = 'Edit Prompt';
      deleteBtn.style.display = 'block';
      // 加载现有提示词数据
      loadPromptForEditing(promptId);
    } else {
      // 新增模式
      title.textContent = 'New Prompt';
      deleteBtn.style.display = 'none';
      clearPromptEditor();
      if (asMode) {
        // New from the composer's mode menu: listed there once saved.
        title.textContent = getLocalizedText('promptModeNew', 'New mode');
        document.getElementById('prompt-is-mode-input').checked = true;
        document.getElementById('prompt-category-input').value = getLocalizedText('promptModeCategory', 'Modes');
      }
    }

    modal.style.display = 'flex';
    document.getElementById('prompt-title-input')?.focus();
  }

  // 加载提示词数据到编辑器
  async function loadPromptForEditing(promptId) {
    try {
      const prompt = await getPrompt(promptId);
      if (prompt) {
        document.getElementById('prompt-title-input').value = prompt.title || '';
        document.getElementById('prompt-content-input').value = prompt.content || '';
        document.getElementById('prompt-content-en-input').value = prompt.contentEn || '';
        document.getElementById('prompt-category-input').value = prompt.category || '';
        document.getElementById('prompt-tags-input').value = prompt.tags ? prompt.tags.join(', ') : '';
        document.getElementById('prompt-is-mode-input').checked = prompt.isMode === true;
        document.getElementById('prompt-triggers-input').value = normalizePromptTriggers(prompt.triggers).join(', ');
      }
    } catch (error) {
      console.error('Error loading prompt for editing:', error);
      showToast('Failed to load prompt');
    }
  }

  // 清空编辑器
  function clearPromptEditor() {
    document.getElementById('prompt-title-input').value = '';
    document.getElementById('prompt-content-input').value = '';
    document.getElementById('prompt-content-en-input').value = '';
    document.getElementById('prompt-category-input').value = '';
    document.getElementById('prompt-tags-input').value = '';
    document.getElementById('prompt-is-mode-input').checked = false;
    document.getElementById('prompt-triggers-input').value = '';
  }

  // 关闭编辑器
  function closePromptEditor() {
    document.getElementById('prompt-editor-modal').style.display = 'none';
    currentEditingPromptId = null;
  }

  // 保存提示词
  async function savePromptFromEditor() {
    const title = document.getElementById('prompt-title-input').value.trim();
    const content = document.getElementById('prompt-content-input').value.trim();
    const contentEn = document.getElementById('prompt-content-en-input').value.trim();
    const category = document.getElementById('prompt-category-input').value.trim();
    const tagsStr = document.getElementById('prompt-tags-input').value.trim();
    const isMode = document.getElementById('prompt-is-mode-input').checked;
    const triggers = normalizePromptTriggers(document.getElementById('prompt-triggers-input').value);

    // Either text is enough: the English one is shown and sent when Content
    // is empty.
    if (!title || (!content && !contentEn)) {
      alert('A title and content in at least one language are required');
      return;
    }

    const tags = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(Boolean) : [];

    const promptData = { title, content, contentEn, category, tags, isMode, triggers };

    try {
      if (currentEditingPromptId) {
        await updatePrompt(currentEditingPromptId, promptData);
        showToast('Prompt updated successfully');
      } else {
        await savePrompt(promptData);
        showToast('Prompt saved successfully');
      }

      closePromptEditor();
      await renderPromptList();
      await getComposerController().composerControls?.refreshPromptModes();
    } catch (error) {
      console.error('Error saving prompt:', error);
      showToast('Failed to save prompt');
    }
  }

  // 删除提示词
  async function deletePromptFromEditor() {
    if (!currentEditingPromptId) return;

    if (confirm('Are you sure you want to delete this prompt?')) {
      try {
        await deletePrompt(currentEditingPromptId);
        showToast('Prompt deleted');
        closePromptEditor();
        await renderPromptList();
        await getComposerController().composerControls?.refreshPromptModes();
      } catch (error) {
        console.error('Error deleting prompt:', error);
        showToast('Failed to delete prompt');
      }
    }
  }

  // The sample libraries Options could import, in every shipped language.
  async function loadSamplePromptLibraries() {
    const paths = ['data/prompt-libraries/default-prompts.json', 'data/prompt-libraries/default-prompts-zh_CN.json'];
    const libraries = await Promise.all(paths.map(async path => {
      const response = await fetch(chrome.runtime.getURL(path));
      if (!response.ok) throw new Error(`Could not read ${path}`);
      const data = await response.json();
      return Array.isArray(data) ? data : (data?.prompts || []);
    }));
    return libraries.flat();
  }

  // Deletes a mode from the composer's mode menu; the menu re-reads the library.
  async function deleteModePrompt(prompt) {
    const message = getLocalizedText('promptModeDeleteConfirm', 'Delete the mode "$1"?', [prompt.title]);
    if (!confirm(message)) return;
    try {
      await deletePrompt(prompt.id);
      showToast(getLocalizedText('promptModeDeleted', 'Mode deleted'));
      if (document.getElementById('prompt-modal')?.style.display === 'flex') await renderPromptList();
    } catch (error) {
      console.error('Error deleting mode prompt:', error);
      showToast('Failed to delete prompt');
    }
  }

  return {
    applyPromptToInput,
    applyVariables,
    closePromptEditor,
    closePromptModal,
    closeVariableModal,
    get currentCategoryFilter() { return currentCategoryFilter; },
    set currentCategoryFilter(value) { currentCategoryFilter = value; },
    deleteModePrompt,
    deletePromptFromEditor,
    loadSamplePromptLibraries,
    openPromptEditor,
    openPromptModal,
    renderPromptList,
    restoreModePrompts,
    savePromptFromEditor,
    searchPromptLibrary,
  };
}
