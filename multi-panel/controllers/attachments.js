/**
 * Owns attachments behavior and its page-local state.
 * Deferred controller getters keep composition in the entry point.
 */
import { isImageAttachment, isSupportedAttachmentFile, resolveAttachmentType } from '../../modules/composer/attachment-files.js';
import { escapeHtml, showToast } from './ui.js';

export function createAttachmentsController({
  getSendingController
}) {
  let uploadedImages = [];

  // ===== Image Management =====
  // Images and other attachments share one list, kept as uploadedImages.
  const MAX_IMAGE_SIZE = 20 * 1024 * 1024;

  // 20MB per attachment
  const MAX_IMAGE_COUNT = 10;

  async function addImage(file) {
    try {
      // Validate file type
      if (!isSupportedAttachmentFile(file)) {
        showToast('Unsupported file type');
        return false;
      }

      // Validate file size
      if (file.size > MAX_IMAGE_SIZE) {
        showToast('File size must be less than 20MB');
        return false;
      }

      // Validate attachment count
      if (uploadedImages.length >= MAX_IMAGE_COUNT) {
        showToast(`Maximum ${MAX_IMAGE_COUNT} attachments allowed`);
        return false;
      }

      // Convert to base64
      const dataUrl = await fileToDataUrl(file);

      // Add to uploadedImages array with string ID
      const imageId = Date.now().toString() + '_' + Math.random().toString(36).substr(2, 9);
      uploadedImages.push({
        id: imageId,
        name: file.name,
        type: resolveAttachmentType(file),
        dataUrl: dataUrl
      });
      getSendingController().resetFillRetryState();

      // Render preview
      renderImagePreviews();
      return true;
    } catch (error) {
      console.error('Error adding attachment:', error);
      showToast('Failed to add file');
      return false;
    }
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function removeImage(imageId) {
    uploadedImages = uploadedImages.filter(img => img.id !== imageId);
    getSendingController().resetFillRetryState();
    renderImagePreviews();
  }

  function clearAllImages() {
    uploadedImages = [];
    getSendingController().resetFillRetryState();
    renderImagePreviews();
  }

  function renderImagePreviews() {
    const container = document.getElementById('image-preview-container');

    if (uploadedImages.length === 0) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = uploadedImages.map(img => `
    <div class="image-preview-item${isImageAttachment(img) ? '' : ' file-preview'}" data-image-id="${img.id}" title="${escapeHtml(img.name)}">
      ${isImageAttachment(img)
          ? `<img src="${img.dataUrl}" alt="${escapeHtml(img.name)}">`
          : `<span class="material-symbols-outlined file-preview-icon" aria-hidden="true">description</span>
      <span class="file-preview-name">${escapeHtml(img.name)}</span>`}
      <button class="remove-image" onclick="window.removeImageById('${img.id}')" title="Remove">
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>
  `).join('');
  }

  return {
    addImage,
    clearAllImages,
    removeImage,
    renderImagePreviews,
    get uploadedImages() { return uploadedImages; },
    set uploadedImages(value) { uploadedImages = value; },
  };
}
