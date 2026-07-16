import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AttachmentGallery } from '@/components/attachments/attachment-gallery';
import type { AttachmentRow } from '@/lib/attachments/types';

function att(over: Partial<AttachmentRow>): AttachmentRow {
  return {
    id: crypto.randomUUID(),
    relatedEntityType: 'customer',
    relatedEntityId: crypto.randomUUID(),
    purpose: 'photo',
    fileName: 'photo.jpg',
    contentType: 'image/jpeg',
    byteSize: 2048,
    source: 'camera',
    uploadedBy: crypto.randomUUID(),
    uploadedAt: '2026-07-16T10:00:00.000Z',
    storagePath: 'customer/x/y.jpg',
    signedUrl: 'https://signed.example/y.jpg',
    ...over,
  };
}

describe('AttachmentGallery', () => {
  it('shows an honest empty state when there are none', () => {
    render(<AttachmentGallery attachments={[]} />);
    expect(screen.getByTestId('attachment-empty')).toBeInTheDocument();
  });

  it('renders a preview image per attachment with a signed URL', () => {
    render(<AttachmentGallery attachments={[att({}), att({})]} />);
    const imgs = screen.getAllByRole('img');
    expect(imgs).toHaveLength(2);
    expect(imgs[0]).toHaveAttribute('src', 'https://signed.example/y.jpg');
  });

  it('shows "Preview unavailable" (not a broken image) when a URL could not be minted', () => {
    render(<AttachmentGallery attachments={[att({ signedUrl: null })]} />);
    expect(screen.getByText(/Preview unavailable/i)).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('surfaces the source and size as audit metadata', () => {
    render(<AttachmentGallery attachments={[att({ source: 'file_upload' })]} />);
    expect(screen.getByText(/File/)).toBeInTheDocument();
  });
});
