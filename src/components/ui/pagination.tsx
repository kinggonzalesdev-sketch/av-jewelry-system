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
  className,
}: {
  page: number;
  pageCount: number;
  total?: number | undefined;
  pageSize?: number | undefined;
  onPageChange: (page: number) => void;
  onPageSizeChange?: ((size: number) => void) | undefined;
  pageSizes?: number[];
  className?: string;
}) {
  const last = Math.max(1, pageCount);
  return (
    <div
      className={cn('flex flex-wrap items-center justify-between gap-3 text-sm', className)}
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
