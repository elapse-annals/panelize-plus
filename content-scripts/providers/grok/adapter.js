(function(runtime) {
  'use strict';

  /**
   * Owns grok behavior and its page-local state.
   * Deferred controller getters keep composition in the entry point.
   */


  function createGrokController({
    getConfigController,
    getUploadsController
  }) {
    function getGrokComposer() {
      const editor = document.querySelector('[data-testid="chat-input"] [contenteditable="true"]') ||
        document.querySelector('[contenteditable="true"][aria-label="Ask Grok anything"]');
      return editor?.closest('form') || null;
    }

    function findGrokFileInput(composer, imageData) {
      return [...(composer?.querySelectorAll('input[type="file"]') || [])]
        .find(input => getUploadsController().acceptsFile(input, imageData)) || null;
    }

    function countGrokAttachmentPreviews(composer, fileName) {
      const attachmentList = composer?.querySelector('[role="list"][aria-label="Conversation attachments"]');
      const attachmentListCount = attachmentList?.children.length || 0;

      // Grok may render the visible attachment chip in a portal outside the form.
      // The filename is exposed as the preview button/image accessible name.
      const filenameEvidence = getUploadsController().countFilenamePreviewEvidence(document, fileName);
      return Math.max(attachmentListCount, filenameEvidence);
    }

    async function injectImageToGrok(imageData) {
      try {
        const composer = getGrokComposer();
        if (!composer) {
          return getUploadsController().createImageInjectionFailure(getConfigController().IMAGE_INJECTION_REASONS.CONTROL_NOT_FOUND);
        }

        const attachButton = composer.querySelector('button[aria-label="Attach"], button[data-testid="attach-button"]');
        if (!attachButton) {
          return getUploadsController().createImageInjectionFailure(getConfigController().IMAGE_INJECTION_REASONS.CONTROL_NOT_FOUND);
        }

        const file = await getUploadsController().createImageFile(imageData);
        let fileInput = findGrokFileInput(composer, imageData);
        if (!fileInput) {
          // Grok ignores synthetic clicks when deciding whether to open its
          // attachment menu. Its native composer file input is still usable;
          // only use synthetic UI events to wake a lazily mounted input.
          attachButton.click();
          getUploadsController().dispatchDragEventsToWakeInput(composer, file);
          fileInput = await getUploadsController().waitForFileInput(() => findGrokFileInput(composer, imageData));
        }
        if (!fileInput) {
          return getUploadsController().createImageInjectionFailure(getConfigController().IMAGE_INJECTION_REASONS.CONTROL_NOT_FOUND);
        }

        const previousCount = countGrokAttachmentPreviews(composer, imageData.name);
        if (!getUploadsController().assignFilesToInput(fileInput, [file])) {
          return getUploadsController().createImageInjectionFailure(getConfigController().IMAGE_INJECTION_REASONS.INJECTION_ERROR);
        }
        getUploadsController().dispatchFileInputEvents(fileInput);

        const accepted = await getUploadsController().waitForPreviewIncrease(
          () => countGrokAttachmentPreviews(composer, imageData.name),
          previousCount
        );
        return accepted
          ? getUploadsController().createImageInjectionSuccess()
          : getUploadsController().createImageInjectionFailure(getConfigController().IMAGE_INJECTION_REASONS.PREVIEW_TIMEOUT);
      } catch (error) {
        console.error('[Image Injection] Grok error:', error);
        return getUploadsController().createImageInjectionFailure(getConfigController().IMAGE_INJECTION_REASONS.INJECTION_ERROR);
      }
    }

    return {
      getGrokComposer,
      injectImageToGrok,
    };
  }

  runtime.factories.createGrokController = createGrokController;
})(globalThis.PanelizeContent);
