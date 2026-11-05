(function(runtime) {
  'use strict';

  /**
   * Owns deepseek behavior and its page-local state.
   * Deferred controller getters keep composition in the entry point.
   */


  function createDeepseekController({
    getConfigController,
    getDomController,
    getUploadsController
  }) {
    function getDeepSeekComposer() {
      const editor = document.querySelector('textarea[placeholder="Message DeepSeek"]') ||
        document.querySelector('textarea.ds-scroll-area') ||
        document.querySelector('textarea');
      return getDomController().findClosestAncestorContaining(editor, 'input[type="file"]');
    }

    function findDeepSeekFileInput(composer, imageData) {
      return [...(composer?.querySelectorAll('input[type="file"]') || [])]
        .find(input => input.multiple && getUploadsController().acceptsFile(input, imageData)) || null;
    }

    async function injectImageToDeepSeek(imageData) {
      try {
        const composer = getDeepSeekComposer();
        if (!composer) {
          return getUploadsController().createImageInjectionFailure(getConfigController().IMAGE_INJECTION_REASONS.CONTROL_NOT_FOUND);
        }

        const file = await getUploadsController().createImageFile(imageData);
        let fileInput = findDeepSeekFileInput(composer, imageData);
        if (!fileInput) {
          getUploadsController().dispatchDragEventsToWakeInput(composer, file);
          fileInput = await getUploadsController().waitForFileInput(() => findDeepSeekFileInput(composer, imageData));
        }
        if (!fileInput) {
          return getUploadsController().createImageInjectionFailure(getConfigController().IMAGE_INJECTION_REASONS.CONTROL_NOT_FOUND);
        }

        // DeepSeek renders attachment previews beside the composer controls rather
        // than consistently inside the nearest file-input ancestor.
        const previousCount = getUploadsController().countFilenamePreviewEvidence(document, imageData.name);
        if (!getUploadsController().assignFilesToInput(fileInput, [file])) {
          return getUploadsController().createImageInjectionFailure(getConfigController().IMAGE_INJECTION_REASONS.INJECTION_ERROR);
        }
        getUploadsController().dispatchFileInputEvents(fileInput);

        const accepted = await getUploadsController().waitForPreviewIncrease(
          () => getUploadsController().countFilenamePreviewEvidence(document, imageData.name),
          previousCount
        );
        return accepted
          ? getUploadsController().createImageInjectionSuccess()
          : getUploadsController().createImageInjectionFailure(getConfigController().IMAGE_INJECTION_REASONS.PREVIEW_TIMEOUT);
      } catch (error) {
        console.error('[Image Injection] DeepSeek error:', error);
        return getUploadsController().createImageInjectionFailure(getConfigController().IMAGE_INJECTION_REASONS.INJECTION_ERROR);
      }
    }

    return {
      getDeepSeekComposer,
      injectImageToDeepSeek,
    };
  }

  runtime.factories.createDeepseekController = createDeepseekController;
})(globalThis.PanelizeContent);
