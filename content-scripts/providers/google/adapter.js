(function(runtime) {
  'use strict';

  /**
   * Owns google behavior and its page-local state.
   * Deferred controller getters keep composition in the entry point.
   */


  function createGoogleController({
    getComposerController,
    getConfigController,
    getDomController,
    getProtocolController,
    getUploadsController
  }) {
    let googleSearchReplaceOnNextFill = true;

    function normalizeGoogleProviderMode(mode) {
      return mode === getProtocolController().GOOGLE_PROVIDER_MODE_SEARCH
        ? getProtocolController().GOOGLE_PROVIDER_MODE_SEARCH
        : getProtocolController().GOOGLE_PROVIDER_MODE_AI;
    }

    function resetGoogleSearchFillSession() {
      googleSearchReplaceOnNextFill = true;
    }

    function getGoogleInputSelectors(mode) {
      return normalizeGoogleProviderMode(mode) === getProtocolController().GOOGLE_PROVIDER_MODE_SEARCH
        ? getConfigController().GOOGLE_SEARCH_INPUT_SELECTORS
        : getConfigController().GOOGLE_AI_INPUT_SELECTORS;
    }

    function findGoogleInput(mode) {
      return getDomController().findFirstVisibleElement(getGoogleInputSelectors(mode));
    }

    function buildGoogleSearchFillValue(currentValue, nextText) {
      const normalizedCurrent = (currentValue || '').trim();
      const normalizedNext = (nextText || '').trim();

      if (!normalizedNext) {
        return normalizedCurrent;
      }

      if (googleSearchReplaceOnNextFill || !normalizedCurrent) {
        return normalizedNext;
      }

      return `${normalizedCurrent}${normalizedNext}`.trim();
    }

    function clearGoogleInput(mode) {
      const input = findGoogleInput(mode);
      if (!input) {
        return false;
      }

      getDomController().setFormControlValue(input, '');

      if (normalizeGoogleProviderMode(mode) === getProtocolController().GOOGLE_PROVIDER_MODE_SEARCH) {
        resetGoogleSearchFillSession();
      }

      return true;
    }

    function fillGoogleSearchInput(text) {
      const input = findGoogleInput(getProtocolController().GOOGLE_PROVIDER_MODE_SEARCH);
      if (!input || !text || typeof text !== 'string') {
        return false;
      }

      const nextValue = buildGoogleSearchFillValue(input.value || '', text);
      getDomController().setFormControlValue(input, nextValue);
      googleSearchReplaceOnNextFill = false;
      return true;
    }

    function navigateToGoogleSearchResults(query) {
      const normalizedQuery = (query || '').trim();
      if (!normalizedQuery) {
        return false;
      }

      const searchUrl = new URL('/search', window.location.origin);
      searchUrl.searchParams.set('q', normalizedQuery);
      window.location.assign(searchUrl.toString());
      return true;
    }

    function findGoogleFileInput() {
      const fileInputs = getDomController().querySelectorAllDeep('input[type="file"]');
      let fallbackInput = null;

      for (const input of fileInputs) {
        const accept = (input.getAttribute('accept') || '').toLowerCase();
        if (accept && accept.includes('image') && !accept.includes('.pdf') && !accept.includes('application/pdf')) {
          return input;
        }

        if (!fallbackInput && (!accept || accept.includes('image') || accept.includes('*'))) {
          fallbackInput = input;
        }
      }

      return fallbackInput;
    }

    /**
     * Finds the AI Mode composer "+" menu trigger. Its aria-label is localized
     * ("添加文件、工具并选择模型"), so it is located structurally as the menu button
     * sharing the smallest ancestor with the visible composer textarea. The page
     * also renders an unrelated "添加笔记本" button that must not be clicked.
     */
    function findGoogleComposerMenuTrigger() {
      const composerInput = getDomController().findDeepFirstVisibleElement(getConfigController().GOOGLE_AI_INPUT_SELECTORS);
      for (let ancestor = composerInput?.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const trigger = [...ancestor.querySelectorAll('button[aria-haspopup="menu"]')]
          .find(getDomController().isVisibleElement);
        if (trigger) {
          return trigger;
        }
      }
      return null;
    }

    function closeGoogleComposerMenu() {
      const trigger = findGoogleComposerMenuTrigger();
      if (trigger?.getAttribute('aria-expanded') !== 'true') {
        return;
      }
      const escape = { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true };
      (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', escape));
    }

    async function openGoogleImagePicker() {
      // The current AI Mode composer only renders its hidden file inputs inside
      // the "+" menu ("添加图片" item), so the menu has to be opened first.
      const menuTrigger = findGoogleComposerMenuTrigger();
      if (menuTrigger) {
        if (menuTrigger.getAttribute('aria-expanded') !== 'true') {
          menuTrigger.click();
        }
        await getDomController().sleep(150);
        const menuInput = findGoogleFileInput();
        if (menuInput) {
          return menuInput;
        }
      }

      const uploadButton = getDomController().findDeepFirstVisibleElement(getConfigController().UPLOAD_BUTTON_SELECTORS.google);
      if (uploadButton) {
        uploadButton.click();
        await getDomController().sleep(150);
      }

      let fileInput = findGoogleFileInput();
      if (fileInput) {
        return fileInput;
      }

      const imageMenuAction = getDomController().findDeepClickableElementByKeywords([
        '更多输入项',
        'add image',
        'upload image',
        'upload file',
        'image',
        'photo',
        '上传图片',
        '上传文件',
        '图片',
        '照片',
        '图像'
      ]);

      if (imageMenuAction) {
        imageMenuAction.click();
        await getDomController().sleep(150);
      }

      fileInput = findGoogleFileInput();
      if (fileInput) {
        return fileInput;
      }

      const addAction = getDomController().findDeepClickableElementByKeywords([
        'add',
        'attach',
        'plus',
        '添加',
        '附件'
      ]);

      if (addAction) {
        addAction.click();
        await getDomController().sleep(150);
      }

      return findGoogleFileInput();
    }

    function clickGoogleSendButton(mode) {
      const normalizedMode = normalizeGoogleProviderMode(mode);

      if (normalizedMode === getProtocolController().GOOGLE_PROVIDER_MODE_SEARCH) {
        const input = findGoogleInput(normalizedMode);
        if (!input) {
          console.warn('[Text Injection] Google Search input not found');
          return false;
        }
        const query = (input.value || '').trim();
        if (!query) {
          return false;
        }

        console.log('[Text Injection] Navigating Google Search mode to results page');
        resetGoogleSearchFillSession();
        return navigateToGoogleSearchResults(query);
      }

      const sendButton = getDomController().findFirstVisibleElement(getConfigController().SEND_BUTTON_SELECTORS.google);
      if (sendButton && !sendButton.disabled && sendButton.getAttribute('aria-disabled') !== 'true') {
        sendButton.click();
        return true;
      }

      const input = findGoogleInput(normalizedMode);
      if (!input) {
        return false;
      }

      input.focus();
      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
      });
      input.dispatchEvent(enterEvent);
      return true;
    }

    // Special handler for Google to create "new search"
    function handleGoogleNewSearch(mode) {
      const normalizedMode = normalizeGoogleProviderMode(mode);
      console.log('[Text Injection] Handling Google new search for mode:', normalizedMode);
      resetGoogleSearchFillSession();
      window.location.href = normalizedMode === getProtocolController().GOOGLE_PROVIDER_MODE_SEARCH
        ? 'https://www.google.com/'
        : 'https://www.google.com/search?udm=50';
      return true;
    }

    function handleGoogleTextInjection(text, autoSubmit, providerMode) {
      const normalizedMode = normalizeGoogleProviderMode(providerMode);

      if (normalizedMode === getProtocolController().GOOGLE_PROVIDER_MODE_SEARCH) {
        const success = fillGoogleSearchInput(text);
        if (success && autoSubmit) {
          setTimeout(() => clickGoogleSendButton(normalizedMode), 100);
        }
        return success;
      }

      const input = findGoogleInput(normalizedMode);
      if (!input) {
        return false;
      }

      const success = getComposerController().injectTextIntoElement(input, text);
      if (success && autoSubmit) {
        setTimeout(() => clickGoogleSendButton(normalizedMode), 500);
      }
      return success;
    }

    // Google AI Mode image injection
    async function injectImageToGoogle(imageData) {
      try {
        let fileInput = findGoogleFileInput();
        if (!fileInput) {
          fileInput = await openGoogleImagePicker();
        }

        if (fileInput) {
          const blob = await getUploadsController().dataUrlToBlob(imageData.dataUrl);
          const file = new File([blob], imageData.name, { type: imageData.type });
          const assigned = getUploadsController().assignFilesToInput(fileInput, [file]);
          if (!assigned) {
            return false;
          }
          fileInput.dispatchEvent(new Event('change', { bubbles: true }));
          // Close the "+" menu only after the change event: the inputs live in
          // the menu, and closing it first could detach them from the page.
          await getDomController().sleep(50);
          closeGoogleComposerMenu();
          console.log('[Image Injection] Google: File input triggered');
          return true;
        }
        console.warn('[Image Injection] Google: No file input found');
        return false;
      } catch (error) {
        console.error('[Image Injection] Google error:', error);
        return false;
      }
    }

    return {
      clearGoogleInput,
      clickGoogleSendButton,
      findGoogleInput,
      handleGoogleNewSearch,
      handleGoogleTextInjection,
      injectImageToGoogle,
      normalizeGoogleProviderMode,
    };
  }

  runtime.factories.createGoogleController = createGoogleController;
})(globalThis.PanelizeContent);
