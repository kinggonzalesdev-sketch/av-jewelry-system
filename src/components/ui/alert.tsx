import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Alert — the shared inline message box. Reuses the system status colours (the same
 * `.badge-*` tokens as StatusBadge) so info/success/warning/error/neutral mean the same
 * thing everywhere, in both light and dark. Colour + icon + text (never colour alone).
 */
export type AlertTone = 'info' | 'success' | 'warning' | 'error' | 'neutral';

const ALERT: Record<AlertTone, { cls: string; icon: string }> = {
  info: { cls: 'badge-blue', icon: 'ℹ' },
  success: { cls: 'badge-green', icon: '✓' },
  warning: { cls: 'badge-amber', icon: '●' },
  error: { cls: 'badge-red', icon: '✕' },
  neutral: { cls: 'badge-gray', icon: '●' },
};

export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const a = ALERT[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2 rounded-lg border px-3 py-2 text-sm',
        a.cls,
        className,
      )}
    >
      <span aria-hidden="true" className="mt-0.5 shrink-0 text-xs leading-none">
        {a.icon}
      </span>
      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? (
          <div className={cn(title && 'mt-0.5 opacity-90')}>{children}</div>
        ) : null}
      </div>
    </div>
  );
}
