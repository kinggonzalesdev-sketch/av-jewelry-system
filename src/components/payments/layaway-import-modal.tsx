'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { importLayawayLedgerAction } from '@/lib/payments/actions';
import type { LayawayLedgerInput } from '@/lib/payments/layaway-ledger';
import {
  analyzeLayawayCsv,
  layawayDedupKey,
  type LayawayCsvAnalysis,
} from '@/lib/import/layaway-csv';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';

/**
 * Layaway import — Inventory-style. Upload a CSV → the analyzer AUTO-DETECTS the
 * real header row (past title/spacer rows) and AUTO-MAPS every column (Code,
 * blank-header Customer Name, main fields, repeated DATE/INTEREST installment
 * groups, and DATE/MOP/DP payment groups) → immediate preview with valid /
 * duplicate / needs-review counts + parsed installment & payment totals → confirm.
 * Nothing is written until confirm; the database RPC re-checks + dedups. Money stays
 * a string; installments and payments are stored as history keyed by the account id.
 */
/** Natural code order: A1, A2, … A200, B1, … Z200. Rows without a code sort last. */
function codeSortKey(code: string | null): [number, number] {
  const m = /^([A-Za-z])(\d+)$/.exec((code ?? '').trim());
  if (!m) return [99, 9999];
  return [(m[1] ?? 'Z').toUpperCase().charCodeAt(0) - 65, Number(m[2])];
}

