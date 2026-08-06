'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { updateCustomerAction } from '@/lib/customers/actions';
import type { CustomerListRow, CustomersResult } from '@/lib/customers/service';
import { CustomerRowActions } from '@/components/customers/customer-row-actions';
import { CustomerMatchHint } from '@/components/customers/customer-match-hint';
import { EmptyState } from '@/components/states/empty-state';
import { Sensitive, SensitivePhone } from '@/components/shell/privacy';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ReadError, StatusBadge } from '@/components/ui/page-primitives';
import { Modal } from '@/components/ui/modal';

/**
 * Customers directory — read-only. Selecting "View" opens a centered modal with
 * the customer's core details (no right-side panel). The list stays mounted
 * behind the modal, so search text and scroll position are preserved. Nothing
 * here writes; related orders / claims / photos are intentionally not shown on
 * this page (their backend data is untouched).
 */

/** A short local date for "Date Created", or a dash. */
function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString();
}

function CustomerList({
  result,
  query,
  canManage,
  onView,
}: {
  result: CustomersResult;
  query: string;
  canManage: boolean;
  onView: (row: CustomerListRow) => void;
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
        <table className="data-table w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2.5 text-left font-medium">Customer Name</th>
              <th className="px-3 py-2.5 text-left font-medium">Address</th>
              <th className="px-3 py-2.5 text-left font-medium">Contact</th>
              <th className="px-3 py-2.5 text-center font-medium">Status</th>
              <th className="px-3 py-2.5 text-center font-medium">Stage</th>
              <th className="px-3 py-2.5 text-right font-medium">Details</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <tr key={row.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2.5 font-medium">{row.displayName}</td>
                <td className="px-3 py-2.5 text-muted-foreground">
                  {row.address ? <Sensitive>{row.address}</Sensitive> : '—'}
                </td>
                <td className="px-3 py-2.5 text-muted-foreground">
                  {row.contactNumber ? (
                    <SensitivePhone value={row.contactNumber} />
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-3 py-2.5 text-center">
                  <StatusBadge
                    label={row.isActive ? 'Active' : 'Inactive'}
                    tone={row.isActive ? 'strong' : 'warning'}
                  />
                </td>
                <td className="px-3 py-2.5 text-center text-muted-foreground">{row.stage}</td>
                <td className="px-3 py-2.5 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    {canManage ? (
                      <CustomerRowActions
                        customerId={row.id}
                        customerName={row.displayName}
                        canManage={canManage}
                      />
                    ) : null}
                    <button
                      type="button"
                      onClick={() => onView(row)}
                      data-testid={`customer-view-${row.id}`}
                      className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
                    >
                      View
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

/**
 * Modal body — View by default; Edit turns Full Name / Contact / Address / Stage-
 * area into a form. Stage + Date Created stay read-only (Stage is derived from the
 * customer's latest order, not a stored customer field). Saves by permanent id via
 * updateCustomerAction; the row + modal refresh without a full reload.
 */
function CustomerModalContent({
  customer,
  canEdit,
  onChange,
}: {
  customer: CustomerListRow;
  canEdit: boolean;
  onChange: (next: CustomerListRow) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(customer.displayName);
  const [contact, setContact] = useState(customer.contactNumber ?? '');
  const [address, setAddress] = useState(customer.address ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEdit = () => {
    setName(customer.displayName);
    setContact(customer.contactNumber ?? '');
    setAddress(customer.address ?? '');
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    const res = await updateCustomerAction(
      customer.id,
      name,
      contact.trim() || null,
      address.trim() || null,
    );
    if (!res.ok) {
      setSaving(false);
      setError(res.error);
      return;
    }
    // Reflect the change in the open modal + refresh the row (no full reload).
    onChange({
      ...customer,
      displayName: name.trim(),
      contactNumber: contact.trim() || null,
      address: address.trim() || null,
    });
    router.refresh();
    setSaving(false);
    setEditing(false);
  };

  if (!editing) {
    return (
      <div data-testid="customer-detail-modal">
        <dl className="text-sm">
          <DetailRow label="Full Name" value={customer.displayName || '—'} />
          <DetailRow
            label="Contact Number"
            value={
              customer.contactNumber ? (
                <SensitivePhone value={customer.contactNumber} />
              ) : (
                '—'
              )
            }
          />
          <DetailRow
            label="Address"
            value={customer.address ? <Sensitive>{customer.address}</Sensitive> : '—'}
          />
          <DetailRow label="Stage" value={customer.stage || '—'} />
          <DetailRow label="Date Created" value={fmtDate(customer.createdAt)} />
        </dl>
        {canEdit ? (
          <div className="mt-4 flex justify-end">
            <Button
              type="button"
              size="sm"
              onClick={startEdit}
              data-testid="customer-edit"
            >
              Edit
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3 text-sm" data-testid="customer-edit-form">
      {/* Compact two-column layout: short fields pair up; full name spans both. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="cust-name" className="text-xs">
            Full Name
          </Label>
          <Input
            id="cust-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="mt-1 h-9"
            data-testid="customer-edit-name"
          />
          {/* Shared match hint — warns if this name now collides with ANOTHER customer
              (this record is excluded, so it never matches itself). */}
          <CustomerMatchHint
            name={name}
            phone={contact}
            excludeCustomerId={customer.id}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="cust-contact" className="text-xs">
            Contact Number
          </Label>
          <Input
            id="cust-contact"
            type="tel"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="e.g. 0999-000-0001"
            className="mt-1 h-9"
            data-testid="customer-edit-contact"
          />
        </div>
        <div>
          <Label htmlFor="cust-address" className="text-xs">
            Address
          </Label>
          <Input
            id="cust-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="mt-1 h-9"
            data-testid="customer-edit-address"
          />
        </div>
        <div>
          <Label className="text-xs">Stage</Label>
          <p className="mt-1 rounded-md border border-dashed border-border px-2 py-1.5 text-xs text-muted-foreground">
            {customer.stage || '—'} — from the latest order.
          </p>
        </div>
        <div className="flex flex-col justify-end">
          <DetailRow label="Date Created" value={fmtDate(customer.createdAt)} />
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2 pt-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setEditing(false)}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => void save()}
          disabled={saving}
          data-testid="customer-save"
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </Button>
      </div>
    </div>
  );
}

export function CustomersView({
  result,
  query,
  canManage,
  canEdit = false,
}: {
  result: CustomersResult;
  query: string;
  canManage: boolean;
  canEdit?: boolean;
}) {
  const [selected, setSelected] = useState<CustomerListRow | null>(null);

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

      <CustomerList
        result={result}
        query={query}
        canManage={canManage}
        onView={setSelected}
      />

      {/* Centered detail modal — dark overlay, ✕ / Escape / click-outside close,
          background scroll locked, list preserved behind it. */}
      <Modal
        open={selected !== null}
        onClose={() => setSelected(null)}
        title="Customer"
        size="sm"
      >
        {selected ? (
          <CustomerModalContent
            key={selected.id}
            customer={selected}
            canEdit={canEdit}
            onChange={setSelected}
          />
        ) : null}
      </Modal>
    </div>
  );
}
