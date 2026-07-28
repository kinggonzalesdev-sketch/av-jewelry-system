'use client';

import { Button } from '@/components/ui/button';

/**
 * Prints the current page via the browser's own print dialog. Honest by design:
 * it opens the OS/browser print flow (which can print to the XP-236B or any
 * printer, or to PDF) — it never claims a printer is connected or that anything
 * printed. The `print:hidden` class keeps this control off the printed sheet.
 */
export function PrintButton({ label = 'Print waybill' }: { label?: string }) {
  return (
    <Button type="button" onClick={() => window.print()} className="print:hidden">
      {label}
    </Button>
  );
}
