/**
 * File types the composer accepts as attachments besides images.
 */

const ATTACHMENT_MIME_TYPES = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.ts': 'text/plain',
  '.jsx': 'text/plain',
  '.tsx': 'text/plain',
  '.py': 'text/x-python',
  '.java': 'text/x-java',
  '.c': 'text/x-c',
  '.cpp': 'text/x-c++',
  '.h': 'text/x-c',
  '.go': 'text/plain',
  '.rs': 'text/plain',
  '.rb': 'text/plain',
  '.php': 'text/plain',
  '.sh': 'text/x-sh',
  '.sql': 'text/plain',
  '.swift': 'text/plain',
  '.kt': 'text/plain'
};

export const ATTACHMENT_EXTENSIONS = Object.keys(ATTACHMENT_MIME_TYPES);

export const ATTACHMENT_ACCEPT = ['image/*', ...ATTACHMENT_EXTENSIONS].join(',');

function getExtension(name) {
  const match = /\.[^.]+$/.exec(String(name || '').toLowerCase());
  return match ? match[0] : '';
}

export function isImageAttachment(item) {
  return typeof item?.type === 'string' && item.type.startsWith('image/');
}

export function isSupportedAttachmentFile(file) {
  return isImageAttachment(file) || Object.hasOwn(ATTACHMENT_MIME_TYPES, getExtension(file?.name));
}

/** The file's MIME type, from its extension when the browser left it empty. */
export function resolveAttachmentType(file) {
  if (file?.type) {
    return file.type;
  }
  return ATTACHMENT_MIME_TYPES[getExtension(file?.name)] || 'application/octet-stream';
}
