import Link from 'next/link';

import type { FollowUpCategory, FollowUpTone } from '@/lib/followups/service';
import { cn } from '@/lib/utils';

/**
 * Follow-up Queue cards — a categorised, read-only view of what needs attention,
 * from REAL live counts. A null count renders "—" (unavailable), never a false 0.
 * Each card links to the workspace that owns the action; nothing here acts.
 */

const TONE_COUNT: Record<FollowUpTone, string> = {
  neutral: 'text-foreground',
  gold: 'text-gold-strong',
  warning: 'text-amber-700',
  danger: 'text-destructive',
};

const TONE_DOT: Record<FollowUpTone, string> = {
  neutral: 'bg-muted-foreground',
  gold: 'bg-gold',
  warning: 'bg-amber-500',
  danger: 'bg-destructive',
};

export function FollowUpCards({
  categories,
  total,
}: {
  categories: FollowUpCategory[];
  total: number;
}) {
  return (
    <div className="space-y-3" data-testid="follow-up-queue">
      <p className="text-sm text-muted-foreground">
        <span className="font-semibold text-foreground">{total}</span> item(s) need
        follow-up. Counts are live and permission-scoped; a category that could not be
        read shows “—”. Nothing here acts — each opens the workspace that owns it.
      </p>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {categories.map((c) => (
          <Link
            key={c.key}
            href={c.href}
            data-testid={`follow-up-${c.key}`}
            className="flex flex-col gap-1 rounded-xl border border-border bg-card p-3 transition-colors hover:border-gold/40"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <span
                  aria-hidden="true"
                  className={cn('h-2 w-2 shrink-0 rounded-full', TONE_DOT[c.tone])}
                />
                {c.label}
              </span>
              <span className={cn('text-2xl font-bold tabular-nums', TONE_COUNT[c.tone])}>
                {c.count ?? '—'}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{c.description}</p>
            <span className="mt-1 text-xs font-medium text-gold-strong">Open →</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
