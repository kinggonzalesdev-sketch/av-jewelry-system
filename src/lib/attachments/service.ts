import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { AttachmentRow, RelatedEntityType } from '@/lib/attachments/types';

/**
 * Attachment reads (server-only).
 *
 * Lists the metadata rows for a business record and mints a SHORT-LIVED signed
 * URL for each, so the private bucket is never exposed and no URL is persisted.
 * RLS scopes both the rows and the objects to active staff; a caller who may not
 * read the record sees nothing.
 */

const SIGNED_URL_TTL_SECONDS = 300; // 5 minutes — long enough to render, short enough to be safe.
export const ATTACHMENTS_BUCKET = 'attachments';

type Raw = {
  id: string;
  related_entity_type: RelatedEntityType;
  related_entity_id: string;
  purpose: AttachmentRow['purpose'];
  file_name: string | null;
  content_type: string;
  byte_size: number;
  source: AttachmentRow['source'];
  uploaded_by: string;
  uploaded_at: string;
  storage_path: string;
};

export async function listAttachments(
  entityType: RelatedEntityType,
  entityId: string,
): Promise<AttachmentRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('attachments')
    .select(
      'id, related_entity_type, related_entity_id, purpose, file_name, content_type, byte_size, source, uploaded_by, uploaded_at, storage_path',
    )
    .eq('related_entity_type', entityType)
    .eq('related_entity_id', entityId)
    .order('uploaded_at', { ascending: false });

  if (error || !data) return [];

  const rows = data as unknown as Raw[];

  // Mint one signed URL per object. Failing to sign one attachment must not blank
  // the rest — that row simply renders without a preview.
  const signed = await Promise.all(
    rows.map((r) =>
      supabase.storage
        .from(ATTACHMENTS_BUCKET)
        .createSignedUrl(r.storage_path, SIGNED_URL_TTL_SECONDS)
        .then((res) => res.data?.signedUrl ?? null)
        .catch(() => null),
    ),
  );

  return rows.map((r, i) => ({
    id: r.id,
    relatedEntityType: r.related_entity_type,
    relatedEntityId: r.related_entity_id,
    purpose: r.purpose,
    fileName: r.file_name,
    contentType: r.content_type,
    byteSize: r.byte_size,
    source: r.source,
    uploadedBy: r.uploaded_by,
    uploadedAt: r.uploaded_at,
    storagePath: r.storage_path,
    signedUrl: signed[i] ?? null,
  }));
}
