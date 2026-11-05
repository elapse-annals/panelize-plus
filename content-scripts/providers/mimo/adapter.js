(function(runtime) {
  'use strict';

  /**
   * Owns mimo behavior and its page-local state.
   * Deferred controller getters keep composition in the entry point.
   */


  function createMimoController({
    getConfigController,
    getDomController,
    getUploadsController
  }) {
    function getMimoComposer() {
      const editor = window.ButtonFinderUtils?.findMimoInput() || null;
      return getDomController().findClosestAncestorContaining(editor, 'input[type="file"]');
    }

    function findMimoFileInput(composer) {
      return [...(composer?.querySelectorAll('input[type="file"]') || [])]
        .find(input => input.multiple && getUploadsController().acceptsImageFiles(input)) || null;
    }

    function countMimoCompletedPreviews(composer, fileName) {
      const filenameEvidence = getUploadsController().countFilenamePreviewEvidence(composer, fileName);
      const uploadedImages = [...(composer?.querySelectorAll('img') || [])].filter(image => {
        const source = image.getAttribute('src') || '';
        const container = image.closest(
          '[class*="attachment"], [class*="upload"], [class*="preview"], [class*="file"]'
        );
        return Boolean(container && /^https:\/\//.test(source));
      }).length;
      return Math.max(filenameEvidence, uploadedImages);
    }

    async function injectImageToMimo(imageData, { retry = false } = {}) {
      try {
        const composer = getMimoComposer();
        const fileInput = findMimoFileInput(composer);
        if (!composer || !fileInput) {
          return getUploadsController().createImageInjectionFailure(getConfigController().IMAGE_INJECTION_REASONS.CONTROL_NOT_FOUND);
        }

        const countCompleted = () => countMimoCompletedPreviews(composer, imageData.name);
        if (retry) {
          const reconciled = await getUploadsController().reconcilePendingProviderImage('mimo', imageData, countCompleted);
          if (reconciled) {
            return reconciled;
          }
        }

        const previousCount = countCompleted();
        const file = await getUploadsController().createImageFile(imageData);
        if (!getUploadsController().assignFilesToInput(fileInput, [file])) {
          return getUploadsController().createImageInjectionFailure(getConfigController().IMAGE_INJECTION_REASONS.INJECTION_ERROR);
        }
        getUploadsController().dispatchFileInputEvents(fileInput);

        const accepted = await getUploadsController().waitForPreviewIncrease(countCompleted, previousCount);
        if (accepted) {
          getUploadsController().pendingProviderImageUploads.delete(getUploadsController().getProviderImageKey('mimo', imageData));
          return getUploadsController().createImageInjectionSuccess();
        }

        getUploadsController().rememberPendingProviderImage('mimo', imageData, previousCount);
        return getUploadsController().createImageInjectionFailure(getConfigController().IMAGE_INJECTION_REASONS.PREVIEW_TIMEOUT);
      } catch (error) {
        console.error('[Image Injection] MiMo error:', error);
        return getUploadsController().createImageInjectionFailure(getConfigController().IMAGE_INJECTION_REASONS.INJECTION_ERROR);
      }
    }

    return {
      getMimoComposer,
      injectImageToMimo,
    };
  }

  runtime.factories.createMimoController = createMimoController;
})(globalThis.PanelizeContent);
