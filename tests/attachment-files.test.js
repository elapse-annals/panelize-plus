import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_ACCEPT,
  isImageAttachment,
  isSupportedAttachmentFile,
  resolveAttachmentType
} from '../modules/attachment-files.js';

describe('attachment files', () => {
  it('accepts images and listed document and code files', () => {
    expect(isSupportedAttachmentFile({ name: 'photo.heic', type: 'image/heic' })).toBe(true);
    expect(isSupportedAttachmentFile({ name: 'Report.PDF', type: 'application/pdf' })).toBe(true);
    expect(isSupportedAttachmentFile({ name: 'notes.md', type: '' })).toBe(true);
    expect(isSupportedAttachmentFile({ name: 'main.py', type: '' })).toBe(true);
  });

  it('rejects unlisted files', () => {
    expect(isSupportedAttachmentFile({ name: 'setup.exe', type: 'application/x-msdownload' })).toBe(false);
    expect(isSupportedAttachmentFile({ name: 'archive.zip', type: 'application/zip' })).toBe(false);
    expect(isSupportedAttachmentFile({ name: 'README', type: '' })).toBe(false);
  });

  it('fills in a missing MIME type from the extension', () => {
    expect(resolveAttachmentType({ name: 'notes.md', type: '' })).toBe('text/markdown');
    expect(resolveAttachmentType({ name: 'doc.pdf', type: 'application/pdf' })).toBe('application/pdf');
    expect(resolveAttachmentType({ name: 'unknown', type: '' })).toBe('application/octet-stream');
  });

  it('tells images apart and lists every type in the picker filter', () => {
    expect(isImageAttachment({ type: 'image/png' })).toBe(true);
    expect(isImageAttachment({ type: 'application/pdf' })).toBe(false);
    expect(ATTACHMENT_ACCEPT.split(',')).toEqual(expect.arrayContaining(['image/*', '.pdf', '.docx', '.md']));
  });
});
