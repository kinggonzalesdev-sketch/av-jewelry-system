'use client';

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Tabs — the shared tab bar (gold underline on the active tab, muted otherwise). One
 * implementation so every module's tabs look and behave the same. Controlled: pass the
 * active key and an onChange. An optional count renders a muted number beside the label.
 */
export type TabItem = { key: string; label: ReactNode; count?: number | undefined };

export function Tabs({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: TabItem[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn('flex flex-wrap gap-1 border-b border-border', className)}
    >
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.key)}
            data-testid={`tab-${t.key}`}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              on
                ? 'border-gold text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
            {typeof t.count === 'number' ? (
              <span className="ml-1.5 text-xs text-muted-foreground">{t.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
