(function(runtime) {
  'use strict';

  /**
   * Owns yuanbao behavior and its page-local state.
   * Deferred controller getters keep composition in the entry point.
   */


  function createYuanbaoController({
    getConfigController,
    getDomController,
    getUploadsController
  }) {
    function getYuanbaoComposer() {
      const editor = document.querySelector(
        '.chat-command-editor-specail .ql-editor[contenteditable="true"]'
      ) || document.querySelector('.ql-editor[contenteditable="true"][data-placeholder]');
      return getDomController().findClosestAncestorContaining(editor, '[data-new-input-control="add-tools-trigger"]') ||
        editor?.closest('[data-input-editor-area="true"]')?.parentElement ||
        editor?.parentElement?.parentElement ||
        null;
    }

    function findYuanbaoFileInput() {
      return [...document.querySelectorAll('input[type="file"]')]
        .find(input => input.multiple && getUploadsController().acceptsImageFiles(input)) || null;
    }

    function countYuanbaoCompletedPreviews(fileName) {
      const normalizedName = (fileName || '').trim().toLowerCase();
      return [...document.querySelectorAll('img[alt]')].filter(image => {
        const source = image.getAttribute('src') || '';
        const alt = (image.getAttribute('alt') || '').trim().toLowerCase();
        return (
          alt === normalizedName &&
          /^https:\/\//.test(source) &&
          image.closest('[class*="FileList_inputFileListItem"]')
        );
      }).length;
    }

    async function openYuanbaoImagePicker(composer) {
      const addButton = composer?.querySelector('[data-new-input-control="add-tools-trigger"]') ||
        getDomController().findFirstVisibleElement(getConfigController().UPLOAD_BUTTON_SELECTORS.yuanbao);
      if (!addButton) {
        return null;
      }

      addButton.click();
      await getDomController().sleep(100);

      const uploadAction = getDomController().findVisibleElementByExactText(
        'button, [role="menuitem"]',
        ['Upload Image', '上传图片']
      );
      if (!uploadAction) {
        return null;
      }

      uploadAction.click();
      return getUploadsController().waitForFileInput(findYuanbaoFileInput, 1000);
    }

    async function injectImageToYuanbao(imageData, { retry = false } = {}) {
      try {
        const composer = getYuanbaoComposer();
        if (!composer) {
          return getUploadsController().createImageInjectionFailure(getConfigController().IMAGE_INJECTION_REASONS.CONTROL_NOT_FOUND);
        }

        const countCompleted = () => countYuanbaoCompletedPreviews(imageData.name);
        if (retry) {
          const reconciled = await getUploadsController().reconcilePendingProviderImage(
            'yuanbao',
            imageData,
            countCompleted
          );
          if (reconciled) {
            return reconciled;
          }
        }

        let fileInput = findYuanbaoFileInput();
        if (!fileInput) {
          fileInput = await openYuanbaoImagePicker(composer);
        }
        if (!fileInput) {
          return getUploadsController().createImageInjectionFailure(getConfigController().IMAGE_INJECTION_REASONS.CONTROL_NOT_FOUND);
        }

        const previousCount = countCompleted();
        const file = await getUploadsController().createImageFile(imageData);
        if (!getUploadsController().assignFilesToInput(fileInput, [file])) {
          return getUploadsController().createImageInjectionFailure(getConfigController().IMAGE_INJECTION_REASONS.INJECTION_ERROR);
        }
        getUploadsController().dispatchFileInputEvents(fileInput);

        const accepted = await getUploadsController().waitForPreviewIncrease(countCompleted, previousCount);
        if (accepted) {
          getUploadsController().pendingProviderImageUploads.delete(getUploadsController().getProviderImageKey('yuanbao', imageData));
          return getUploadsController().createImageInjectionSuccess();
        }

        getUploadsController().rememberPendingProviderImage('yuanbao', imageData, previousCount);
        return getUploadsController().createImageInjectionFailure(getConfigController().IMAGE_INJECTION_REASONS.PREVIEW_TIMEOUT);
      } catch (error) {
        console.error('[Image Injection] Yuanbao error:', error);
        return getUploadsController().createImageInjectionFailure(getConfigController().IMAGE_INJECTION_REASONS.INJECTION_ERROR);
      }
    }

    return {
      getYuanbaoComposer,
      injectImageToYuanbao,
    };
  }

  runtime.factories.createYuanbaoController = createYuanbaoController;
})(globalThis.PanelizeContent);
