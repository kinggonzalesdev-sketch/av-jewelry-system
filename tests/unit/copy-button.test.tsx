import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CopyButton } from '@/components/ui/copy-button';

describe('CopyButton', () => {
  it('copies the text and shows brief feedback', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });

    render(<CopyButton text="Hi Ana, your invoice…" label="Copy Message" testId="copy" />);
    fireEvent.click(screen.getByTestId('copy'));

    expect(writeText).toHaveBeenCalledWith('Hi Ana, your invoice…');
    expect(await screen.findByText('Copied ✓')).toBeInTheDocument();
  });

  it('is disabled when there is nothing to copy', () => {
    render(<CopyButton text="   " testId="copy" />);
    expect(screen.getByTestId('copy')).toBeDisabled();
  });
});
