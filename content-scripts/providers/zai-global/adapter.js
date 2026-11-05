(function(runtime) {
  'use strict';

  /**
   * Owns zai global behavior and its page-local state.
   * Deferred controller getters keep composition in the entry point.
   */


  function createZaiGlobalController({
    getDomController,
    getUploadsController
  }) {
    function countZaiGlobalImagePreviews() {
      return document.querySelectorAll('.chip-scroll img[data-cy="image"]').length;
    }

    async function waitForZaiGlobalImagePreview(previousCount, timeoutMs) {
      const start = Date.now();

      while (Date.now() - start < timeoutMs) {
        if (countZaiGlobalImagePreviews() > previousCount) {
          console.log('[Image Injection] Z.ai Global image preview detected');
          return true;
        }

        await getDomController().sleep(100);
      }

      return false;
    }

    async function injectImageToZaiGlobal(imageData) {
      try {
        const fileInput = document.querySelector('input[type="file"][multiple][accept*=".png"]');
        if (!fileInput) {
          console.warn('[Image Injection] Z.ai Global image input not found');
          return false;
        }

        const previousCount = countZaiGlobalImagePreviews();
        const blob = await getUploadsController().dataUrlToBlob(imageData.dataUrl);
        const file = new File([blob], imageData.name, { type: imageData.type });

        if (!getUploadsController().assignFilesToInput(fileInput, [file])) {
          return false;
        }

        fileInput.dispatchEvent(new Event('input', { bubbles: true }));
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));

        const accepted = await waitForZaiGlobalImagePreview(previousCount, 6000);
        if (!accepted) {
          console.warn('[Image Injection] Z.ai Global upload did not produce an image preview');
        }
        return accepted;
      } catch (error) {
        console.error('[Image Injection] Z.ai Global error:', error);
        return false;
      }
    }

    return {
      injectImageToZaiGlobal,
    };
  }

  runtime.factories.createZaiGlobalController = createZaiGlobalController;
})(globalThis.PanelizeContent);
