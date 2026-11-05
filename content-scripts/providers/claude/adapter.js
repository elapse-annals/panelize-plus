(function(runtime) {
  'use strict';

  /**
   * Owns claude behavior and its page-local state.
   * Deferred controller getters keep composition in the entry point.
   */


  function createClaudeController({
    getConfigController,
    getDomController,
    getUploadsController
  }) {
    // Claude-specific image injection
    async function injectImageToClaude(imageData) {
      try {
        // Claude: find the file input (it's usually hidden)
        const fileInput = document.querySelector('input[type="file"]');
        if (fileInput) {
          const blob = await getUploadsController().dataUrlToBlob(imageData.dataUrl);
          const file = new File([blob], imageData.name, { type: imageData.type });
          const dataTransfer = new DataTransfer();
          dataTransfer.items.add(file);
          fileInput.files = dataTransfer.files;
          fileInput.dispatchEvent(new Event('change', { bubbles: true }));
          console.log('[Image Injection] Claude: File input triggered');
          return true;
        }

        // Try clicking the attachment button first
        const attachBtnSelectors = getConfigController().UPLOAD_BUTTON_SELECTORS.claude;
        for (const selector of attachBtnSelectors) {
          const btn = document.querySelector(selector);
          if (btn) {
            btn.click();
            await getDomController().sleep(300);
            // Now try to find and use the file input
            const input = document.querySelector('input[type="file"]');
            if (input) {
              const blob = await getUploadsController().dataUrlToBlob(imageData.dataUrl);
              const file = new File([blob], imageData.name, { type: imageData.type });
              const dataTransfer = new DataTransfer();
              dataTransfer.items.add(file);
              input.files = dataTransfer.files;
              input.dispatchEvent(new Event('change', { bubbles: true }));
              console.log('[Image Injection] Claude: File input triggered after button click');
              return true;
            }
          }
        }

        console.warn('[Image Injection] Claude: No file input found');
        return false;
      } catch (error) {
        console.error('[Image Injection] Claude error:', error);
        return false;
      }
    }

    return {
      injectImageToClaude,
    };
  }

  runtime.factories.createClaudeController = createClaudeController;
})(globalThis.PanelizeContent);
