/**
 * Pure, client-safe image + attachment helpers.
 *
 * No `server-only` and no DOM access here — just the arithmetic and the
 * vocabularies the capture component and the upload action both need, so the
 * tricky parts (resize math, validation, error wording) are unit-testable
 * without a browser or a database.
 */

export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024; // 10 MiB — matches the bucket ceiling.

/** The only content types the bucket and the DB check accept. */
export const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

/** Longest-edge target for the compressed upload. Big enough to read a receipt,
 *  small enough to upload on a weak mobile connection. */
export const COMPRESS_MAX_EDGE = 1600;

/** JPEG/WebP quality used when re-encoding the capture. */
export const COMPRESS_QUALITY = 0.82;

export function isAllowedContentType(type: string): type is AllowedContentType {
  return (ALLOWED_CONTENT_TYPES as readonly string[]).includes(type);
}

export function extensionForType(type: string): string {
  switch (type) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      return 'bin';
  }
}

/**
 * Resize target that preserves aspect ratio and never UPSCALES. An image already
 * within the max edge is returned unchanged (so we never blow a small image up
 * and never re-encode needlessly larger).
 */
export function targetDimensions(
  width: number,
  height: number,
  maxEdge = COMPRESS_MAX_EDGE,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Human-readable byte size for progress/metadata display. */
export function humanFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/**
 * The honest error taxonomy the capture flow must distinguish (Part B), and the
 * message each maps to. Keeping this as data (not scattered strings) is what lets
 * a test assert every required state is handled.
 */
export type AttachmentErrorKind =
  | 'permission_denied'
  | 'camera_unavailable'
  | 'unsupported_browser'
  | 'upload_failed'
  | 'file_too_large'
  | 'invalid_type'
  | 'network'
  | 'storage_auth'
  | 'unknown';

export const ATTACHMENT_ERROR_MESSAGE: Record<AttachmentErrorKind, string> = {
  permission_denied:
    'Camera access was blocked. Allow camera permission in your browser, or use “Choose file” instead.',
  camera_unavailable:
    'No camera is available on this device. Use “Choose file” to attach a photo instead.',
  unsupported_browser:
    'This browser does not support in-page camera capture. Use “Choose file” to attach a photo.',
  upload_failed: 'The upload did not complete. Nothing was saved — you can retry.',
  file_too_large: 'That image is larger than 10 MB. Retake or choose a smaller file.',
  invalid_type: 'Only JPEG, PNG, or WebP images can be attached.',
  network:
    'The connection dropped during upload. Nothing was saved — check your connection and retry.',
  storage_auth:
    'You are not authorized to store this attachment, or your session expired. Sign in again and retry.',
  unknown: 'Something went wrong attaching the photo. Nothing was saved — you can retry.',
};

export function attachmentErrorMessage(kind: AttachmentErrorKind): string {
  return ATTACHMENT_ERROR_MESSAGE[kind];
}

/**
 * Classifies a getUserMedia failure into one of our honest kinds. The DOM error
 * names are stable across browsers, so mapping them here keeps the component thin.
 */
export function classifyMediaError(name: string): AttachmentErrorKind {
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'permission_denied';
    case 'NotFoundError':
    case 'OverconstrainedError':
    case 'DevicesNotFoundError':
      return 'camera_unavailable';
    case 'NotSupportedError':
    case 'TypeError':
      return 'unsupported_browser';
    default:
      return 'camera_unavailable';
  }
}
