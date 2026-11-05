(function(runtime) {
  'use strict';

  /**
   * Owns kimi behavior and its page-local state.
   * Deferred controller getters keep composition in the entry point.
   */


  function createKimiController({
    getConfigController,
    getDomController,
    getUploadsController
  }) {
    const pendingKimiImageUploads = new Map();

    function getKimiComposer() {
      const editor = document.querySelector('.chat-input-editor[contenteditable="true"]') ||
        document.querySelector('.chat-input-editor');
      return editor?.closest('.chat-editor') || editor?.closest('#chat-box') || null;
    }

    function countKimiAttachmentPreviews(composer) {
      // Kimi promotes the thumbnail to `success` only after its upload API has
      // returned a signed remote image URL. Error thumbnails use a different
      // status class and must not be acknowledged as successful attachments.
      return composer?.querySelectorAll(
        '.image-thumbnail.success .image-wrapper.image-detail img.image-main'
      ).length || 0;
    }

    function countKimiPendingAttachmentPreviews(composer) {
      return composer?.querySelectorAll('.image-thumbnail.loading').length || 0;
    }

    function getKimiImageKey(imageData) {
      if (imageData && imageData.id && typeof imageData.id === 'string') {
        return imageData.id;
      }
      return `${imageData?.name || ''}\u0000${imageData?.type || ''}\u0000${imageData?.dataUrl || ''}`;
    }

    function getKimiThumbnailState(thumbnail) {
      if (!thumbnail?.isConnected) {
        return 'missing';
      }
      if (
        thumbnail.matches('.image-thumbnail.success') &&
        thumbnail.querySelector('.image-wrapper.image-detail img.image-main')
      ) {
        return 'success';
      }
      return thumbnail.matches('.image-thumbnail.loading') ? 'loading' : 'failed';
    }

    async function waitForTrackedKimiThumbnail(thumbnail) {
      const start = Date.now();

      while (Date.now() - start < getConfigController().IMAGE_UPLOAD_PREVIEW_TIMEOUT_MS) {
        const state = getKimiThumbnailState(thumbnail);
        if (state !== 'loading') {
          return state;
        }
        await getDomController().sleep(100);
      }

      return getKimiThumbnailState(thumbnail);
    }

    async function reconcilePendingKimiImage(imageKey, composer) {
      const pendingUpload = pendingKimiImageUploads.get(imageKey);
      if (!pendingUpload) {
        return null;
      }

      // Kimi replaces the original loading thumbnail during upload finalization.
      // The verified success-count increase preserves reconciliation across that
      // replacement while the retry flag keeps it scoped to the failed Fill.
      if (countKimiAttachmentPreviews(composer) > pendingUpload.previousSuccessCount) {
        pendingKimiImageUploads.delete(imageKey);
        return getUploadsController().createImageInjectionSuccess();
      }

      const state = await waitForTrackedKimiThumbnail(pendingUpload.thumbnail);
      if (
        state === 'success' ||
        countKimiAttachmentPreviews(composer) > pendingUpload.previousSuccessCount
      ) {
        pendingKimiImageUploads.delete(imageKey);
        return getUploadsController().createImageInjectionSuccess();
      }
      if (state === 'loading') {
        return getUploadsController().createImageInjectionFailure(getConfigController().IMAGE_INJECTION_REASONS.PREVIEW_TIMEOUT);
      }

      pendingKimiImageUploads.delete(imageKey);
      return null;
    }

    async function waitForKimiPendingPreview(composer, previousSuccessCount) {
      const start = Date.now();

      while (Date.now() - start < getConfigController().IMAGE_UPLOAD_PREVIEW_TIMEOUT_MS) {
        if (countKimiAttachmentPreviews(composer) > previousSuccessCount) {
          return true;
        }
        if (countKimiPendingAttachmentPreviews(composer) === 0) {
          return false;
        }
        await getDomController().sleep(100);
      }

      return false;
    }

    /**
     * Returns Kimi's native upload input. The current composer keeps a hidden
     * multi-file input (no accept attribute) next to the toolkit trigger, and its
     * "Add files & images" menu item only forwards a click to it. Older builds
     * rendered the input inside a "文件和图片" label in the toolkit menu.
     */
    async function findKimiFileInput(composer) {
      const composerInput = composer.querySelector('input[type="file"]');
      if (composerInput) {
        return composerInput;
      }

      const toolkitTrigger = composer.querySelector('.toolkit-trigger-btn');
      if (!toolkitTrigger) {
        return null;
      }

      let uploadEntry = getDomController().findVisibleElementByExactText('label', ['文件和图片', 'Files and images']);
      if (!uploadEntry) {
        toolkitTrigger.click();
        await getDomController().sleep(100);
        uploadEntry = getDomController().findVisibleElementByExactText('label', ['文件和图片', 'Files and images']);
      }
      return uploadEntry?.querySelector('input[type="file"]') || null;
    }

    async function injectImageToKimi(imageData, { retry = false } = {}) {
      try {
        const composer = getKimiComposer();
        if (!composer) {
          return getUploadsController().createImageInjectionFailure(getConfigController().IMAGE_INJECTION_REASONS.CONTROL_NOT_FOUND);
        }

        // A Kimi upload can finish after the first Fill has already timed out.
        // Reconcile the exact thumbnail created by that attempt before retrying.
        const imageKey = getKimiImageKey(imageData);
        if (retry) {
          const reconciledResult = await reconcilePendingKimiImage(imageKey, composer);
          if (reconciledResult) {
            return reconciledResult;
          }
        } else {
          pendingKimiImageUploads.clear();
        }

        const previousCount = countKimiAttachmentPreviews(composer);
        if (countKimiPendingAttachmentPreviews(composer) > 0) {
          if (pendingKimiImageUploads.has(imageKey)) {
            const pendingAccepted = await waitForKimiPendingPreview(composer, previousCount);
            return pendingAccepted
              ? getUploadsController().createImageInjectionSuccess()
              : getUploadsController().createImageInjectionFailure(getConfigController().IMAGE_INJECTION_REASONS.PREVIEW_TIMEOUT);
          }
          return getUploadsController().createImageInjectionFailure(getConfigController().IMAGE_INJECTION_REASONS.PREVIEW_TIMEOUT);
        }

        const fileInput = await findKimiFileInput(composer);
        if (!fileInput) {
          return getUploadsController().createImageInjectionFailure(getConfigController().IMAGE_INJECTION_REASONS.UNSUPPORTED);
        }
        if (!getUploadsController().acceptsFile(fileInput, imageData)) {
          return getUploadsController().createImageInjectionFailure(getConfigController().IMAGE_INJECTION_REASONS.CONTROL_NOT_FOUND);
        }

        const file = await getUploadsController().createImageFile(imageData);
        const previousThumbnails = new Set(composer.querySelectorAll('.image-thumbnail'));
        if (!getUploadsController().assignFilesToInput(fileInput, [file])) {
          return getUploadsController().createImageInjectionFailure(getConfigController().IMAGE_INJECTION_REASONS.INJECTION_ERROR);
        }
        getUploadsController().dispatchFileInputEvents(fileInput);

        const accepted = await getUploadsController().waitForPreviewIncrease(
          () => countKimiAttachmentPreviews(composer),
          previousCount
        );
        if (accepted) {
          pendingKimiImageUploads.delete(imageKey);
          return getUploadsController().createImageInjectionSuccess();
        }

        const newThumbnail = [...composer.querySelectorAll('.image-thumbnail')]
          .find(thumbnail => !previousThumbnails.has(thumbnail));
        const thumbnailState = getKimiThumbnailState(newThumbnail);
        if (thumbnailState === 'success') {
          pendingKimiImageUploads.delete(imageKey);
          return getUploadsController().createImageInjectionSuccess();
        }
        if (thumbnailState === 'loading') {
          pendingKimiImageUploads.set(imageKey, {
            thumbnail: newThumbnail,
            previousSuccessCount: previousCount
          });
        }
        return getUploadsController().createImageInjectionFailure(getConfigController().IMAGE_INJECTION_REASONS.PREVIEW_TIMEOUT);
      } catch (error) {
        console.error('[Image Injection] Kimi error:', error);
        return getUploadsController().createImageInjectionFailure(getConfigController().IMAGE_INJECTION_REASONS.INJECTION_ERROR);
      }
    }

    return {
      getKimiComposer,
      injectImageToKimi,
    };
  }

  runtime.factories.createKimiController = createKimiController;
})(globalThis.PanelizeContent);
