import { describe, expect, it } from 'vitest';

import {
  ALLOWED_CONTENT_TYPES,
  ATTACHMENT_ERROR_MESSAGE,
  attachmentErrorMessage,
  classifyMediaError,
  extensionForType,
  humanFileSize,
  isAllowedContentType,
  targetDimensions,
  type AttachmentErrorKind,
} from '@/lib/attachments/image';

describe('targetDimensions — resize math', () => {
  it('never upscales an image already within the max edge', () => {
    expect(targetDimensions(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it('scales down preserving aspect ratio (landscape)', () => {
    expect(targetDimensions(3200, 2400, 1600)).toEqual({ width: 1600, height: 1200 });
  });

  it('scales down preserving aspect ratio (portrait)', () => {
    expect(targetDimensions(2400, 3200, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  it('returns zeros for a degenerate size rather than dividing by zero', () => {
    expect(targetDimensions(0, 0, 1600)).toEqual({ width: 0, height: 0 });
  });
});

describe('content-type validation', () => {
  it('accepts exactly jpeg/png/webp', () => {
    for (const t of ALLOWED_CONTENT_TYPES) expect(isAllowedContentType(t)).toBe(true);
  });

  it('rejects anything else (no gif/heic/pdf)', () => {
    for (const t of ['image/gif', 'image/heic', 'application/pdf', '']) {
      expect(isAllowedContentType(t)).toBe(false);
    }
  });

  it('maps types to sane extensions', () => {
    expect(extensionForType('image/jpeg')).toBe('jpg');
    expect(extensionForType('image/png')).toBe('png');
    expect(extensionForType('image/webp')).toBe('webp');
  });
});

describe('humanFileSize', () => {
  it('formats bytes, KB, and MB', () => {
    expect(humanFileSize(512)).toBe('512 B');
    expect(humanFileSize(2048)).toBe('2 KB');
    expect(humanFileSize(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(humanFileSize(15 * 1024 * 1024)).toBe('15 MB');
  });

  it('returns an em dash for a nonsensical size', () => {
    expect(humanFileSize(-1)).toBe('—');
  });
});

describe('error taxonomy is complete and honest', () => {
  it('has a message for every required error kind', () => {
    const kinds: AttachmentErrorKind[] = [
      'permission_denied',
      'camera_unavailable',
      'unsupported_browser',
      'upload_failed',
      'file_too_large',
      'invalid_type',
      'network',
      'storage_auth',
      'unknown',
    ];
    for (const k of kinds) {
      expect(ATTACHMENT_ERROR_MESSAGE[k]).toBeTruthy();
      expect(attachmentErrorMessage(k)).toBe(ATTACHMENT_ERROR_MESSAGE[k]);
    }
  });

  it('never claims success in an error message', () => {
    for (const msg of Object.values(ATTACHMENT_ERROR_MESSAGE)) {
      expect(msg.toLowerCase()).not.toContain('saved successfully');
    }
  });
});

describe('classifyMediaError — DOM error → honest kind', () => {
  it('permission errors → permission_denied', () => {
    expect(classifyMediaError('NotAllowedError')).toBe('permission_denied');
    expect(classifyMediaError('SecurityError')).toBe('permission_denied');
  });

  it('missing device → camera_unavailable', () => {
    expect(classifyMediaError('NotFoundError')).toBe('camera_unavailable');
  });

  it('unsupported → unsupported_browser', () => {
    expect(classifyMediaError('NotSupportedError')).toBe('unsupported_browser');
  });

  it('falls back to camera_unavailable for the unknown', () => {
    expect(classifyMediaError('WhoKnowsError')).toBe('camera_unavailable');
  });
});
