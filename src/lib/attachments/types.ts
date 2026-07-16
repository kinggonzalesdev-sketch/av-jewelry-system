/**
 * Attachment shapes shared by client and server.
 *
 * Kept OUT of any `'use server'` / `server-only` module so a Client Component can
 * import the types and the action-state without dragging server code into the
 * browser bundle (the same rule the payment action-state file documents).
 */

export type RelatedEntityType =
  | 'order'
  | 'payment'
  | 'layaway'
  | 'inventory_item'
  | 'customer'
  | 'fulfillment'
  | 'claim'
  | 'live_batch';

export type AttachmentPurpose =
  'photo' | 'payment_proof' | 'evidence' | 'fulfillment_proof';

export type AttachmentSource = 'camera' | 'file_upload';

/** A stored attachment, as the UI consumes it. `signedUrl` is short-lived and is
 *  minted per read — never persisted. */
export type AttachmentRow = {
  id: string;
  relatedEntityType: RelatedEntityType;
  relatedEntityId: string;
  purpose: AttachmentPurpose;
  fileName: string | null;
  contentType: string;
  byteSize: number;
  source: AttachmentSource;
  uploadedBy: string;
  uploadedAt: string;
  storagePath: string;
  /** Short-lived signed URL for display; null if it could not be minted. */
  signedUrl: string | null;
};

/** Server-action result. Lives here (not in the `'use server'` file) so exporting
 *  the empty value cannot break the actions module at request time. */
export type UploadAttachmentState = {
  error: string | null;
  success: string | null;
  /** Present on success — the path + a preview URL the caller can render or reuse
   *  (e.g. as a payment evidence reference). */
  attachment: { id: string; storagePath: string; signedUrl: string | null } | null;
};

export const EMPTY_UPLOAD_ATTACHMENT_STATE: UploadAttachmentState = {
  error: null,
  success: null,
  attachment: null,
};
