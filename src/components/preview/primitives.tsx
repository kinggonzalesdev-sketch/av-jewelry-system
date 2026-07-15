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
        'inline-flex items-center gap-1 rounded-full border border-amber-300 night:border-amber-700 bg-amber-50 night:bg-amber-950 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800 night:text-amber-200',
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
    <span className="inline-flex items-center rounded-full border border-slate-300 night:border-slate-600 bg-slate-50 night:bg-slate-800 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-600 night:text-slate-300">
      {label}
    </span>
  );
}

const TONE_CLASS: Record<string, string> = {
  green:
    'border-emerald-200 night:border-emerald-800 bg-emerald-50 night:bg-emerald-950 text-emerald-800 night:text-emerald-300',
  amber:
    'border-amber-200 night:border-amber-800 bg-amber-50 night:bg-amber-950 text-amber-800 night:text-amber-200',
  red: 'border-rose-200 night:border-rose-800 bg-rose-50 night:bg-rose-950 text-rose-800 night:text-rose-200',
  blue: 'border-sky-200 night:border-sky-800 bg-sky-50 night:bg-sky-950 text-sky-800 night:text-sky-300',
  slate:
    'border-slate-200 night:border-slate-700 bg-slate-100 night:bg-slate-800 text-slate-700 night:text-slate-300',
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
    <span className="inline-flex items-center gap-1 rounded-full border border-violet-200 night:border-violet-800 bg-violet-50 night:bg-violet-950 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-violet-800 night:text-violet-300">
      Owner only
    </span>
  );
}

export function PermissionBadge({ permission }: { permission: string }) {
  return (
    <span className="inline-flex items-center rounded border border-slate-200 night:border-slate-700 bg-white night:bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 night:text-slate-300">
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
          'border border-slate-300 night:border-slate-600 bg-white night:bg-slate-900 text-slate-700 night:text-slate-300 hover:bg-slate-50 night:hover:bg-slate-800',
        variant === 'ghost' &&
          'text-slate-600 night:text-slate-300 hover:bg-slate-100 night:hover:bg-slate-800',
        variant === 'danger' &&
          'border border-rose-300 night:border-rose-700 bg-white night:bg-slate-900 text-rose-700 night:text-rose-300 hover:bg-rose-50 night:hover:bg-rose-950',
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
      className={cn(
        'rounded-xl border border-slate-200 night:border-slate-700 bg-white night:bg-slate-900 shadow-sm',
        className,
      )}
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
        <h2 className="text-lg font-semibold tracking-tight text-slate-900 night:text-slate-100">
          {title}
        </h2>
        {description ? (
          <p className="mt-0.5 text-sm text-slate-500 night:text-slate-400">
            {description}
          </p>
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
          ? 'border-amber-200 night:border-amber-800 bg-amber-50 night:bg-amber-950 text-amber-900 night:text-amber-200'
          : 'border-slate-200 night:border-slate-700 bg-slate-50 night:bg-slate-800 text-slate-600 night:text-slate-300',
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
      <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-700 night:text-slate-300">
        {label}
        {required ? <span className="text-rose-600">*</span> : null}
      </span>
      {children}
      {hint ? (
        <span className="mt-1 block text-[11px] text-slate-500 night:text-slate-400">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export const inputClass =
  'h-10 w-full rounded-lg border border-slate-300 night:border-slate-600 bg-white night:bg-slate-900 px-3 text-sm text-slate-900 night:text-slate-100 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500';

export const selectClass = inputClass + ' pr-8';
