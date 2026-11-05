(function(runtime) {
  'use strict';

  /**
   * Owns chatglm behavior and its page-local state.
   * Deferred controller getters keep composition in the entry point.
   */


  function createChatglmController({
    getDomController,
    getUploadsController
  }) {
    function countChatGLMImagePreviews() {
      const previewList = document.querySelector('.file-list-box-content-list');
      return previewList ? previewList.children.length : 0;
    }

    async function waitForChatGLMImagePreview(previousCount, timeoutMs) {
      const start = Date.now();

      while (Date.now() - start < timeoutMs) {
        if (countChatGLMImagePreviews() > previousCount) {
          console.log('[Image Injection] ChatGLM image preview detected');
          return true;
        }

        await getDomController().sleep(100);
      }

      return false;
    }

    function findChatGLMFileInput() {
      return document.querySelector('.upload-popover input.el-upload__input[type="file"]') ||
        document.querySelector('input.el-upload__input[type="file"]');
    }

    async function waitForChatGLMFileInput(timeoutMs) {
      const start = Date.now();

      while (Date.now() - start < timeoutMs) {
        const fileInput = findChatGLMFileInput();
        if (fileInput) {
          return fileInput;
        }

        await getDomController().sleep(100);
      }

      return null;
    }

    async function injectImageToChatGLM(imageData) {
      try {
        let fileInput = findChatGLMFileInput();

        if (!fileInput) {
          const uploadButton = document.querySelector('.upload-image-btn-container');
          if (uploadButton) {
            uploadButton.click();
            fileInput = await waitForChatGLMFileInput(1000);
          }
        }

        if (!fileInput) {
          console.warn('[Image Injection] ChatGLM image input not found');
          return false;
        }

        const previousCount = countChatGLMImagePreviews();
        const blob = await getUploadsController().dataUrlToBlob(imageData.dataUrl);
        const file = new File([blob], imageData.name, { type: imageData.type });

        if (!getUploadsController().assignFilesToInput(fileInput, [file])) {
          return false;
        }

        fileInput.dispatchEvent(new Event('input', { bubbles: true }));
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));

        const accepted = await waitForChatGLMImagePreview(previousCount, 6000);
        if (!accepted) {
          console.warn('[Image Injection] ChatGLM upload did not produce an image preview');
        }
        return accepted;
      } catch (error) {
        console.error('[Image Injection] ChatGLM error:', error);
        return false;
      }
    }

    return {
      injectImageToChatGLM,
    };
  }

  runtime.factories.createChatglmController = createChatglmController;
})(globalThis.PanelizeContent);
