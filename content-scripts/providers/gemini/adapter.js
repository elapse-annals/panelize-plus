(function(runtime) {
  'use strict';

  /**
   * Owns gemini behavior and its page-local state.
   * Deferred controller getters keep composition in the entry point.
   */


  function createGeminiController({
    getDomController,
    getUploadsController
  }) {
    // Gemini-specific image injection
    async function injectImageToGemini(imageData) {
      try {
        console.log('[Image Injection] Gemini: Starting image injection');

        // Strategy: Simulate paste event with image
        // Find the editor (Quill editor or contenteditable)
        const editorSelectors = ['.ql-editor', '[contenteditable="true"]', 'div[contenteditable]'];
        let editor = null;
        
        for (const selector of editorSelectors) {
          editor = getDomController().querySelectorDeep(selector);
          if (editor) {
            console.log('[Image Injection] Gemini: Found editor:', selector);
            break;
          }
        }
        
        if (!editor) {
          console.warn('[Image Injection] Gemini: Editor not found');
          return false;
        }

        // Convert dataUrl to blob
        const blob = await getUploadsController().dataUrlToBlob(imageData.dataUrl);
        const file = new File([blob], imageData.name, { type: imageData.type });
        
        // Create DataTransfer for clipboard data
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        
        // Focus the editor first
        editor.focus();
        
        // Simulate paste event with the image
        const pasteEvent = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dataTransfer
        });
        
        editor.dispatchEvent(pasteEvent);
        console.log('[Image Injection] Gemini: Paste event dispatched');
        
        // Also try drag-drop as fallback if paste doesn't work
        await getDomController().sleep(100);
        const dropEvent = new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer: dataTransfer
        });
        editor.dispatchEvent(dropEvent);
        console.log('[Image Injection] Gemini: Drop event dispatched');
        
        return true;
      } catch (error) {
        console.error('[Image Injection] Gemini error:', error);
        return false;
      }
    }

    return {
      injectImageToGemini,
    };
  }

  runtime.factories.createGeminiController = createGeminiController;
})(globalThis.PanelizeContent);
