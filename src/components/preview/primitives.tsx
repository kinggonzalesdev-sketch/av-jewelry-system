'use client';

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * PROTOTYPE PRIMITIVES — UI review only.
 *
 * Deliberately uses explicit Tailwind palette classes rather than the production
 * design tokens. The production tokens are dark-mode aware and belong to the real
 * app; this prototype is a separate visual proposal (clean white + soft green) and
 * must not silently redefine them.
 */

/** Soft green accent used across the prototype. */
export const ACCENT = 'emerald';

export function SampleBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800',
        className,
      )}
    >
      Sample data
    </span>
  );
}

/**
 * Marks an action that does nothing. Every button in this prototype is either
 * wired to local state or carries this badge — none silently pretends to work.
 */
export function PrototypeBadge({ label = 'Prototype' }: { label?: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-600">
      {label}
    </span>
  );
}

const TONE_CLASS: Record<string, string> = {
  green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  amber: 'border-amber-200 bg-amber-50 text-amber-800',
  red: 'border-rose-200 bg-rose-50 text-rose-800',
  blue: 'border-sky-200 bg-sky-50 text-sky-800',
  slate: 'border-slate-200 bg-slate-100 text-slate-700',
};

export function StatusBadge({
  label,
  tone = 'slate',
  className,
}: {
  label: string;
  tone?: 'green' | 'amber' | 'red' | 'blue' | 'slate';
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium',
        TONE_CLASS[tone],
        className,
      )}
    >
      {label}
    </span>
  );
}

export function OwnerOnlyBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-violet-800">
      Owner only
    </span>
  );
}

export function PermissionBadge({ permission }: { permission: string }) {
  return (
    <span className="inline-flex items-center rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
      {permission}
    </span>
  );
}

export function PreviewButton({
  children,
  variant = 'default',
  size = 'default',
  className,
  ...props
}: React.ComponentProps<'button'> & {
  variant?: 'default' | 'outline' | 'ghost' | 'danger';
  size?: 'default' | 'sm';
}) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-10 px-3.5 text-sm',
        variant === 'default' && 'bg-emerald-600 text-white hover:bg-emerald-700',
        variant === 'outline' &&
          'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
        variant === 'ghost' && 'text-slate-600 hover:bg-slate-100',
        variant === 'danger' &&
          'border border-rose-300 bg-white text-rose-700 hover:bg-rose-50',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn('rounded-xl border border-slate-200 bg-white shadow-sm', className)}
    >
      {children}
    </div>
  );
}

export function SectionTitle({
  title,
  description,
  right,
}: {
  title: string;
  description?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-slate-900">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-sm text-slate-500">{description}</p>
        ) : null}
      </div>
      {right}
    </div>
  );
}

/**
 * A rule callout. Used to surface the approved business rules on the screen
 * itself, so a reviewer can see the constraint without reading the Bible.
 */
export function RuleNote({
  children,
  tone = 'slate',
}: {
  children: ReactNode;
  tone?: 'slate' | 'amber';
}) {
  return (
    <p
      className={cn(
        'rounded-lg border px-3 py-2 text-xs leading-relaxed',
        tone === 'amber'
          ? 'border-amber-200 bg-amber-50 text-amber-900'
          : 'border-slate-200 bg-slate-50 text-slate-600',
      )}
    >
      {children}
    </p>
  );
}

export function Field({
  label,
  children,
  hint,
  required,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-700">
        {label}
        {required ? <span className="text-rose-600">*</span> : null}
      </span>
      {children}
      {hint ? (
        <span className="mt-1 block text-[11px] text-slate-500">{hint}</span>
      ) : null}
    </label>
  );
}

export const inputClass =
  'h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500';

export const selectClass = inputClass + ' pr-8';
