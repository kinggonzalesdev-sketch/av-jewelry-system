import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import {
  ATTACHMENT_MAX_BYTES,
  attachmentErrorMessage,
  extensionForType,
  isAllowedContentType,
} from '@/lib/attachments/image';
import { ATTACHMENTS_BUCKET } from '@/lib/attachments/service';
import type {
  AttachmentPurpose,
  AttachmentSource,
  RelatedEntityType,
} from '@/lib/attachments/types';
import { requireActiveStaff } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';

/**
 * Attachment upload — the guarded domain module (Bible §29.3, §30.3 r3).
 *
 * The server action is transport only; ALL authority and data access live here:
 *   - identity is re-checked at execution time (requireActiveStaff);
 *   - type and size are validated at the edge, so a direct caller cannot bypass
 *     the client-side compression/limits;
 *   - the object goes to a PRIVATE bucket and the row records a path + metadata,
 *     never base64;
 *   - attribution is the verified session (uploaded_by), which the RLS with-check
 *     independently pins — a forged uploader is refused by the database.
 */

const ENTITY_TYPES: readonly RelatedEntityType[] = [
  'order',
  'payment',
  'layaway',
  'inventory_item',
  'customer',
  'fulfillment',
  'claim',
  'live_batch',
  'attendance_record',
];
const PURPOSES: readonly AttachmentPurpose[] = [
  'photo',
  'payment_proof',
  'evidence',
  'fulfillment_proof',
];
const SOURCES: readonly AttachmentSource[] = ['camera', 'file_upload'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type UploadAttachmentInput = {
  entityType: string | null;
  entityId: string | null;
  purpose: string | null;
  source: string | null;
  file: File | null;
  width: number | null;
  height: number | null;
  fileName: string | null;
};

export type UploadAttachmentResult =
  | { ok: true; id: string; storagePath: string; signedUrl: string | null }
  | { ok: false; error: string };

export async function uploadAttachment(
  input: UploadAttachmentInput,
): Promise<UploadAttachmentResult> {
  // Re-check identity at execution time. requireActiveStaff redirects an
  // unauthenticated/inactive caller; an active staff member proceeds.
  const staff = await requireActiveStaff();

  const entityType = input.entityType as RelatedEntityType | null;
  const purpose = input.purpose as AttachmentPurpose | null;
  const source = (input.source as AttachmentSource | null) ?? 'file_upload';

  if (!entityType || !ENTITY_TYPES.includes(entityType)) {
    return { ok: false, error: 'An attachable record type is required.' };
  }
  if (!input.entityId || !UUID_RE.test(input.entityId)) {
    return { ok: false, error: 'A valid record reference is required.' };
  }
  if (!purpose || !PURPOSES.includes(purpose)) {
    return { ok: false, error: 'An attachment purpose is required.' };
  }
  if (!SOURCES.includes(source)) {
    return { ok: false, error: 'Invalid attachment source.' };
  }

  const file = input.file;
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'No image was provided.' };
  }
  if (!isAllowedContentType(file.type)) {
    return { ok: false, error: attachmentErrorMessage('invalid_type') };
  }
  if (file.size > ATTACHMENT_MAX_BYTES) {
    return { ok: false, error: attachmentErrorMessage('file_too_large') };
  }

  const entityId = input.entityId;
  const supabase = await createClient();

  // Path convention: {entityType}/{entityId}/{uuid}.{ext} — unique, and grouped
  // by the record it belongs to so retention/cleanup can target one record.
  const objectPath = `${entityType}/${entityId}/${crypto.randomUUID()}.${extensionForType(file.type)}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const upload = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .upload(objectPath, bytes, { contentType: file.type, upsert: false });

  if (upload.error) {
    // A 4xx from Storage is almost always an authz/session problem; anything else
    // is treated as a failed upload. Nothing was recorded.
    const status = (upload.error as { statusCode?: string }).statusCode;
    const kind = status === '403' || status === '401' ? 'storage_auth' : 'upload_failed';
    await recordAuditEvent({
      action: 'attachment.upload',
      entityType,
      entityId,
      outcome: 'failed',
      reason: `storage upload failed: ${upload.error.message}`,
      context: { purpose, source },
    });
    return { ok: false, error: attachmentErrorMessage(kind) };
  }

  const insert = await supabase
    .from('attachments')
    .insert({
      storage_bucket: ATTACHMENTS_BUCKET,
      storage_path: objectPath,
      related_entity_type: entityType,
      related_entity_id: entityId,
      purpose,
      file_name: input.fileName,
      content_type: file.type,
      byte_size: file.size,
      image_width: input.width,
      image_height: input.height,
      source,
      // Attribution from the verified session — matches the RLS with-check.
      uploaded_by: staff.staffProfileId,
    })
    .select('id')
    .single();

  if (insert.error || !insert.data) {
    // The object uploaded but the metadata row did not. The object is now an
    // unreferenced orphan (there is deliberately no client delete path); it is
    // private and harmless, and retention cleanup will collect it. Report the
    // failure honestly rather than claiming success.
    await recordAuditEvent({
      action: 'attachment.upload',
      entityType,
      entityId,
      outcome: 'failed',
      reason: `metadata insert failed: ${insert.error?.message ?? 'unknown'}`,
      context: { purpose, source, orphanPath: objectPath },
    });
    return { ok: false, error: attachmentErrorMessage('upload_failed') };
  }

  const signedUrl = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUrl(objectPath, 300)
    .then((r) => r.data?.signedUrl ?? null)
    .catch(() => null);

  await recordAuditEvent({
    action: 'attachment.upload',
    entityType,
    entityId,
    outcome: 'succeeded',
    context: { purpose, source, byteSize: file.size, path: objectPath },
  });

  return { ok: true, id: insert.data.id as string, storagePath: objectPath, signedUrl };
}
