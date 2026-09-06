import { act, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StackedTableLabels } from '@/components/ui/stacked-table-labels';

/**
 * The runtime half of the mobile card tables. `labelStackedTables()` itself is covered in
 * stacked-table.test.ts; this file proves the WIRING: the mounted component must label tables
 * that are already in the document (synchronously, before first paint), label tables that
 * arrive later (pagination, filters, portaled modals) through its MutationObserver →
 * requestAnimationFrame path, and stop once unmounted.
 */

function appendStackTable(id: string) {
  const wrap = document.createElement('div');
  wrap.innerHTML =
    `<table id="${id}" class="data-table data-table--stack">` +
    '<thead><tr><th>Customer Name</th><th>Status</th><th class="col-actions">Details</th></tr></thead>' +
    '<tbody><tr><td>Glaiza</td><td>Active</td><td class="col-actions">View</td></tr></tbody>' +
    '</table>';
  document.body.appendChild(wrap);
  return wrap;
}

const labelsOf = (id: string) =>
  [...document.querySelectorAll<HTMLElement>(`#${id} tbody td`)].map(
    (td) => td.dataset.label ?? null,
  );

const frame = () =>
  new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });

describe('StackedTableLabels (live labeller)', () => {
  it('labels a table already present at mount, synchronously', () => {
    const wrap = appendStackTable('t1');
    const view = render(<StackedTableLabels />);
    // Action cells never get a label (they span the card).
    expect(labelsOf('t1')).toEqual(['Customer Name', 'Status', null]);
    view.unmount();
    wrap.remove();
  });

  it('labels a table that arrives after mount (observer → animation frame)', async () => {
    const view = render(<StackedTableLabels />);
    const wrap = appendStackTable('t2');
    // Not yet: the observer batches the work into the next animation frame.
    expect(labelsOf('t2')).toEqual([null, null, null]);
    await act(async () => {
      await frame();
      await frame();
    });
    expect(labelsOf('t2')).toEqual(['Customer Name', 'Status', null]);
    view.unmount();
    wrap.remove();
  });

  it('stops observing after unmount', async () => {
    const view = render(<StackedTableLabels />);
    view.unmount();
    const wrap = appendStackTable('t3');
    await act(async () => {
      await frame();
      await frame();
    });
    expect(labelsOf('t3')).toEqual([null, null, null]);
    wrap.remove();
  });
});