export function LayawayImportButton({ existingKeys }: { existingKeys: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [analysis, setAnalysis] = useState<LayawayCsvAnalysis | null>(null);
  const [fileName, setFileName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Preview navigation.
  const [search, setSearch] = useState('');
  const [codeFilter, setCodeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'completed' | 'needs_review'>('all');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;
  const [result, setResult] = useState<{
    inserted: number;
    skipped: number;
    installments: number;
    payments: number;
    duplicates: number;
    review: number;
  } | null>(null);

  const existing = useMemo(() => new Set(existingKeys), [existingKeys]);

  function reset() {
    setAnalysis(null);
    setFileName('');
    setError(null);
    setResult(null);
    setPending(false);
  }

  async function onFile(file: File | null | undefined) {
    if (!file) return;
    setError(null);
    setResult(null);
    if (!/\.csv$/i.test(file.name)) {
      setError('Please choose a .csv file (export the sheet as CSV first).');
      return;
    }
    try {
      const a = analyzeLayawayCsv(await file.text());
      if (!a.ok) {
        setError(a.error ?? 'The file could not be analyzed.');
        return;
      }
      setAnalysis(a);
      setFileName(file.name);
      // Every new upload starts at the first record with cleared filters.
      setSearch('');
      setCodeFilter('all');
      setStatusFilter('all');
      setPage(1);
    } catch {
      setError('The file could not be read.');
    }
  }

  // Preview rows with duplicate detection layered on the parsed records.
  const preview = useMemo(() => {
    if (!analysis) return [];
    const seen = new Set<string>();
    return analysis.records.map((rec) => {
      const key = layawayDedupKey(rec);
      const dup = existing.has(key) || seen.has(key);
      seen.add(key);
      return { ...rec, dup };
    });
  }, [analysis, existing]);

  // Needs-Review (ERROR) rows are hard-blocked from import and every total.
  const importable = preview.filter((r) => !r.dup && !r.needsReview);
  const duplicates = preview.filter((r) => r.dup).length;
  const review = preview.filter((r) => r.needsReview && !r.dup).length;
  const activeCount = importable.filter((r) => r.status === 'active').length;
  const completedCount = importable.filter((r) => r.status === 'completed').length;
  const totalInstallments = importable.reduce((n, r) => n + r.installments.length, 0);
  const totalPayments = importable.reduce((n, r) => n + r.payments.length, 0);

  // Distinct code letters present, for the Code filter (A–Z that actually exist).
  const codeLetters = useMemo(() => {
    const set = new Set<string>();
    for (const r of preview) {
      const c = (r.code ?? '').trim().charAt(0).toUpperCase();
      if (/[A-Z]/.test(c)) set.add(c);
    }
    return [...set].sort();
  }, [preview]);

  // Filter → natural sort → paginate. Importing still uses the FULL importable set
  // above, so records outside the visible page are always imported.
  const filteredSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = preview.filter((r) => {
      if (codeFilter !== 'all' && (r.code ?? '').trim().charAt(0).toUpperCase() !== codeFilter) {
        return false;
      }
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (q && !`${r.code ?? ''} ${r.name}`.toLowerCase().includes(q)) return false;
      return true;
    });
    return rows.sort((a, b) => {
      const ka = codeSortKey(a.code);
      const kb = codeSortKey(b.code);
      return ka[0] - kb[0] || ka[1] - kb[1] || a.name.localeCompare(b.name);
    });
  }, [preview, search, codeFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredSorted.length / PAGE_SIZE));
  const pageClamped = Math.min(page, totalPages);
  const startIdx = (pageClamped - 1) * PAGE_SIZE;
  const visible = filteredSorted.slice(startIdx, startIdx + PAGE_SIZE);
  const rangeText = filteredSorted.length
    ? `Showing ${startIdx + 1}–${Math.min(startIdx + PAGE_SIZE, filteredSorted.length)} of ${filteredSorted.length}`
    : 'No records match the current filters';

  const resetPage = () => setPage(1);

  async function confirmImport() {
    if (!analysis) return;
    setPending(true);
    setError(null);
    try {
      const rows: LayawayLedgerInput[] = importable.map((r) => ({
        code: r.code,
        customerName: r.name,
        status: r.status,
        remarks: r.remarks,
        datePurchased: r.datePurchased,
        itemAmount: r.item,
        interest: r.interest,
        grandTotal: r.grandTotal,
        payment: r.payment,
        balance: r.balance,
        balanceMismatch: r.balanceMismatch,
        nextDueDate: r.nextDueDate,
        monthlyInterest: r.monthlyInterest,
        totalInstallmentInterest: r.totalInstallmentInterest,
        lastPaymentDate: r.lastPaymentDate,
        modeOfPayment: r.modeOfPayment,
        latestPaymentDp: r.latestPaymentDp,
        resize: r.resize,
        screw: r.screw,
        notes: r.notes,
        interestType: r.interestType,
        layawayTerm: r.layawayTerm,
        interestRate: r.interestRate,
        fixedInterest: r.fixedInterest,
        installments: r.installments.map((i) => ({
          dueDate: i.dueDate,
          interest: i.interest,
          expectedDp: null,
          status: null,
          sourcePosition: i.sourcePosition,
        })),
        payments: r.payments.map((p) => ({
          paymentDate: p.paymentDate,
          amount: p.amount,
          mop: p.mop,
          reference: null,
          sourcePosition: p.sourcePosition,
        })),
      }));
      const res = await importLayawayLedgerAction(rows);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResult({
        inserted: res.inserted,
        skipped: res.skipped,
        installments: res.installments,
        payments: res.payments,
        duplicates,
        review,
      });
      router.refresh();
    } catch {
      setError('The import failed. Nothing was saved.');
    } finally {
      setPending(false);
    }
  }

  const footer = result ? (
    <Button
      type="button"
      onClick={() => {
        reset();
        setOpen(false);
      }}
    >
      Done
    </Button>
  ) : analysis ? (
    <>
      <Button type="button" variant="outline" onClick={reset}>
        Choose another file
      </Button>
      <Button
        type="button"
        onClick={() => void confirmImport()}
        disabled={pending || importable.length === 0}
        data-testid="layaway-import-confirm"
      >
        {pending ? 'Importing…' : `Import ${importable.length} account(s)`}
      </Button>
    </>
  ) : (
    <Button type="button" variant="outline" onClick={() => setOpen(false)}>
      Cancel
    </Button>
  );

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        data-testid="layaway-upload"
      >
        ⭱ Upload Excel / CSV
      </Button>

      <Modal
        open={open}
        onClose={() => {
          reset();
          setOpen(false);
        }}
        title="Import layaway accounts from Excel / CSV"
        description="Upload a .csv — MineFlow finds the header row and maps the columns automatically. Nothing is saved until you confirm."
        size="lg"
        critical
        footer={footer}
      >
        {result ? (
          <div className="space-y-2 py-4 text-center" role="status">
            <p className="text-sm font-semibold text-foreground">Import complete</p>
            <p className="text-sm text-muted-foreground">
              <span className="text-green-600">{result.inserted} accounts imported</span> ·{' '}
              <span className="text-amber-600">{result.duplicates} duplicate</span> ·{' '}
              <span className="text-amber-600">{result.review} flagged</span>. Parsed{' '}
              {result.installments} installment + {result.payments} payment history records.
              They now appear in Layaway Accounts — no refresh needed.
            </p>
          </div>
        ) : !analysis ? (
          <div className="space-y-3">
            <label
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void onFile(e.dataTransfer.files?.[0]);
              }}
              className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border bg-background px-4 py-10 text-center text-sm hover:border-gold/50"
            >
              <span className="text-2xl" aria-hidden="true">
                ⭱
              </span>
              <span className="font-medium">Choose a CSV file or drag it here</span>
              <span className="text-xs text-muted-foreground">
                Header row, Code, Customer Name, installment (Date/Interest) and payment
                (Date/MOP/DP) groups are detected automatically.
              </span>
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                data-testid="layaway-import-file"
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
            </label>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {fileName} · header detected on row {analysis.headerRowIndex + 1} ·{' '}
              {preview.length} account(s) found
            </p>

            {analysis.needsManualMapping ? (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-600">
                The Customer Name column could not be identified — check that the sheet has
                the standard A.V. layaway layout.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5 rounded-lg border border-border bg-card p-2 text-[11px]">
                <span className="text-muted-foreground">Auto-detected:</span>
                {analysis.detectedColumns.map((c) => (
                  <span
                    key={c}
                    className="rounded-full border border-border bg-background px-2 py-0.5"
                  >
                    {c}
                  </span>
                ))}
              </div>
            )}

            {/* Counts — scoped. ERROR rows are Needs Review (never imported / totaled). */}
            <div className="flex flex-wrap gap-3 rounded-lg border border-border bg-card p-2.5 text-xs">
              <span className="text-green-600">{importable.length} valid new</span>
              <span className="text-muted-foreground">({activeCount} active · {completedCount} completed)</span>
              <span className="text-amber-600">{duplicates} duplicate</span>
              <span className="text-destructive">{review} needs review (excluded)</span>
              <span className="text-muted-foreground">
                {totalInstallments} installments · {totalPayments} payments parsed
              </span>
            </div>

            {/* Search + filters for reviewing A–Z. Imports still cover ALL valid rows. */}
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  resetPage();
                }}
                placeholder="Search Code or Customer Name…"
                data-testid="layaway-import-search"
                className="h-8 flex-1 min-w-[12rem] rounded-md border border-border bg-background px-2.5 text-xs outline-none focus:border-gold"
              />
              <select
                value={codeFilter}
                onChange={(e) => {
                  setCodeFilter(e.target.value);
                  resetPage();
                }}
                aria-label="Filter by code letter"
                className="h-8 rounded-md border border-border bg-background px-2 text-xs"
              >
                <option value="all">All codes</option>
                {codeLetters.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as typeof statusFilter);
                  resetPage();
                }}
                aria-label="Filter by status"
                className="h-8 rounded-md border border-border bg-background px-2 text-xs"
              >
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="needs_review">Needs Review</option>
              </select>
            </div>

            {/* Preview */}
            <div className="max-h-[42vh] overflow-auto rounded-lg border border-border">
              <table className="w-full min-w-[900px] text-left text-[11px]">
                <thead className="sticky top-0 bg-muted/80 text-[10px] uppercase text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5">Code</th>
                    <th className="px-2 py-1.5">Customer</th>
                    <th className="px-2 py-1.5">Status</th>
                    <th className="px-2 py-1.5">Interest Type</th>
                    <th className="px-2 py-1.5 text-right">Term</th>
                    <th className="px-2 py-1.5 text-right">Grand Total</th>
                    <th className="px-2 py-1.5 text-right">Payment</th>
                    <th className="px-2 py-1.5 text-right">Balance</th>
                    <th className="px-2 py-1.5 text-right">Inst.</th>
                    <th className="px-2 py-1.5 text-right">Pmts</th>
                    <th className="px-2 py-1.5">Review</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visible.map((r) => (
                    <tr
                      key={r.sourceRow}
                      className={r.dup ? 'bg-amber-500/5' : r.needsReview ? 'bg-amber-500/5' : ''}
                    >
                      <td className="px-2 py-1 font-mono">{r.code ?? '—'}</td>
                      <td className="px-2 py-1">{r.name}</td>
                      <td className="px-2 py-1 capitalize">{r.status}</td>
                      <td className="px-2 py-1">
                        {r.interestType === 'zero' ? (
                          <span className="rounded-full border border-green-600/40 bg-green-600/10 px-1.5 py-0.5 text-green-700">
                            0% Interest
                          </span>
                        ) : (
                          <span className="capitalize">{r.interestType}</span>
                        )}
                      </td>
                      <td className="px-2 py-1 text-right">{r.layawayTerm ?? '—'}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{r.grandTotal ?? '—'}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{r.payment ?? '—'}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{r.balance ?? '—'}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{r.installments.length}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{r.payments.length}</td>
                      <td className="px-2 py-1">
                        {r.dup ? (
                          <span className="text-amber-600">Duplicate</span>
                        ) : r.needsReview ? (
                          <span className="text-amber-600" title={r.reviewReason ?? ''}>
                            Review
                          </span>
                        ) : (
                          <span className="text-green-600">OK</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination — First / Prev / range / Next / Last. */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground" data-testid="layaway-import-range">
                {rangeText}
              </span>
              <div className="flex items-center gap-1">
                <Button type="button" size="sm" variant="outline" onClick={() => setPage(1)} disabled={pageClamped <= 1}>
                  « First
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setPage((n) => Math.max(1, n - 1))} disabled={pageClamped <= 1}>
                  ‹ Prev
                </Button>
                <span className="px-1 text-muted-foreground">
                  Page {pageClamped} / {totalPages}
                </span>
                <Button type="button" size="sm" variant="outline" onClick={() => setPage((n) => Math.min(totalPages, n + 1))} disabled={pageClamped >= totalPages}>
                  Next ›
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setPage(totalPages)} disabled={pageClamped >= totalPages}>
                  Last »
                </Button>
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground">
              Confirming imports {importable.length} account(s) with their installment schedule
              + payment history into Layaway Accounts. Duplicates are skipped; flagged rows are
              imported but marked for review (values are never overwritten).
            </p>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        )}
      </Modal>
    </>
  );
}
