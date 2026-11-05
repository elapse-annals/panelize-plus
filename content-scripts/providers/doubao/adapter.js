(function(runtime) {
  'use strict';

  /**
   * Owns doubao behavior and its page-local state.
   * Deferred controller getters keep composition in the entry point.
   */


  function createDoubaoController({
    getConfigController,
    getDomController,
    getUploadsController
  }) {
    function findDoubaoOverlay() {
      const sidebar = document.querySelector('#flow_chat_sidebar');
      const visible = selectors => getDomController().querySelectorAllDeep(selectors.join(', ')).filter(getDomController().isVisibleElement);
      const dialogs = visible(getConfigController().DOUBAO_OVERLAY_DIALOG_SELECTORS);
      const blocking = visible(getConfigController().DOUBAO_BLOCKING_DIALOG_SELECTORS)[0] || dialogs.find(dialog => {
        if (sidebar && (dialog.contains(sidebar) || sidebar.contains(dialog))) return false;
        const text = getDomController().getElementAccessibleText(dialog);
        return getConfigController().DOUBAO_BLOCKING_DIALOG_KEYWORDS.some(keyword => text.includes(keyword));
      });
      if (blocking) return { element: blocking, blocking: true };

      const element = visible(getConfigController().DOUBAO_OVERLAY_MASK_SELECTORS)[0] || dialogs[0] || null;
      return element ? { element, blocking: false } : null;
    }

    // Close a sidebar drawer or plain dialog: click its mask, then its close or
    // collapse control, then fall back to Escape. Never call this for a login or
    // rate-limit prompt; those need the user.
    function dismissDoubaoOverlay(overlay, attempt = 0) {
      if (!overlay || overlay.blocking) return false;
      const strategy = attempt % 3;
      if (strategy === 0) {
        const mask = getDomController().findFirstVisibleElement(getConfigController().DOUBAO_OVERLAY_MASK_SELECTORS);
        if (mask) {
          mask.click();
          return true;
        }
      }
      if (strategy <= 1) {
        const closeButton = [...overlay.element.querySelectorAll(getConfigController().DOUBAO_OVERLAY_CLOSE_SELECTORS.join(', '))]
          .find(candidate => getDomController().isVisibleElement(candidate) && getDomController().isElementUncovered(candidate)) ||
          getDomController().findDeepFirstVisibleElement(getConfigController().DOUBAO_SIDEBAR_COLLAPSE_SELECTORS, getDomController().isElementUncovered);
        if (closeButton) {
          closeButton.click();
          return true;
        }
      }
      const target = document.activeElement || document.body;
      ['keydown', 'keyup'].forEach(type => {
        target.dispatchEvent(new KeyboardEvent(type, {
          key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true
        }));
      });
      return true;
    }

    // Clicking the control from an open drawer can leave the drawer and its
    // mask over the composer once the new chat renders.
    function scheduleDoubaoOverlayCleanup(attempt = 0) {
      setTimeout(() => {
        const overlay = findDoubaoOverlay();
        if (!overlay || overlay.blocking) return;
        dismissDoubaoOverlay(overlay, attempt);
        if (attempt < 2) scheduleDoubaoOverlayCleanup(attempt + 1);
      }, 300);
    }

    function isDoubaoProjectControl(element) {
      const text = getDomController().getElementAccessibleText(element);
      return getConfigController().DOUBAO_PROJECT_KEYWORDS.some(keyword => text.includes(keyword));
    }

    async function injectImageToDoubao(imageData) {
      try {
        const blob = await getUploadsController().dataUrlToBlob(imageData.dataUrl);
        const file = new File([blob], imageData.name, { type: imageData.type });

        for (let attempt = 0; attempt < 3; attempt++) {
          let fileInput = await waitForDoubaoFileInput(500);

          if (!fileInput) {
            const uploadButton = getDomController().findDeepFirstVisibleElement(getConfigController().UPLOAD_BUTTON_SELECTORS.doubao) ||
              getDomController().findFirstVisibleElement(getConfigController().UPLOAD_BUTTON_SELECTORS.doubao);

            if (uploadButton) {
              uploadButton.click();
              await getDomController().sleep(200);
              fileInput = await waitForDoubaoFileInput(800);
            }
          }

          if (!fileInput) {
            console.warn('[Image Injection] Doubao: No file input found on attempt', attempt + 1);
            continue;
          }

          const assigned = getUploadsController().assignFilesToInput(fileInput, [file]);
          if (!assigned) {
            await getDomController().sleep(200);
            continue;
          }

          fileInput.dispatchEvent(new Event('input', { bubbles: true }));
          fileInput.dispatchEvent(new Event('change', { bubbles: true }));

          const uploadAccepted = await waitForDoubaoImagePreview(1200);

          if (uploadAccepted) {
            console.log('[Image Injection] Doubao: Image preview detected');
            return true;
          }

          console.warn('[Image Injection] Doubao: Upload did not produce an image preview');
          return false;
        }

        console.warn('[Image Injection] Doubao: Upload did not produce a preview after retries');
        return false;
      } catch (error) {
        console.error('[Image Injection] Doubao error:', error);
        return false;
      }
    }

    async function waitForDoubaoFileInput(timeoutMs = 800) {
      const start = Date.now();

      while (Date.now() - start < timeoutMs) {
        const fileInput = document.querySelector('#input-engine-container input[type="file"]') ||
          document.querySelector('input[type="file"]');

        if (fileInput) {
          return fileInput;
        }

        await getDomController().sleep(100);
      }

      return null;
    }

    function hasDoubaoImagePreview() {
      return Boolean(
        document.querySelector('.semi-image-preview-group') ||
        document.querySelector('#input-engine-container img[src^="blob:"]') ||
        document.querySelector('#input-engine-container img[src*="blob:"]')
      );
    }

    async function waitForDoubaoImagePreview(timeoutMs = 1200) {
      const start = Date.now();

      while (Date.now() - start < timeoutMs) {
        if (hasDoubaoImagePreview()) {
          return true;
        }

        await getDomController().sleep(100);
      }

      return false;
    }

    return {
      dismissDoubaoOverlay,
      findDoubaoOverlay,
      injectImageToDoubao,
      isDoubaoProjectControl,
      scheduleDoubaoOverlayCleanup,
    };
  }

  runtime.factories.createDoubaoController = createDoubaoController;
})(globalThis.PanelizeContent);
