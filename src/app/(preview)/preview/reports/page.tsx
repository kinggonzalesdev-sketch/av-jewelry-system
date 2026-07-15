import { ComingSoonPage } from '@/components/preview/shell';

/**
 * Reports stays a SEPARATE, future detailed-reporting area.
 *
 * Dashboard Report is the summary overview; Reports is where detailed exports,
 * transaction/payment/inventory reports, staff activity, shop performance, and
 * historical analysis will live. The two are deliberately not duplicated.
 */
export default function Page() {
  return (
    <ComingSoonPage
      title="Reports"
      phase="Phase 9 — Detailed reporting, exports, and historical analysis"
    />
  );
}
