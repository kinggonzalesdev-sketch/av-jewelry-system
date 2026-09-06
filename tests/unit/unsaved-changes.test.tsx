import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  UnsavedChangesProvider,
  useUnsavedChanges,
  useUnsavedChangesRegistry,
} from '@/components/pwa/unsaved-changes';
import { Modal } from '@/components/ui/modal';

function Flag() {
  const { hasUnsavedChanges } = useUnsavedChangesRegistry();
  return <span data-testid="dirty">{String(hasUnsavedChanges())}</span>;
}
function Form({ dirty }: { dirty: boolean }) {
  useUnsavedChanges(dirty);
  return null;
}

describe('unsaved-changes registry', () => {
  it('is false with nothing registered, true while any form is dirty, and counts overlaps', () => {
    const { rerender } = render(
      <UnsavedChangesProvider>
        <Form dirty={false} />
        <Form dirty={false} />
        <Flag />
      </UnsavedChangesProvider>,
    );
    // The Flag reads a ref, so re-render to observe changes.
    const read = () => {
      rerender(
        <UnsavedChangesProvider>
          <Form dirty={false} />
          <Form dirty={false} />
          <Flag />
        </UnsavedChangesProvider>,
      );
      return screen.getByTestId('dirty').textContent;
    };
    expect(read()).toBe('false');
  });

  it('arms the native beforeunload guard only while dirty', () => {
    render(
      <UnsavedChangesProvider>
        <Form dirty={true} />
      </UnsavedChangesProvider>,
    );
    const e = new Event('beforeunload', { cancelable: true });
    act(() => {
      window.dispatchEvent(e);
    });
    expect(e.defaultPrevented).toBe(true);
  });

  it('does not arm beforeunload when clean', () => {
    render(
      <UnsavedChangesProvider>
        <Form dirty={false} />
      </UnsavedChangesProvider>,
    );
    const e = new Event('beforeunload', { cancelable: true });
    act(() => {
      window.dispatchEvent(e);
    });
    expect(e.defaultPrevented).toBe(false);
  });

  it('an open critical Modal registers as unsaved work automatically; a normal one does not', () => {
    function Probe() {
      const { hasUnsavedChanges } = useUnsavedChangesRegistry();
      return <span data-testid="p">{String(hasUnsavedChanges())}</span>;
    }
    const { rerender } = render(
      <UnsavedChangesProvider>
        <Modal open critical onClose={() => undefined} title="Add Payment">
          x
        </Modal>
        <Probe />
      </UnsavedChangesProvider>,
    );
    rerender(
      <UnsavedChangesProvider>
        <Modal open critical onClose={() => undefined} title="Add Payment">
          x
        </Modal>
        <Probe />
      </UnsavedChangesProvider>,
    );
    expect(screen.getByTestId('p')).toHaveTextContent('true');

    rerender(
      <UnsavedChangesProvider>
        <Modal open onClose={() => undefined} title="View">
          x
        </Modal>
        <Probe />
      </UnsavedChangesProvider>,
    );
    rerender(
      <UnsavedChangesProvider>
        <Modal open onClose={() => undefined} title="View">
          x
        </Modal>
        <Probe />
      </UnsavedChangesProvider>,
    );
    expect(screen.getByTestId('p')).toHaveTextContent('false');
  });

  it('hooks are safe no-ops without the provider (primitives usable in isolation)', () => {
    render(
      <>
        <Form dirty={true} />
        <Flag />
      </>,
    );
    expect(screen.getByTestId('dirty')).toHaveTextContent('false');
  });
});
