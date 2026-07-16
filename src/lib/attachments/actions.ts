'use server';

import { uploadAttachment } from '@/lib/attachments/upload';
import type { UploadAttachmentState } from '@/lib/attachments/types';

/**
 * Attachment server actions (Bible §29.3, invariant #1).
 *
 * Transport ONLY. Permission, validation, storage, and audit all live in
 * `@/lib/attachments/upload`, so an action invoked directly — bypassing the UI —
 * is checked identically. This module never touches the database or a Supabase
 * client (the authorization-boundary sweep enforces that).
 */

function num(form: FormData, name: string): number | null {
  const v = form.get(name);
  if (typeof v !== 'string' || v.length === 0) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function str(form: FormData, name: string): string | null {
  const v = form.get(name);
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export async function uploadAttachmentAction(
  _prev: UploadAttachmentState,
  formData: FormData,
): Promise<UploadAttachmentState> {
  const fileValue = formData.get('file');

  const result = await uploadAttachment({
    entityType: str(formData, 'relatedEntityType'),
    entityId: str(formData, 'relatedEntityId'),
    purpose: str(formData, 'purpose'),
    source: str(formData, 'source'),
    file: fileValue instanceof File ? fileValue : null,
    width: num(formData, 'width'),
    height: num(formData, 'height'),
    fileName: str(formData, 'fileName'),
  });

  if (!result.ok) {
    return { error: result.error, success: null, attachment: null };
  }

  return {
    error: null,
    success: 'Photo attached.',
    attachment: {
      id: result.id,
      storagePath: result.storagePath,
      signedUrl: result.signedUrl,
    },
  };
}
