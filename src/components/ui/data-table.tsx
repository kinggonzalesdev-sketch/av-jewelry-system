import { cn } from '@/lib/utils';

/**
 * ONE table style for every data table in MineFlow (Orders, Customers, Inventory,
 * Completed Items, Layaway, Scrap, Attendance, Payroll, Payments, Reports).
 *
 * Every table used to pick its own padding — px-2.5, px-2, px-3, px-4 — so headers
 * drifted out of line with their values and Actions buttons collided with the text
 * beside them. These are the shared primitives; a table that uses them is aligned
 * with every other table by construction.
 *
 * The rules they encode:
 *   - one horizontal padding (px-3) on every header and cell, so a header always
 *     sits directly above its value;
 *   - numbers right-aligned and tabular, text left-aligned, badges centred;
 *   - Actions pinned to the far right and never wrapped;
 *   - the table scrolls horizontally inside its own container rather than
 *     compressing columns until the text is unreadable.
 */

/** Scroll container. Wraps the table so the PAGE never scrolls sideways. */
export const tableWrap = 'overflow-x-auto rounded-xl border border-border bg-card';

/** The table element. Pass a min-width so columns keep readable widths. */
export const tableBase = 'w-full text-left text-xs';

/** Header row band. */
export const theadBase =
  'border-b bg-muted/50 text-[10px] uppercase tracking-wide text-muted-foreground';

/** Body: one hairline between rows. */
export const tbodyBase = 'divide-y';

/** A text column header. */
export const th = 'px-3 py-2 font-medium whitespace-nowrap';
/** A numeric column header — right-aligned to sit over its digits. */
export const thNum = 'px-3 py-2 font-medium whitespace-nowrap text-right';
/** A centred column header (status badges). */
export const thCenter = 'px-3 py-2 font-medium whitespace-nowrap text-center';
/** The Actions header — always the last column, always right. */
export const thActions = 'px-3 py-2 font-medium whitespace-nowrap text-right';

/** A text cell. */
export const td = 'px-3 py-2 align-middle';
/** A numeric cell — right-aligned, tabular figures so digits line up. */
export const tdNum = 'px-3 py-2 align-middle text-right tabular-nums whitespace-nowrap';
/** A centred cell (status badges). */
export const tdCenter = 'px-3 py-2 align-middle text-center';
/** The Actions cell — right-aligned, never wraps, buttons spaced. */
export const tdActions = 'px-3 py-2 align-middle text-right whitespace-nowrap';

/** Row hover affordance. */
export const trHover = 'hover:bg-accent/40';

/** Actions cell inner layout — keeps buttons from touching or overlapping. */
export const actionGroup = 'flex flex-wrap items-center justify-end gap-1';

/** Empty-state cell: full width, centred, never a collapsed row. */
export const tdEmpty = 'px-3 py-6 text-center text-muted-foreground';

/**
 * Build the table className with a minimum width. Below it the wrapper scrolls
 * instead of squeezing columns.
 */
export function tableCls(minWidthClass?: string): string {
  return cn(tableBase, minWidthClass);
}
