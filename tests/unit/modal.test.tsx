import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Modal } from '@/components/ui/modal';

/**
 * The one standard dialog. These pin the behaviour every Create/Add/Edit/View
 * form now relies on: closed renders nothing; ✕, overlay, and Escape close a
 * normal dialog; and a `critical` dialog ignores overlay-click and Escape so a
 * half-filled entry is never lost to a stray click.
 */

beforeEach(() => {
  document.body.style.overflow = '';
});

describe('Modal', () => {
  it('renders nothing while closed', () => {
    render(
      <Modal open={false} onClose={vi.fn()} title="Add item">
        <p>Body</p>
      </Modal>,
    );
    expect(screen.queryByTestId('modal')).not.toBeInTheDocument();
  });

  it('shows the title, body, and footer when open, and locks scroll', () => {
    render(
      <Modal open onClose={vi.fn()} title="Add item" footer={<button>Save</button>}>
        <p>Body content</p>
      </Modal>,
    );
    expect(screen.getByTestId('modal')).toBeInTheDocument();
    expect(screen.getByText('Add item')).toBeInTheDocument();
    expect(screen.getByText('Body content')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('closes on ✕, overlay click, and Escape for a normal dialog', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Add item">
        <p>Body</p>
      </Modal>,
    );
    fireEvent.click(screen.getByTestId('modal-close'));
    fireEvent.click(screen.getByTestId('modal-overlay'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('ignores the overlay and Escape for a critical dialog (only ✕ closes)', () => {
    const onClose = vi.fn();
    render(
      <Modal open critical onClose={onClose} title="Critical">
        <p>Body</p>
      </Modal>,
    );
    // No clickable overlay is rendered for a critical dialog.
    expect(screen.queryByTestId('modal-overlay')).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('modal-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
