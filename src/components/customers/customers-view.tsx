import Link from 'next/link';

import type { CustomerDetailResult, CustomersResult } from '@/lib/customers/service';
import { EmptyState } from '@/components/states/empty-state';
import { ReadError, StatusBadge, type BadgeTone } from '@/components/ui/page-primitives';

/**
 * Customers directory — real, read-only. A failed read shows an explicit error,
 * never an empty table. Selecting a customer opens their detail with related
 * Official Orders and claims (all RLS-scoped). Nothing here writes.
 */

function humanize(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function detailHref(query: string, id: string): string {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  params.set('id', id);
  return `/customers?${params.toString()}`;
}

function CustomerList({
  result,
  query,
  selectedId,
}: {
  result: CustomersResult;
  query: string;
  selectedId: string | null;
}) {
  if (!result.ok) {
    return <ReadError title="Customers could not be loaded" detail={result.reason} />;
  }

  if (result.rows.length === 0) {
    return query ? (
      <EmptyState title="No matches" description={`No customers match “${query}”.`} />
    ) : (
      <EmptyState
        title="No customers yet"
        description="Customers are created when a claim is captured during a live session or a record is migrated."
      />
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead>
            <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">Customer</th>
              <th className="px-3 py-2 font-medium">Contact</th>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 text-right font-medium">Details</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <tr
                key={row.id}
                className={
                  row.id === selectedId
                    ? 'border-b border-border bg-accent/50 last:border-0'
                    : 'border-b border-border last:border-0'
                }
              >
                <td className="px-3 py-2.5 font-medium">{row.displayName}</td>
                <td className="px-3 py-2.5 text-muted-foreground">
                  {row.contactNumber ?? '—'}
                </td>
                <td className="px-3 py-2.5">
                  <StatusBadge
                    label={row.sourceKind === 'migrated' ? 'Migrated' : 'Native'}
                    tone="neutral"
                  />
                </td>
                <td className="px-3 py-2.5">
                  <StatusBadge
                    label={row.isActive ? 'Active' : 'Inactive'}
                    tone={row.isActive ? 'strong' : 'warning'}
                  />
                </td>
                <td className="px-3 py-2.5 text-right">
                  <Link
                    href={detailHref(query, row.id)}
                    className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
                  >
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const ORDER_TONE: Record<string, BadgeTone> = {
  invoiced: 'neutral',
  active_layaway: 'gold',
  for_fulfillment: 'gold',
  closed: 'strong',
  cancelled: 'danger',
};

function CustomerDetailPanel({ detail }: { detail: CustomerDetailResult }) {
  if (!detail.ok) {
    return (
      <ReadError title="Customer details could not be loaded" detail={detail.reason} />
    );
  }
  if (detail.customer === null) {
    return (
      <EmptyState
        title="Customer not found"
        description="This customer does not exist or is not visible to you."
      />
    );
  }

  const { customer, orders, claims } = detail;

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            {customer.displayName}
          </h2>
          <p className="text-sm text-muted-foreground">
            {customer.contactNumber ?? 'No contact number'}
          </p>
        </div>
        <div className="flex gap-1.5">
          <StatusBadge
            label={customer.sourceKind === 'migrated' ? 'Migrated' : 'Native'}
            tone="neutral"
          />
          <StatusBadge
            label={customer.isActive ? 'Active' : 'Inactive'}
            tone={customer.isActive ? 'strong' : 'warning'}
          />
        </div>
      </div>

      {customer.notes ? (
        <p className="rounded-lg bg-muted p-2 text-sm text-muted-foreground">
          {customer.notes}
        </p>
      ) : null}

      <section>
        <h3 className="mb-1.5 text-sm font-semibold text-foreground">
          Official Orders ({orders.length})
        </h3>
        {orders.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Official Orders.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {orders.map((o) => (
              <li
                key={o.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-1.5"
              >
                <span className="font-mono text-xs">{o.orderNumber}</span>
                <StatusBadge
                  label={humanize(o.status)}
                  tone={ORDER_TONE[o.status] ?? 'neutral'}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-1.5 text-sm font-semibold text-foreground">
          Claims ({claims.length})
        </h3>
        {claims.length === 0 ? (
          <p className="text-sm text-muted-foreground">No claims.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {claims.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-1.5"
              >
                <span className="font-mono text-xs">
                  {c.claimReference}
                  <span className="ml-2 text-muted-foreground">×{c.quantity}</span>
                </span>
                <StatusBadge label={humanize(c.status)} tone="neutral" />
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        Read-only. Related orders and claims are limited to records you may already see.
        Customer records are created through claim capture or migration, not here.
      </p>
    </div>
  );
}

export function CustomersView({
  result,
  query,
  detail,
  selectedId,
}: {
  result: CustomersResult;
  query: string;
  detail: CustomerDetailResult | null;
  selectedId: string | null;
}) {
  return (
    <div className="space-y-4">
      <form method="GET" className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="q" className="text-xs text-muted-foreground">
            Search customers
          </label>
          <input
            id="q"
            name="q"
            defaultValue={query}
            placeholder="Name or contact number…"
            className="mt-0.5 h-9 w-72 rounded-md border border-border bg-background px-3 text-sm"
          />
        </div>
        <button
          type="submit"
          className="h-9 rounded-md border border-border px-3 text-sm font-medium hover:bg-accent"
        >
          Search
        </button>
        {query ? (
          <Link
            href="/customers"
            className="h-9 rounded-md px-2 text-sm text-muted-foreground hover:text-foreground"
          >
            Clear
          </Link>
        ) : null}
      </form>

      {query.length > 0 && query.trim().length < 2 ? (
        <p className="text-xs text-muted-foreground">Enter at least two characters.</p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <CustomerList result={result} query={query} selectedId={selectedId} />
        {detail ? <CustomerDetailPanel detail={detail} /> : null}
      </div>
    </div>
  );
}
