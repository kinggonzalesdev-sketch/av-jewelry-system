import { describe, expect, it } from 'vitest';

import { labelStackedTables } from '@/components/ui/stacked-table';

function mount(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

describe('labelStackedTables — stamps mobile card labels from the table headers', () => {
  it('labels each cell from the matching <th>, skipping the actions cell', () => {
    const root = mount(`
      <table class="data-table data-table--stack">
        <thead><tr><th>Customer</th><th>Status</th><th class="col-actions">Actions</th></tr></thead>
        <tbody><tr><td>Glaiza</td><td>For Invoice</td><td class="col-actions">[Open]</td></tr></tbody>
      </table>`);
    expect(labelStackedTables(root)).toBe(2);
    const tds = root.querySelectorAll('td');
    expect(tds[0]?.dataset.label).toBe('Customer');
    expect(tds[1]?.dataset.label).toBe('Status');
    expect(tds[2]?.dataset.label).toBeUndefined();
    root.remove();
  });

  it('is idempotent — a second pass writes nothing', () => {
    const root = mount(`
      <table class="data-table--stack"><thead><tr><th>A</th></tr></thead>
      <tbody><tr><td>1</td></tr></tbody></table>`);
    expect(labelStackedTables(root)).toBe(1);
    expect(labelStackedTables(root)).toBe(0);
    root.remove();
  });

  it('leaves colspan / empty-state / summary rows unlabelled', () => {
    const root = mount(`
      <table class="data-table--stack">
        <thead><tr><th>A</th><th>B</th></tr></thead>
        <tbody>
          <tr><td colspan="2">No items match these filters.</td></tr>
          <tr><td>x</td></tr>
        </tbody>
      </table>`);
    expect(labelStackedTables(root)).toBe(0);
    root.querySelectorAll('td').forEach((td) => expect(td.dataset.label).toBeUndefined());
    root.remove();
  });

  it('ignores tables that did not opt in', () => {
    const root = mount(`
      <table class="data-table"><thead><tr><th>A</th></tr></thead>
      <tbody><tr><td>1</td></tr></tbody></table>`);
    expect(labelStackedTables(root)).toBe(0);
    expect(root.querySelector('td')?.dataset.label).toBeUndefined();
    root.remove();
  });

  it('normalises header whitespace so multi-line JSX headers become clean labels', () => {
    const root = mount(`
      <table class="data-table--stack"><thead><tr><th>
        Grand
        Total
      </th></tr></thead><tbody><tr><td>₱7,811</td></tr></tbody></table>`);
    labelStackedTables(root);
    expect(root.querySelector('td')?.dataset.label).toBe('Grand Total');
    root.remove();
  });
});
