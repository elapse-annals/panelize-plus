(function(runtime) {
  'use strict';

  /**
   * Owns uploads behavior and its page-local state.
   * Deferred controller getters keep composition in the entry point.
   */


  function createUploadsController({
    getAnswersController,
    getChatglmController,
    getChatgptController,
    getClaudeController,
    getComposerController,
    getConfigController,
    getDeepseekController,
    getDomController,
    getDoubaoController,
    getFocusController,
    getGeminiController,
    getGoogleController,
    getGrokController,
    getKimiController,
    getMimoController,
    getProtocolController,
    getQwenController,
    getSendingController,
    getYuanbaoController,
    getZaiGlobalController
  }) {
    const pendingProviderImageUploads = new Map();

    function assignFilesToInput(fileInput, files) {
      if (!fileInput || !files || files.length === 0) {
        return false;
      }

      try {
        const dataTransfer = new DataTransfer();
        files.forEach(file => dataTransfer.items.add(file));
        fileInput.files = dataTransfer.files;
        return true;
      } catch (error) {
        try {
          Object.defineProperty(fileInput, 'files', {
            configurable: true,
            value: files
          });
          return true;
        } catch (fallbackError) {
          console.error('[Image Injection] Failed to assign files to input:', fallbackError);
          return false;
        }
      }
    }

    // Handle image injection message
    async function handleImageInjection(event) {
      const { text, images, autoSubmit, requestId, retry = false } = event.data;
      const provider = getConfigController().detectProvider();
      const providerMode = provider === 'google'
        ? getGoogleController().normalizeGoogleProviderMode(event.data.providerMode)
        : null;

      if (!provider) {
        console.warn('[Image Injection] Provider not detected');
        return createImageInjectionFailure(getConfigController().IMAGE_INJECTION_REASONS.CONTROL_NOT_FOUND, []);
      }

      if (provider === 'google' && providerMode === getProtocolController().GOOGLE_PROVIDER_MODE_SEARCH) {
        console.warn('[Image Injection] Google Search mode does not support image injection, falling back to text only');
        // The text is filled but not sent: sending would drop the attachments.
        if (text && text.trim()) {
          getGoogleController().handleGoogleTextInjection(text, false, providerMode);
        }
        return createImageInjectionFailure(getConfigController().IMAGE_INJECTION_REASONS.UNSUPPORTED, []);
      }

      if (!getConfigController().PROVIDER_IMAGE_SUPPORT[provider]) {
        console.warn('[Image Injection] Provider does not support images:', provider);
        // For providers that don't support images, just inject text
        // The text is filled but not sent: sending would drop the attachments.
        if (text) {
          getComposerController().injectText(provider, text, false, providerMode);
        }
        return createImageInjectionFailure(getConfigController().IMAGE_INJECTION_REASONS.UNSUPPORTED, []);
      }

      if (!images || images.length === 0) {
        if (retry && text && text.trim()) {
          const textInjected = getComposerController().injectText(
            provider,
            text,
            autoSubmit,
            providerMode,
            { skipIfAlreadyPresent: true, waitForSendReady: true }
          );
          return textInjected
            ? createImageInjectionSuccess([])
            : createImageInjectionFailure(getConfigController().IMAGE_INJECTION_REASONS.CONTROL_NOT_FOUND, []);
        }
        console.warn('[Image Injection] No images provided');
        return createImageInjectionFailure(getConfigController().IMAGE_INJECTION_REASONS.INJECTION_ERROR, []);
      }

      console.log(`[Image Injection] Injecting ${images.length} images to ${provider}`);

      try {
        // Fills protect the unified input's focus too, so report a click in
        // the panel to hand focus back to the user.
        if (requestId) {
          getFocusController().startMultiPanelUserInteractionTracking(requestId, provider);
        } else {
          getFocusController().stopMultiPanelUserInteractionTracking();
        }

        if (provider === 'chatgpt' && autoSubmit && requestId) {
          getChatgptController().startChatgptSendTracking(requestId);
        }
        if (autoSubmit && requestId) {
          getAnswersController().startResponseTiming(provider, requestId);
          getAnswersController().startAnswerEngagement(provider, requestId);
        }

        const succeededImageIds = [];
        const imageInjectionResults = [];

        // Inject images first
        for (const image of images) {
          const result = await injectSingleImage(provider, image, { retry });
          imageInjectionResults.push(result);
          if (result.ok) {
            if (image.id && typeof image.id === 'string') {
              succeededImageIds.push(image.id);
            }
          } else {
            break;
          }
          // Wait a bit between images
          await getDomController().sleep(200);
        }

        const allImagesInjected = imageInjectionResults.length === images.length &&
          imageInjectionResults.every(result => result.ok);
        if (!allImagesInjected) {
          console.warn('[Image Injection] One or more images failed to inject for:', provider);
        }

        // Wait for images to upload
        await getDomController().sleep(500);

        // Then inject text if provided
        let textInjected = true;
        if (text && text.trim()) {
          await getDomController().sleep(300);
          textInjected = getComposerController().injectText(
            provider,
            text,
            autoSubmit && allImagesInjected,
            providerMode,
            { skipIfAlreadyPresent: retry, waitForSendReady: true }
          );
        } else if (autoSubmit) {
          if (!allImagesInjected) {
            console.warn('[Image Injection] Skipping auto-submit because image injection failed for:', provider);
            const firstFailure = imageInjectionResults.find(result => !result.ok);
            return createImageInjectionFailure(
              firstFailure?.reason || getConfigController().IMAGE_INJECTION_REASONS.INJECTION_ERROR,
              succeededImageIds
            );
          }
          // If no text but autoSubmit is true, click send button
          await getDomController().sleep(300);
          getSendingController().clickSendButtonWhenReady(provider, providerMode);
        }

        if (!allImagesInjected) {
          const firstFailure = imageInjectionResults.find(result => !result.ok);
          return createImageInjectionFailure(
            firstFailure?.reason || getConfigController().IMAGE_INJECTION_REASONS.INJECTION_ERROR,
            succeededImageIds
          );
        }

        if (!textInjected) {
          return createImageInjectionFailure(
            getConfigController().IMAGE_INJECTION_REASONS.CONTROL_NOT_FOUND,
            succeededImageIds
          );
        }

        return createImageInjectionSuccess(succeededImageIds);
      } catch (error) {
        console.error('[Image Injection] Error:', error);
        return createImageInjectionFailure(getConfigController().IMAGE_INJECTION_REASONS.INJECTION_ERROR, []);
      }
    }

    function createImageInjectionSuccess(succeededImageIds = []) {
      return { ok: true, succeededImageIds };
    }

    function createImageInjectionFailure(reason, succeededImageIds = []) {
      return { ok: false, reason, succeededImageIds };
    }

    function normalizeImageInjectionResult(result) {
      if (result && typeof result.ok === 'boolean') {
        return result;
      }

      return result
        ? createImageInjectionSuccess()
        : createImageInjectionFailure(getConfigController().IMAGE_INJECTION_REASONS.INJECTION_ERROR);
    }

    // Inject a single image to the provider using provider-specific strategy
    async function injectSingleImage(provider, imageData, { retry = false } = {}) {
      console.log('[Image Injection] Injecting image to', provider);

      if (!isImageFileData(imageData) && !getConfigController().PROVIDER_FILE_SUPPORT.has(provider)) {
        console.warn('[Image Injection] Provider does not take non-image files:', provider);
        return createImageInjectionFailure(getConfigController().IMAGE_INJECTION_REASONS.UNSUPPORTED);
      }

      // Use provider-specific strategies
      let result;
      switch (provider) {
        case 'chatgpt':
          result = await getChatgptController().injectImageToChatGPT(imageData);
          break;
        case 'claude':
          result = await getClaudeController().injectImageToClaude(imageData);
          break;
        case 'gemini':
          result = await getGeminiController().injectImageToGemini(imageData);
          break;
        case 'grok':
          result = await getGrokController().injectImageToGrok(imageData);
          break;
        case 'deepseek':
          result = await getDeepseekController().injectImageToDeepSeek(imageData);
          break;
        case 'kimi':
          result = await getKimiController().injectImageToKimi(imageData, { retry });
          break;
        case 'doubao':
          result = await getDoubaoController().injectImageToDoubao(imageData);
          break;
        case 'qwen-cn':
        case 'qwen-global':
          result = await getQwenController().injectImageToQwen(provider, imageData);
          break;
        case 'chatglm':
          result = await getChatglmController().injectImageToChatGLM(imageData);
          break;
        case 'zai-global':
          result = await getZaiGlobalController().injectImageToZaiGlobal(imageData);
          break;
        case 'yuanbao':
          result = await getYuanbaoController().injectImageToYuanbao(imageData, { retry });
          break;
        case 'mimo':
          result = await getMimoController().injectImageToMimo(imageData, { retry });
          break;
        case 'google':
          result = await getGoogleController().injectImageToGoogle(imageData);
          break;
        default:
          // Fallback: try file input first, then drag-drop
          if (await tryFileInputUpload(provider, imageData)) {
            result = true;
            break;
          }
          result = await tryDragDropUpload(provider, imageData);
          break;
      }

      return normalizeImageInjectionResult(result);
    }

    function acceptsImageFiles(fileInput) {
      const accept = (fileInput?.getAttribute('accept') || '').toLowerCase();
      return !accept || accept.includes('image/') || [
        '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.avif', '.apng'
      ].some(extension => accept.includes(extension));
    }

    function isImageFileData(fileData) {
      return typeof fileData?.type === 'string' && fileData.type.startsWith('image/');
    }

    // Whether the input's accept filter takes this file; images keep the image check.
    function acceptsFile(fileInput, fileData) {
      if (isImageFileData(fileData)) {
        return acceptsImageFiles(fileInput);
      }
      const accept = (fileInput?.getAttribute('accept') || '').toLowerCase();
      if (!accept) {
        return true;
      }
      const type = (fileData?.type || '').toLowerCase();
      const name = (fileData?.name || '').toLowerCase();
      return accept.split(',').map(entry => entry.trim()).filter(Boolean).some(entry => {
        if (entry === '*' || entry === '*/*') return true;
        if (entry.startsWith('.')) return name.endsWith(entry);
        if (entry.endsWith('/*')) return type.startsWith(entry.slice(0, -1));
        return entry === type;
      });
    }

    async function createImageFile(imageData) {
      const blob = await dataUrlToBlob(imageData.dataUrl);
      return new File([blob], imageData.name, { type: imageData.type });
    }

    function dispatchFileInputEvents(fileInput) {
      fileInput.dispatchEvent(new Event('input', { bubbles: true }));
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function dispatchDragEventsToWakeInput(target, file) {
      if (!target) {
        return;
      }

      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      ['dragenter', 'dragover', 'dragleave'].forEach(type => {
        target.dispatchEvent(new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          dataTransfer
        }));
      });
    }

    async function waitForFileInput(findFileInput, timeoutMs = 1000) {
      const start = Date.now();

      while (Date.now() - start < timeoutMs) {
        const fileInput = findFileInput();
        if (fileInput) {
          return fileInput;
        }
        await getDomController().sleep(100);
      }

      return null;
    }

    async function waitForPreviewIncrease(getCount, previousCount, timeoutMs = getConfigController().IMAGE_UPLOAD_PREVIEW_TIMEOUT_MS) {
      const start = Date.now();

      while (Date.now() - start < timeoutMs) {
        if (getCount() > previousCount) {
          return true;
        }
        await getDomController().sleep(100);
      }

      return false;
    }

    function countFilenamePreviewEvidence(root, fileName) {
      if (!root) {
        return 0;
      }

      const normalizedName = (fileName || '').trim().toLowerCase();
      const evidence = new Set();

      root.querySelectorAll(
        'img[alt], button, [role="button"], [aria-label], [title], [data-file-name], [data-filename]'
      ).forEach(element => {
        const alt = (element.getAttribute('alt') || '').trim().toLowerCase();
        const fileNameData = (
          element.getAttribute('data-file-name') ||
          element.getAttribute('data-filename') ||
          ''
        ).trim().toLowerCase();
        const accessibleText = getDomController().getElementAccessibleText(element);
        if (
          alt === normalizedName ||
          fileNameData === normalizedName ||
          accessibleText.includes(normalizedName)
        ) {
          evidence.add(element.closest('button, [role="button"]') || element);
        }
      });

      return evidence.size;
    }

    function getProviderImageKey(provider, imageData) {
      const imageKey = imageData?.id && typeof imageData.id === 'string'
        ? imageData.id
        : `${imageData?.name || ''}\u0000${imageData?.type || ''}\u0000${imageData?.dataUrl || ''}`;
      return `${provider}\u0000${imageKey}`;
    }

    async function reconcilePendingProviderImage(provider, imageData, countCompletedPreviews) {
      const imageKey = getProviderImageKey(provider, imageData);
      const pendingUpload = pendingProviderImageUploads.get(imageKey);
      if (!pendingUpload) {
        return null;
      }

      if (countCompletedPreviews() > pendingUpload.previousCount) {
        pendingProviderImageUploads.delete(imageKey);
        return createImageInjectionSuccess();
      }

      if (Date.now() - pendingUpload.startedAt >= 30000) {
        pendingProviderImageUploads.delete(imageKey);
        return null;
      }

      const accepted = await waitForPreviewIncrease(
        countCompletedPreviews,
        pendingUpload.previousCount
      );
      if (accepted) {
        pendingProviderImageUploads.delete(imageKey);
        return createImageInjectionSuccess();
      }

      return createImageInjectionFailure(getConfigController().IMAGE_INJECTION_REASONS.PREVIEW_TIMEOUT);
    }

    function rememberPendingProviderImage(provider, imageData, previousCount) {
      pendingProviderImageUploads.set(getProviderImageKey(provider, imageData), {
        previousCount,
        startedAt: Date.now()
      });
    }

    // Generic drag-drop fallback for providers without a dedicated adapter.
    async function tryDragDropUpload(provider, imageData) {
      try {
        const targetElement = getComposerController().findProviderInput(provider);

        if (!targetElement) {
          console.warn('[Image Injection] No target element found for drag-drop');
          return false;
        }

        // Convert dataUrl to blob
        const blob = await dataUrlToBlob(imageData.dataUrl);

        // Create File object from blob
        const file = new File([blob], imageData.name, { type: imageData.type });

        // Create DataTransfer with file
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);

        // Focus the element first
        targetElement.focus();

        // Dispatch drag events sequence
        const dragEnterEvent = new DragEvent('dragenter', {
          bubbles: true,
          cancelable: true,
          dataTransfer: dataTransfer
        });

        const dragOverEvent = new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          dataTransfer: dataTransfer
        });

        const dropEvent = new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer: dataTransfer
        });

        targetElement.dispatchEvent(dragEnterEvent);
        targetElement.dispatchEvent(dragOverEvent);
        targetElement.dispatchEvent(dropEvent);

        return true;
      } catch (error) {
        console.error('[Image Injection] Drag-drop upload failed:', error);
        return false;
      }
    }

    // Fallback: Try to upload image via file input
    async function tryFileInputUpload(provider, imageData) {
      try {
        const fileInputSelectors = getConfigController().FILE_INPUT_SELECTORS[provider] || [];

        // First try specific selectors
        let fileInput = null;
        for (const selector of fileInputSelectors) {
          fileInput = document.querySelector(selector);
          if (fileInput) break;
        }

        // If no direct file input, try to find any file input
        if (!fileInput) {
          const allFileInputs = document.querySelectorAll('input[type="file"]');
          for (const input of allFileInputs) {
            if (!input.accept || input.accept.includes('image') || input.accept.includes('*')) {
              fileInput = input;
              break;
            }
          }
        }

        if (!fileInput) {
          console.warn('[Image Injection] No file input found');
          return false;
        }

        // Convert dataUrl to blob
        const blob = await dataUrlToBlob(imageData.dataUrl);

        // Create File object
        const file = new File([blob], imageData.name, { type: imageData.type });

        // Create FileList-like object
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        fileInput.files = dataTransfer.files;

        // Trigger change event
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));

        return true;
      } catch (error) {
        console.error('[Image Injection] File input upload failed:', error);
        return false;
      }
    }

    // Convert data URL to Blob
    function dataUrlToBlob(dataUrl) {
      return new Promise((resolve, reject) => {
        try {
          const arr = dataUrl.split(',');
          const mime = arr[0].match(/:(.*?);/)[1];
          const bstr = atob(arr[1]);
          let n = bstr.length;
          const u8arr = new Uint8Array(n);
          while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
          }
          resolve(new Blob([u8arr], { type: mime }));
        } catch (error) {
          reject(error);
        }
      });
    }

    return {
      acceptsFile,
      acceptsImageFiles,
      assignFilesToInput,
      countFilenamePreviewEvidence,
      createImageFile,
      createImageInjectionFailure,
      createImageInjectionSuccess,
      dataUrlToBlob,
      dispatchDragEventsToWakeInput,
      dispatchFileInputEvents,
      getProviderImageKey,
      handleImageInjection,
      get pendingProviderImageUploads() { return pendingProviderImageUploads; },
      reconcilePendingProviderImage,
      rememberPendingProviderImage,
      waitForFileInput,
      waitForPreviewIncrease,
    };
  }

  runtime.factories.createUploadsController = createUploadsController;
})(globalThis.PanelizeContent);
