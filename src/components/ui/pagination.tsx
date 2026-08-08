'use client';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';

/**
 * Pagination — the shared page control for every server-paginated list. Shows the
 * current page + total, an optional rows-per-page selector (25/50/100/250), and Prev /
 * Next. One implementation so pagination is identical across Inventory, Orders,
 * Customers, Payments, etc.
 */
export function Pagination({
  page,
  pageCount,
  total,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizes = [25, 50, 100, 250],
  sticky = false,
  className,
}: {
  page: number;
  pageCount: number;
  total?: number | undefined;
  pageSize?: number | undefined;
  onPageChange: (page: number) => void;
  onPageSizeChange?: ((size: number) => void) | undefined;
  pageSizes?: number[];
  /** Pin the control to the bottom of the viewport while its table is scrolled,
   *  settling into place at the very end of the list. */
  sticky?: boolean | undefined;
  className?: string;
}) {
  const last = Math.max(1, pageCount);
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 text-sm',
        // Sticky footer: floats at the viewport bottom over the scrolling table, then
        // comes to rest at the list's end. A solid, blurred backdrop + top divider keep
        // it readable while it overlaps rows; z-20 sits it above the table body.
        sticky &&
          'sticky bottom-0 z-20 mt-0 border-t border-border bg-background/90 px-2 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/70',
        className,
      )}
      data-testid="pagination"
    >
      <div className="text-muted-foreground">
        Page {page} of {last}
        {typeof total === 'number' ? ` · ${total.toLocaleString()} total` : ''}
      </div>
      <div className="flex items-center gap-2">
        {onPageSizeChange && pageSize ? (
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            Rows
            <Select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="h-8 w-[4.5rem]"
              aria-label="Rows per page"
            >
              {pageSizes.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          data-testid="pagination-prev"
        >
          ‹ Prev
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={page >= last}
          onClick={() => onPageChange(page + 1)}
          data-testid="pagination-next"
        >
          Next ›
        </Button>
      </div>
    </div>
  );
}
