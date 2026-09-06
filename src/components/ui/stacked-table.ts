/**
 * Mobile card-table labelling (Owner 2026-09-05).
 *
 * `.data-table--stack` (globals.css) turns each row into a card below 640px and renders every
 * cell as "label — value", reading the label from the cell's `data-label`. Hand-writing that
 * attribute on ~100 cells across 19 tables is error-prone, so this stamps it from the table's
 * OWN <th> text instead: a table opts in with one class and its headers become its labels.
 *
 * Pure DOM, framework-free, idempotent (only writes when the value changes), and conservative:
 * a row whose cell count differs from the header count (colspan / summary / empty-state rows) is
 * left alone, and action cells keep no label (they span the card).
 */
export function labelStackedTables(root: ParentNode): number {
  let stamped = 0;
  const tables = root.querySelectorAll<HTMLTableElement>('table.data-table--stack');
  tables.forEach((table) => {
    const heads = Array.from(
      table.querySelectorAll<HTMLTableCellElement>(':scope > thead th'),
    ).map((th) => (th.textContent ?? '').replace(/\s+/g, ' ').trim());
    if (heads.length === 0) return;
    table.querySelectorAll<HTMLTableRowElement>(':scope > tbody > tr').forEach((tr) => {
      const cells = Array.from(tr.children).filter(
        (c): c is HTMLTableCellElement => c.tagName === 'TD',
      );
      if (cells.length !== heads.length) return;
      cells.forEach((td, i) => {
        if (td.colSpan > 1 || td.classList.contains('col-actions')) return;
        const label = heads[i];
        if (label && td.dataset.label !== label) {
          td.dataset.label = label;
          stamped += 1;
        }
      });
    });
  });
  return stamped;
}
