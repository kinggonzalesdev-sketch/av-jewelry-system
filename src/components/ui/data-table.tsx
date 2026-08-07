import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { formatPeso } from '@/lib/payments/format';

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

/* ==========================================================================
 * SHARED TABLE COMPONENTS — the one balanced, responsive data-table system.
 *
 * Compose these instead of hand-rolling <table>/<th>/<td>: they emit the exact
 * `.data-table` + `col-*` classes (see globals.css), so every table gets the same
 * dense padding, row height, hairlines, content-based column sizing, and alignment
 * BY CONSTRUCTION. Column widths follow the CONTENT, never equal percentages —
 * exactly one `grow` column absorbs slack; short columns stay narrow.
 *
 *   <DataTable minWidth="720px">
 *     <Thead><Tr>
 *       <Th>Code</Th><Th kind="grow">Customer</Th>
 *       <Th kind="num">Amount</Th><Th kind="actions">Actions</Th>
 *     </Tr></Thead>
 *     <tbody>
 *       {rows.map(r => (
 *         <Tr key={r.id}>
 *           <Td>{r.code}</Td><Td kind="grow" clip title={r.name}>{r.name}</Td>
 *           <MoneyCell amount={r.amount} />
 *           <TableActions>{…buttons}</TableActions>
 *         </Tr>
 *       ))}
 *     </tbody>
 *   </DataTable>
 * ========================================================================== */

/** Column role → alignment + sizing (maps to the `.data-table col-*` helpers). */
export type ColKind = 'text' | 'num' | 'center' | 'actions' | 'grow';
const COL_CLASS: Record<ColKind, string> = {
  text: '',
  num: 'col-num',
  center: 'col-center',
  actions: 'col-actions',
  grow: 'col-grow',
};

/** Scroll container + the styled table. `minWidth` (e.g. "720px") keeps columns
 *  readable — below it the wrapper scrolls sideways instead of crushing them. */
export function DataTable({
  minWidth,
  className,
  testId,
  children,
}: {
  minWidth?: string | undefined;
  className?: string | undefined;
  testId?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className={cn(tableWrap)}>
      <table
        className={cn('data-table w-full text-left text-sm', className)}
        style={minWidth ? { minWidth } : undefined}
        data-testid={testId}
      >
        {children}
      </table>
    </div>
  );
}

/** Header band — consistent muted, uppercase, hairline-under styling. */
export function Thead({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <thead
      className={cn(
        'border-b bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground',
        className,
      )}
    >
      {children}
    </thead>
  );
}

/** A row. Body rows get a hairline + hover; pass `plain` for a header row. */
export function Tr({
  children,
  className,
  plain = false,
  onClick,
}: {
  children: ReactNode;
  className?: string | undefined;
  plain?: boolean | undefined;
  onClick?: (() => void) | undefined;
}) {
  return (
    <tr
      className={cn(!plain && 'border-b last:border-0 hover:bg-accent/40', onClick && 'cursor-pointer', className)}
      onClick={onClick}
    >
      {children}
    </tr>
  );
}

/** A header cell. `kind` sets alignment/sizing; exactly one `grow` per table. */
export function Th({
  kind = 'text',
  className,
  children,
}: {
  kind?: ColKind | undefined;
  className?: string | undefined;
  children?: ReactNode;
}) {
  return <th className={cn(COL_CLASS[kind], className)}>{children}</th>;
}

/** A body cell. `clip` caps + truncates a text-heavy value (pair with `title`). */
export function Td({
  kind = 'text',
  clip = false,
  title,
  colSpan,
  className,
  children,
}: {
  kind?: ColKind | undefined;
  clip?: boolean | undefined;
  title?: string | undefined;
  colSpan?: number | undefined;
  className?: string | undefined;
  children?: ReactNode;
}) {
  return (
    <td
      colSpan={colSpan}
      title={title}
      className={cn(COL_CLASS[kind], clip && 'col-clip truncate', className)}
    >
      {children}
    </td>
  );
}

/** The Actions cell — right-aligned, buttons spaced and never wrapped past the edge. */
export function TableActions({ children }: { children: ReactNode }) {
  return (
    <Td kind="actions">
      <div className={actionGroup}>{children}</div>
    </Td>
  );
}

/** A currency cell — right-aligned tabular figures, em dash when empty. */
export function MoneyCell({
  amount,
  className,
}: {
  amount: string | number | null | undefined;
  className?: string | undefined;
}) {
  return (
    <Td kind="num" className={className}>
      {amount === null || amount === undefined || amount === '' ? '—' : formatPeso(String(amount))}
    </Td>
  );
}

/** A date cell — centered, ISO date (YYYY-MM-DD), em dash when empty. */
export function DateCell({ value, className }: { value: string | null | undefined; className?: string }) {
  return (
    <Td kind="center" className={className}>
      {value ? String(value).slice(0, 10) : '—'}
    </Td>
  );
}

/* Status pills use the existing shared <StatusBadge> in ui/page-primitives.tsx
 * (label + tone API) — not duplicated here. */

/** Full-width empty state row (never a collapsed one-cell row). */
export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className={tdEmpty}>
        {children}
      </td>
    </tr>
  );
}
