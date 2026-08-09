import type { AttachmentRow } from '@/lib/attachments/types';
import { humanFileSize } from '@/lib/attachments/image';

/**
 * Read-only gallery of a record's attachments. Each preview uses a short-lived
 * signed URL minted server-side (never a public URL). Audit metadata — source,
 * size, and when it was uploaded — travels with every tile.
 *
 * Display only; the render-time null-URL case is honest ("preview unavailable"),
 * not a broken image.
 */
export function AttachmentGallery({ attachments }: { attachments: AttachmentRow[] }) {
  if (attachments.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="attachment-empty">
        No photos attached yet.
      </p>
    );
  }

  return (
    <ul
      className="grid grid-cols-2 gap-2 sm:grid-cols-3"
      data-testid="attachment-gallery"
    >
      {attachments.map((a) => (
        <li
          key={a.id}
          className="overflow-hidden rounded-lg border border-border bg-card"
        >
          <div className="flex aspect-square items-center justify-center bg-muted">
            {a.signedUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={a.signedUrl}
                alt={a.fileName ?? 'Attachment'}
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="px-2 text-center text-[10px] text-muted-foreground">
                Preview unavailable
              </span>
            )}
          </div>
          <div className="p-1.5">
            <p className="truncate text-[10px] text-muted-foreground">
              {a.source === 'camera' ? '📷 Camera' : '📎 File'} ·{' '}
              {humanFileSize(a.byteSize)}
            </p>
            <p className="truncate text-[10px] text-muted-foreground">
              {new Date(a.uploadedAt).toLocaleString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
