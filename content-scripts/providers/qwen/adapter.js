(function(runtime) {
  'use strict';

  /**
   * Owns qwen behavior and its page-local state.
   * Deferred controller getters keep composition in the entry point.
   */


  function createQwenController({
    getConfigController,
    getDomController,
    getUploadsController
  }) {
    async function injectImageToQwen(provider, imageData) {
      try {
        const blob = await getUploadsController().dataUrlToBlob(imageData.dataUrl);
        const file = new File([blob], imageData.name, { type: imageData.type });

        if (provider === 'qwen-global') {
          return await injectImageToQwenGlobal(file);
        }

        return await injectImageToQwenChina(file);
      } catch (error) {
        console.error('[Image Injection] Qwen error:', provider, error);
        return false;
      }
    }

    async function injectImageToQwenChina(file) {
      const composer = document.querySelector('[data-chat-input-layout="true"]');
      if (!composer) {
        console.warn('[Image Injection] Qwen China composer not found');
        return false;
      }

      const previewCount = countQwenImagePreviews('qwen-cn');
      let fileInput = findQwenFileInput('qwen-cn');

      // Prefer waking Qwen China's lazy file input without dropping the image.
      if (!fileInput) {
        getUploadsController().dispatchDragEventsToWakeInput(composer, file);
        fileInput = await waitForQwenFileInput('qwen-cn', 1000);
      }

      if (!fileInput) {
        // The current Qwen China composer can accept the native drop directly
        // without ever mounting a file input. Only its new preview is success.
        if (countQwenImagePreviews('qwen-cn') <= previewCount) {
          dispatchFileDragEvents(composer, file);
        }
        const accepted = await waitForQwenImagePreview('qwen-cn', previewCount, 6000);
        if (!accepted) {
          console.warn('[Image Injection] Qwen China image input and preview not found');
        }
        return accepted;
      }

      if (!getUploadsController().assignFilesToInput(fileInput, [file])) {
        return false;
      }

      fileInput.dispatchEvent(new Event('input', { bubbles: true }));
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));

      const accepted = await waitForQwenImagePreview('qwen-cn', previewCount, 6000);
      if (!accepted) {
        console.warn('[Image Injection] Qwen China upload did not produce an image preview');
      }
      return accepted;
    }

    async function injectImageToQwenGlobal(file) {
      const editor = document.querySelector('.message-input-textarea');

      if (!editor) {
        console.warn('[Image Injection] Qwen Global editor not found');
        return false;
      }

      const previewCount = countQwenImagePreviews('qwen-global');
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);

      editor.focus();
      editor.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer
      }));

      const accepted = await waitForQwenImagePreview('qwen-global', previewCount, 6000);
      if (!accepted) {
        console.warn('[Image Injection] Qwen Global upload did not produce an image preview');
      }
      return accepted;
    }

    function dispatchFileDragEvents(target, file) {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);

      ['dragenter', 'dragover', 'drop'].forEach(type => {
        target.dispatchEvent(new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          dataTransfer
        }));
      });
    }

    function findQwenFileInput(provider) {
      const selectors = getConfigController().FILE_INPUT_SELECTORS[provider] || [];
      return selectors
        .map(selector => document.querySelector(selector))
        .find(Boolean) || null;
    }

    async function waitForQwenFileInput(provider, timeoutMs) {
      const start = Date.now();

      while (Date.now() - start < timeoutMs) {
        const fileInput = findQwenFileInput(provider);
        if (fileInput) {
          return fileInput;
        }

        await getDomController().sleep(100);
      }

      return null;
    }

    function countQwenImagePreviews(provider) {
      const selector = provider === 'qwen-cn'
        ? '[data-chat-input-layout="true"] img[alt="avatar"]'
        : '.vision-item-image';
      return document.querySelectorAll(selector).length;
    }

    async function waitForQwenImagePreview(provider, previousCount, timeoutMs) {
      const start = Date.now();

      while (Date.now() - start < timeoutMs) {
        if (countQwenImagePreviews(provider) > previousCount) {
          console.log('[Image Injection] Qwen image preview detected for:', provider);
          return true;
        }

        await getDomController().sleep(100);
      }

      return false;
    }

    return {
      injectImageToQwen,
    };
  }

  runtime.factories.createQwenController = createQwenController;
})(globalThis.PanelizeContent);
