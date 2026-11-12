/**
 * Owns composer behavior and its page-local state.
 * Deferred controller getters keep composition in the entry point.
 */
import { ATTACHMENT_ACCEPT, isSupportedAttachmentFile } from '../../modules/composer/attachment-files.js';
import { isAnyModalOpen, isFocusInOpenModal, isModalOpen } from './ui.js';

export function createComposerController({
  getAttachmentsController,
  getComposerStatusController,
  getConversationsController,
  getFocusController,
  getLayoutController,
  getPanelsController,
  getPresentationController,
  getPromptsController,
  getProviderMenusController,
  getQuestionHistoryController,
  getSendingController,
  getSharingController,
  getWindowModeController
}) {
  let composerControls = null;

  function toggleToolbar() {
    const toolbar = document.getElementById('toolbar');
    const expandBar = document.getElementById('toolbar-expand-bar');
    const toggleBtn = document.getElementById('toggle-toolbar-btn');

    const isCollapsed = toolbar.classList.toggle('collapsed');

    if (isCollapsed) {
      expandBar.classList.remove('hidden');
    } else {
      expandBar.classList.add('hidden');
    }
  }

  // ===== Prompt Library =====
  let currentPromptFilter = 'recent';

  // ===== Event Listeners =====
  function setupEventListeners() {
    const layoutBtn = document.getElementById('layout-btn');
    if (!layoutBtn) return;

    document.addEventListener('keydown', (event) => {
      // Escape during IME composition only cancels the candidate.
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || event.keyCode === 229 ||
          !getPanelsController().focusedPanelId || isFocusInOpenModal() || getSharingController().isShareModalOpen()) {
        return;
      }
      // Opening a dialog can leave focus on its toolbar trigger.
      if (isAnyModalOpen()) {
        return;
      }
      // The provider and add-panel menus are not modals but are still open popups.
      if (document.querySelector('.provider-switcher-menu, .add-panel-menu')) {
        return;
      }
      getPanelsController().setFocusedPanel(null);
    });

    // Esc closes the Prompt Library. Dialogs opened on top of it keep Esc away,
    // so unsaved prompt edits and half-filled variables are not lost.
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || event.keyCode === 229) {
        return;
      }
      const isOpen = id => isModalOpen(document.getElementById(id));
      if (!isOpen('prompt-modal') || isOpen('prompt-editor-modal') || isOpen('variable-modal')) {
        return;
      }
      event.preventDefault();
      getPromptsController().closePromptModal();
    });

    // Layout button
    layoutBtn.addEventListener('click', getLayoutController().openLayoutModal);
    document.getElementById('close-layout-modal')?.addEventListener('click', getLayoutController().closeLayoutModal);

    // Layout options
    document.querySelectorAll('.layout-option').forEach(btn => {
      btn.addEventListener('click', () => getLayoutController().setLayout(btn.dataset.layout));
    });

    // Add panel button
    document.getElementById('add-panel-btn').addEventListener('click', getProviderMenusController().showAddPanelMenu);
    document.getElementById('scroll-panels-start-btn')?.addEventListener('click', () => getPresentationController().scrollPanels('start'));
    document.getElementById('scroll-panels-end-btn')?.addEventListener('click', () => getPresentationController().scrollPanels('end'));
    getPresentationController().setupPanelEdgeNavigation();

    // Toggle toolbar button and expand bar
    document.getElementById('toggle-toolbar-btn').addEventListener('click', toggleToolbar);
    document.getElementById('blind-mode-btn')?.addEventListener('click', () => getPresentationController().setPageStyleModes({ blind: !getPresentationController().isBlindModeEnabled }));
    document.getElementById('wide-content-btn')?.addEventListener('click', () => getPresentationController().setPageStyleModes({ wide: !getPresentationController().isWideContentEnabled }));
    document.getElementById('toolbar-expand-bar').addEventListener('click', toggleToolbar);

    // New Chat button
    const newChatBtn = document.getElementById('new-chat-btn');
    const preserveNewChatButtonFocus = (event) => {
      event.preventDefault();
    };
    newChatBtn.addEventListener('pointerdown', preserveNewChatButtonFocus);
    newChatBtn.addEventListener('mousedown', preserveNewChatButtonFocus);
    newChatBtn.addEventListener('click', getConversationsController().newChatAllProviders);
    const composerNewChatBtn = document.getElementById('composer-new-chat-btn');
    composerNewChatBtn.addEventListener('pointerdown', preserveNewChatButtonFocus);
    composerNewChatBtn.addEventListener('mousedown', preserveNewChatButtonFocus);
    composerNewChatBtn.addEventListener('click', () => getConversationsController().newChatAllProviders());
    document.getElementById('retry-new-chat-btn').addEventListener('click', () => getConversationsController().newChatAllProviders({ retryFailed: true }));
    document.getElementById('dismiss-composer-status-btn').addEventListener('click', () => {
      getComposerStatusController().dismiss();
    });

    // Temporary Chat button
    const temporaryChatBtn = document.getElementById('temporary-chat-btn');
    const preserveTemporaryChatButtonFocus = (event) => {
      event.preventDefault();
    };
    temporaryChatBtn.addEventListener('pointerdown', preserveTemporaryChatButtonFocus);
    temporaryChatBtn.addEventListener('mousedown', preserveTemporaryChatButtonFocus);
    temporaryChatBtn.addEventListener('click', getConversationsController().temporaryChatAllProviders);

    // Settings button
    document.getElementById('settings-btn').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });

    // Toggle open mode button
    const toggleModeBtn = document.getElementById('toggle-open-mode-btn');
    if (toggleModeBtn) {
      toggleModeBtn.addEventListener('click', getWindowModeController().toggleOpenMode);
    }

    // Prompt library button
    document.getElementById('prompt-library-btn').addEventListener('click', getPromptsController().openPromptModal);
    document.getElementById('close-prompt-modal').addEventListener('click', getPromptsController().closePromptModal);

    // Image upload button
    const imageUploadBtn = document.getElementById('image-upload-btn');
    const imageFileInput = document.getElementById('image-file-input');
    const inputWrapper = document.querySelector('.input-wrapper');
    imageFileInput.accept = ATTACHMENT_ACCEPT;

    imageUploadBtn.addEventListener('click', () => {
      imageFileInput.click();
    });

    imageFileInput.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files);
      for (const file of files) {
        await getAttachmentsController().addImage(file);
      }
      // Clear input to allow re-uploading the same file
      e.target.value = '';
    });

    // Drag and drop support
    inputWrapper.addEventListener('dragover', (e) => {
      e.preventDefault();
      inputWrapper.classList.add('drag-over');
    });

    inputWrapper.addEventListener('dragleave', (e) => {
      e.preventDefault();
      inputWrapper.classList.remove('drag-over');
    });

    inputWrapper.addEventListener('drop', async (e) => {
      e.preventDefault();
      inputWrapper.classList.remove('drag-over');

      const files = Array.from(e.dataTransfer.files).filter(isSupportedAttachmentFile);
      for (const file of files) {
        await getAttachmentsController().addImage(file);
      }
    });

    // Prompt search
    const promptSearch = document.getElementById('prompt-search');
    let searchTimeout;
    promptSearch.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        const query = e.target.value.trim();
        if (query) {
          getPromptsController().searchPromptLibrary(query);
        } else {
          getPromptsController().renderPromptList();
        }
      }, 300);
    });

    // Prompt category filter
    const categoryFilter = document.getElementById('prompt-category-filter');
    if (categoryFilter) {
      categoryFilter.addEventListener('change', (e) => {
        getPromptsController().currentCategoryFilter = e.target.value;
        getPromptsController().renderPromptList();
      });
    }

    // Prompt filter buttons
    const favoritesBtn = document.getElementById('prompt-favorites-btn');
    if (favoritesBtn) {
      favoritesBtn.addEventListener('click', () => {
        currentPromptFilter = currentPromptFilter === 'favorites' ? 'all' : 'favorites';
        favoritesBtn.classList.toggle('active', currentPromptFilter === 'favorites');
        document.getElementById('prompt-recent-btn')?.classList.remove('active');
        getPromptsController().renderPromptList();
      });
    }

    const recentBtn = document.getElementById('prompt-recent-btn');
    if (recentBtn) {
      recentBtn.addEventListener('click', () => {
        currentPromptFilter = currentPromptFilter === 'recent' ? 'all' : 'recent';
        recentBtn.classList.toggle('active', currentPromptFilter === 'recent');
        document.getElementById('prompt-favorites-btn')?.classList.remove('active');
        getPromptsController().renderPromptList();
      });
    }

    // Variable modal
    document.getElementById('close-variable-modal')?.addEventListener('click', getPromptsController().closeVariableModal);
    document.getElementById('cancel-variable-btn')?.addEventListener('click', getPromptsController().closeVariableModal);
    document.getElementById('apply-variable-btn')?.addEventListener('click', getPromptsController().applyVariables);

    // Variable modal outside click
    document.getElementById('variable-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'variable-modal') {
        getPromptsController().closeVariableModal();
      }
    });

    // Clear All button
    document.getElementById('clear-all-btn').addEventListener('click', () => {
      getSendingController().clearAllInputs();
    });

    // Fill Input Boxes button (no auto-send)
    document.getElementById('fill-input-btn').addEventListener('click', () => {
      const input = document.getElementById('unified-input');
      getSendingController().broadcastMessage(input.value, false);
    });

    const sendAllBtn = document.getElementById('send-all-btn');
    const preserveSendAllButtonFocus = (event) => {
      event.preventDefault();
    };

    sendAllBtn.addEventListener('pointerdown', preserveSendAllButtonFocus);
    sendAllBtn.addEventListener('mousedown', preserveSendAllButtonFocus);

    // Send All button (fill + auto-send)
    sendAllBtn.addEventListener('click', () => {
      const input = document.getElementById('unified-input');
      getSendingController().broadcastMessage(input.value, true);
    });

    // Input textarea
    const inputTextarea = document.getElementById('unified-input');
    let isInputComposing = false;
    inputTextarea.addEventListener('input', () => {
      getSendingController().resetFillRetryState();
      resizeTextarea();
      getQuestionHistoryController().questionHistorySuppressed = false;
      getQuestionHistoryController().questionHistoryIndex = -1;
      getQuestionHistoryController().refreshQuestionHistoryMatches();
    });
    inputTextarea.addEventListener('focus', getQuestionHistoryController().refreshQuestionHistoryMatches);
    inputTextarea.addEventListener('blur', () => getQuestionHistoryController().dismissQuestionHistory());
    document.addEventListener('selectionchange', () => {
      if (document.activeElement === inputTextarea
          && inputTextarea.selectionStart !== inputTextarea.selectionEnd) {
        getQuestionHistoryController().dismissQuestionHistory();
      }
    });
    // Re-measure after focus settles: the draft overhangs the panels only while
    // focus is inside the composer.
    const inputBar = document.getElementById('input-bar');
    inputBar.addEventListener('focusin', resizeTextarea);
    inputBar.addEventListener('focusout', () => setTimeout(resizeTextarea, 0));
    let resizeFrame = 0;
    window.addEventListener('resize', () => {
      if (resizeFrame || !inputBar.contains(document.activeElement)) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        resizeTextarea();
      });
    });
    inputTextarea.addEventListener('compositionstart', () => {
      isInputComposing = true;
      getQuestionHistoryController().dismissQuestionHistory();
    });
    inputTextarea.addEventListener('compositionend', () => {
      isInputComposing = false;
      getQuestionHistoryController().refreshQuestionHistoryMatches();
    });
    inputTextarea.addEventListener('keydown', (e) => {
      if (getQuestionHistoryController().handleQuestionHistoryKeydown(e, isInputComposing)) {
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (isInputComposing || e.isComposing) {
          return;
        }
        e.preventDefault();
        getSendingController().broadcastMessage(inputTextarea.value);
      }
    });

    // Paste image and file support (must be after inputTextarea is defined)
    inputTextarea.addEventListener('paste', async (e) => {
      const items = Array.from(e.clipboardData.items);
      for (const item of items) {
        if (item.kind !== 'file') continue;
        const file = item.getAsFile();
        if (file && isSupportedAttachmentFile(file)) {
          e.preventDefault();
          await getAttachmentsController().addImage(file);
        }
      }
    });

    // Prevent iframes from stealing focus from unified input during page load.
    // Also active during post-send and post-new-chat restore windows.
    inputTextarea.addEventListener('blur', () => {
      if (getFocusController().shouldPreserveUnifiedInputFocus()) {
        getFocusController().focusUnifiedInput();
      }
    });

    const cancelNewChatFocusRestoreOnUserIntent = (event) => {
      if (!getFocusController().isRestoringFocusAfterNewChat) {
        return;
      }

      if (event.target instanceof Element && event.target.tagName === 'IFRAME') {
        return;
      }

      if (getFocusController().isUnifiedInputOrNewChatControl(event.target)) {
        return;
      }

      getFocusController().cancelUnifiedInputFocusRestore();
    };

    document.addEventListener('pointerdown', cancelNewChatFocusRestoreOnUserIntent, true);
    document.addEventListener('mousedown', cancelNewChatFocusRestoreOnUserIntent, true);
    document.addEventListener('click', cancelNewChatFocusRestoreOnUserIntent, true);
    document.addEventListener('focusin', cancelNewChatFocusRestoreOnUserIntent, true);
    document.addEventListener('keydown', cancelNewChatFocusRestoreOnUserIntent, true);

    const cancelSendFocusRestoreOnUserIntent = (event) => {
      if (!getFocusController().isRestoringFocusAfterSend) {
        return;
      }

      if (event.target instanceof Element && event.target.tagName === 'IFRAME') {
        return;
      }

      if (getFocusController().isUnifiedInputOrSendControl(event.target)) {
        return;
      }

      getFocusController().cancelUnifiedInputFocusRestoreAfterSend();
    };

    document.addEventListener('pointerdown', cancelSendFocusRestoreOnUserIntent, true);
    document.addEventListener('mousedown', cancelSendFocusRestoreOnUserIntent, true);
    document.addEventListener('click', cancelSendFocusRestoreOnUserIntent, true);
    document.addEventListener('focusin', cancelSendFocusRestoreOnUserIntent, true);
    document.addEventListener('keydown', cancelSendFocusRestoreOnUserIntent, true);

    // Layout modal outside click
    document.getElementById('layout-modal').addEventListener('click', (e) => {
      if (e.target.id === 'layout-modal') {
        getLayoutController().closeLayoutModal();
      }
    });

    // Prompt modal outside click
    document.getElementById('prompt-modal').addEventListener('click', (e) => {
      if (e.target.id === 'prompt-modal') {
        getPromptsController().closePromptModal();
      }
    });

    // Prompt Editor Modal
    document.getElementById('close-prompt-editor')?.addEventListener('click', getPromptsController().closePromptEditor);
    document.getElementById('cancel-prompt-editor')?.addEventListener('click', getPromptsController().closePromptEditor);
    document.getElementById('save-prompt-btn')?.addEventListener('click', getPromptsController().savePromptFromEditor);
    document.getElementById('delete-prompt-btn')?.addEventListener('click', getPromptsController().deletePromptFromEditor);
    
    // New Prompt button
    document.getElementById('new-prompt-btn')?.addEventListener('click', () => getPromptsController().openPromptEditor());
    document.getElementById('restore-mode-prompts-btn')?.addEventListener('click', getPromptsController().restoreModePrompts);

    // Prompt Editor Modal outside click
    document.getElementById('prompt-editor-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'prompt-editor-modal') {
        getPromptsController().closePromptEditor();
      }
    });
  }

  // Long drafts may grow to 40% of the window (capped) while the composer is focused.
  function getComposerMaxHeight() {
    return Math.round(Math.min(window.innerHeight * 0.4, 360));
  }

  function resizeTextarea() {
    const textarea = document.getElementById('unified-input');
    const inputBar = document.getElementById('input-bar');
    textarea.style.height = 'auto';
    const restHeight = textarea.offsetHeight;
    // Collapse to one line once focus leaves the composer so the overhang never
    // covers panel content the user is reading.
    const expanded = Boolean(inputBar?.contains(document.activeElement));
    const height = expanded ? Math.max(restHeight, Math.min(textarea.scrollHeight, getComposerMaxHeight())) : restHeight;
    textarea.style.height = height + 'px';
    // The bar keeps its resting height; extra lines overhang the panels so
    // typing never resizes (and re-lays out) the provider iframes.
    const overflow = Math.max(0, height - restHeight);
    inputBar?.style.setProperty('--composer-overflow', `${overflow}px`);
    inputBar?.classList.toggle('composer-expanded', overflow > 0);
    // Every change to the question (typing, sending, clearing, restoring a draft)
    // resizes the textarea, so the appended-instruction preview follows here.
    composerControls?.refreshPromptGhost();
  }

  return {
    get composerControls() { return composerControls; },
    set composerControls(value) { composerControls = value; },
    get currentPromptFilter() { return currentPromptFilter; },
    set currentPromptFilter(value) { currentPromptFilter = value; },
    resizeTextarea,
    setupEventListeners,
  };
}
