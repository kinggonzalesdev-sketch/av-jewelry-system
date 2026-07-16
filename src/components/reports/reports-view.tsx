import type { SalesSummary } from '@/lib/dashboard/service';
import { formatPeso } from '@/lib/payments/format';
import { BarChart } from '@/components/ui/bar-chart';
import { ReadError } from '@/components/ui/page-primitives';

/**
 * Reports — the ONE approved report (sales summary, §25), nothing invented.
 *
 * Reading a report is export-gated: it carries the export_data_reports
 * permission, not plain visibility, because taking a summary away is more than
 * seeing a screen. The database re-checks and RLS still scopes every row, so a
 * report can never contain a record the caller could not already read.
 *
 * States: permission-denied, no-range prompt, explicit read-error, and results.
 */
export type ReportsResult =
  { ok: true; data: SalesSummary } | { ok: false; error: string };

export function ReportsView({
  canExport,
  from,
  to,
  result,
}: {
  canExport: boolean;
  from: string;
  to: string;
  result: ReportsResult | null;
}) {
  if (!canExport) {
    return (
      <div
        className="rounded-xl border border-border bg-card p-6 text-center"
        data-testid="reports-denied"
      >
        <p className="text-sm font-medium text-foreground">
          Reports require the Export Data / Reports permission
        </p>
        <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
          Reading a summary is taking data, so it carries the export permission rather
          than plain visibility. Ask the Owner to grant it.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <form
        method="GET"
        className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-card p-4"
      >
        <div>
          <label htmlFor="from" className="text-xs text-muted-foreground">
            From
          </label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={from}
            required
            className="mt-0.5 h-9 rounded-md border border-border bg-background px-3 text-sm"
          />
        </div>
        <div>
          <label htmlFor="to" className="text-xs text-muted-foreground">
            To
          </label>
          <input
            id="to"
            name="to"
            type="date"
            defaultValue={to}
            required
            className="mt-0.5 h-9 rounded-md border border-border bg-background px-3 text-sm"
          />
        </div>
        <button
          type="submit"
          className="h-9 rounded-md bg-gold px-3 text-sm font-semibold text-black hover:bg-gold/90"
        >
          Run Report
        </button>
      </form>

      {result === null ? (
        <p className="text-sm text-muted-foreground" data-testid="reports-prompt">
          Choose a date range and run the sales summary. Verified money only — unverified
          evidence is not revenue.
        </p>
      ) : !result.ok ? (
        <ReadError title="Report could not be generated" detail={result.error} />
      ) : (
        <div
          className="space-y-4 rounded-xl border border-border bg-card p-4"
          data-testid="reports-result"
        >
          <div>
            <p className="text-xs text-muted-foreground">Verified collected</p>
            <p className="text-3xl font-bold tabular-nums text-foreground">
              {formatPeso(result.data.verifiedCollected)}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {result.data.from.slice(0, 10)} to {result.data.to.slice(0, 10)}
            </p>
          </div>

          <dl className="grid grid-cols-3 gap-x-4 gap-y-2 text-xs">
            <div>
              <dt className="text-muted-foreground">Payments recorded</dt>
              <dd className="text-lg font-bold tabular-nums">
                {result.data.paymentsRecorded}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Verified</dt>
              <dd className="text-lg font-bold tabular-nums">
                {result.data.paymentsVerified}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Unverified</dt>
              <dd className="text-lg font-bold tabular-nums">
                {result.data.paymentsUnverified}
              </dd>
            </div>
          </dl>

          <div className="border-t border-border pt-3">
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
              Payments in range, by verification
            </p>
            <BarChart
              ariaLabel="Payments by verification status"
              data={[
                { label: 'Verified', value: result.data.paymentsVerified },
                { label: 'Unverified', value: result.data.paymentsUnverified },
              ]}
              emptyLabel="No payments recorded in this range."
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Verified money only. A report is limited to records you can already see, and
            grants no authority over them.
          </p>
        </div>
      )}
    </div>
  );
}
