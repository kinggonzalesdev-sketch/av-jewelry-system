'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { importInventoryItemsAction, parseInventoryWorkbookAction } from '@/lib/inventory/actions';
import type { DetectSummary, ImportCandidate } from '@/lib/inventory/import-detect';
import { formatPeso } from '@/lib/payments/format';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';

/**
 * Inventory import (multi-sheet Excel + CSV). Upload a workbook → the SERVER reads
 * every worksheet, detects inventory blocks, maps headers by alias, parses each
 * row, and detects `HK ITEM` → Fixed Price → PREVIEW with filters, search, and
 * duplicate/needs-review flags → confirm. Nothing is written until you confirm;
 * only valid, non-duplicate rows are inserted, original codes preserved exactly.
 */

type StatusFilter = 'all' | 'valid' | 'duplicate' | 'needs_review';

const peso = (v: string | null) => (v ? formatPeso(v) : '—');

export function InventoryImportButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState('');
  const [parsing, setParsing] = useState(false);
  const [candidates, setCandidates] = useState<ImportCandidate[] | null>(null);
  const [summary, setSummary] = useState<DetectSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [sheetFilter, setSheetFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');

  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ inserted: number; skipped: number } | null>(null);

  function reset() {
    setFileName('');
    setParsing(false);
    setCandidates(null);
    setSummary(null);
    setError(null);
    setSheetFilter('all');
    setStatusFilter('all');
    setQuery('');
    setImporting(false);
    setResult(null);
  }

  async function onFile(file: File | null | undefined) {
    if (!file) return;
    setError(null);
    setResult(null);
    if (!/\.(csv|xlsx)$/i.test(file.name)) {
      setError('Choose a .xlsx or .csv file.');
      return;
    }
    setParsing(true);
    setFileName(file.name);
    try {
      const form = new FormData();
      form.set('file', file);
      const res = await parseInventoryWorkbookAction(form);
      if (!res.ok) {
        setError(res.error);
        setCandidates(null);
        return;
      }
      setCandidates(res.candidates);
      setSummary(res.summary);
    } catch {
      setError('The file could not be read.');
    } finally {
      setParsing(false);
    }
  }

  const sheets = useMemo(
    () => Array.from(new Set((candidates ?? []).map((c) => c.sheet))),
    [candidates],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (candidates ?? []).filter((c) => {
      if (sheetFilter !== 'all' && c.sheet !== sheetFilter) return false;
      if (statusFilter !== 'all' && c.validation !== statusFilter) return false;
      if (!q) return true;
      return [c.inventoryCode ?? '', c.itemName ?? '', c.original, c.sheet]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [candidates, sheetFilter, statusFilter, query]);

  const importable = useMemo(
    () => (candidates ?? []).filter((c) => c.validation === 'valid'),
    [candidates],
  );

  async function confirmImport() {
    setImporting(true);
    setError(null);
    try {
      const items = importable.map((c) => ({
        itemCode: c.inventoryCode as string,
        itemName: c.itemName,
        price: c.pricingType === 'fixed' ? c.fixedPrice : null,
        grams: c.grams,
        size: c.size,
        supplier: null,
      }));
      const res = await importInventoryItemsAction(items);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResult({ inserted: res.inserted, skipped: res.skipped });
      router.refresh();
    } catch {
      setError('The import failed. Nothing was saved.');
    } finally {
      setImporting(false);
    }
  }

  const footer = result ? (
    <Button type="button" onClick={() => { reset(); setOpen(false); }}>
      Done
    </Button>
  ) : candidates ? (
    <>
      <Button type="button" variant="outline" onClick={reset}>
        Choose another file
      </Button>
      <Button
        type="button"
        onClick={() => void confirmImport()}
        disabled={importing || importable.length === 0}
        data-testid="inventory-import-confirm"
      >
        {importing ? 'Importing…' : `Import ${importable.length} valid row(s)`}
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
        data-testid="inventory-upload"
      >
        ⭱ Upload Excel / CSV
      </Button>

      <Modal
        open={open}
        onClose={() => { reset(); setOpen(false); }}
        title="Import inventory from Excel / CSV"
        description="Every worksheet is read automatically. HK ITEM rows import as Fixed Price. Nothing is saved until you confirm."
        size="xl"
        critical
        footer={footer}
      >
        {result ? (
          <div className="space-y-2 py-4 text-center" role="status">
            <p className="text-sm font-semibold text-foreground">Import complete</p>
            <p className="text-sm text-muted-foreground">
              <span className="text-green-600">{result.inserted} imported</span> ·{' '}
              {result.skipped} skipped (duplicate / needs review). Imported items now appear in
              Active Inventory — no refresh needed.
            </p>
          </div>
        ) : !candidates ? (
          <div className="space-y-3">
            <label
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); void onFile(e.dataTransfer.files?.[0]); }}
              className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border bg-background px-4 py-10 text-center text-sm hover:border-gold/50"
            >
              <span className="text-2xl" aria-hidden="true">⭱</span>
              <span className="font-medium">
                {parsing ? 'Reading every worksheet…' : 'Choose an .xlsx or .csv file or drag it here'}
              </span>
              <span className="text-xs text-muted-foreground">
                All sheets, blocks, and HK ITEM prices are detected automatically.
              </span>
              <input
                type="file"
                accept=".csv,.xlsx,text/csv"
                className="sr-only"
                disabled={parsing}
                data-testid="inventory-import-file"
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
            </label>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">{fileName}</p>

            {/* Summary */}
            {summary ? (
              <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg border border-border bg-card p-2.5 text-xs">
                <span>{summary.worksheets} sheet(s)</span>
                <span>{summary.blocks} block(s)</span>
                <span>{summary.candidates} rows</span>
                <span className="text-green-600">{summary.valid} valid new</span>
                <span className="text-amber-600">{summary.duplicate} duplicate</span>
                <span className="text-destructive">{summary.needsReview} need review</span>
                <span className="text-muted-foreground">
                  {summary.ignoredBlank} blank · {summary.ignoredHeader} header rows ignored
                </span>
              </div>
            ) : null}

            {/* Filters + search */}
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={sheetFilter}
                onChange={(e) => setSheetFilter(e.target.value)}
                className="h-8 rounded-md border border-border bg-background px-2 text-xs"
                data-testid="import-sheet-filter"
              >
                <option value="all">All Sheets</option>
                {sheets.map((s) => (
                  <option key={s} value={s}>
                    {s} ({summary?.perSheet[s]?.candidates ?? 0})
                  </option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="h-8 rounded-md border border-border bg-background px-2 text-xs"
                data-testid="import-status-filter"
              >
                <option value="all">All</option>
                <option value="valid">Valid</option>
                <option value="duplicate">Duplicate</option>
                <option value="needs_review">Needs Review</option>
              </select>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search code, item, text, sheet…"
                className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-xs"
                data-testid="import-search"
              />
              <span className="text-xs text-muted-foreground">{filtered.length} shown</span>
            </div>

            {/* Preview table */}
            <div className="max-h-[45vh] overflow-auto rounded-lg border border-border">
              <table className="data-table min-w-[1100px] table-fixed text-left text-[11px]">
                <thead className="sticky top-0 z-10 bg-muted/90 text-[10px] uppercase text-muted-foreground">
                  <tr>
                    {['Sheet', 'Row', 'Original', 'Code', 'Item', 'Type', 'Grams', 'Size',
                      'Pricing', 'Fixed Price', 'Per Gram', 'Computed', 'Date', 'Dup', 'Validation'].map((h) => (
                      <th key={h} className="whitespace-nowrap px-2 py-1.5">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.slice(0, 500).map((c, i) => (
                    <tr
                      key={`${c.sheet}-${c.sourceRow}-${c.sourceBlock}-${i}`}
                      className={
                        c.validation === 'duplicate'
                          ? 'bg-amber-500/5'
                          : c.validation === 'needs_review'
                            ? 'bg-destructive/5'
                            : ''
                      }
                    >
                      <td className="px-2 py-1">{c.sheet}</td>
                      <td className="px-2 py-1 tabular-nums">{c.sourceRow}</td>
                      <td className="max-w-[200px] truncate px-2 py-1 font-mono" title={c.original}>
                        {c.original}
                      </td>
                      <td className="px-2 py-1 font-mono">{c.inventoryCode ?? '—'}</td>
                      <td className="max-w-[140px] truncate px-2 py-1">
                        {c.itemName ?? '—'}
                        {c.isHkItem ? (
                          <span className="ml-1 rounded bg-gold/20 px-1 text-[9px] font-bold text-gold-strong">
                            HK
                          </span>
                        ) : null}
                      </td>
                      <td className="px-2 py-1">{c.itemType ?? '—'}</td>
                      <td className="px-2 py-1 tabular-nums">{c.grams ?? '—'}</td>
                      <td className="px-2 py-1">{c.size ?? '—'}</td>
                      <td className="px-2 py-1">
                        {c.pricingType === 'fixed' ? 'Fixed' : c.pricingType === 'per_gram' ? 'Per Gram' : '—'}
                      </td>
                      <td className="px-2 py-1 tabular-nums">{peso(c.fixedPrice)}</td>
                      <td className="px-2 py-1 tabular-nums">{peso(c.pricePerGram)}</td>
                      <td className="px-2 py-1 tabular-nums">{peso(c.computedPrice)}</td>
                      <td className="px-2 py-1">{c.date ?? '—'}</td>
                      <td className="px-2 py-1">
                        {c.duplicate ? <span className="text-amber-600">Dup</span> : <span className="text-green-600">New</span>}
                      </td>
                      <td className="px-2 py-1">
                        {c.validation === 'valid' ? (
                          <span className="text-green-600">Valid</span>
                        ) : c.validation === 'duplicate' ? (
                          <span className="text-amber-600" title={c.issues.join(' · ')}>
                            {c.issues[0] ?? 'Duplicate'}
                          </span>
                        ) : (
                          <span className="text-destructive" title={c.issues.join(' · ')}>
                            {c.issues[0] ?? 'Needs review'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Confirming imports the {importable.length} valid, non-duplicate row(s) from every sheet.
              Duplicates and needs-review rows are skipped — never overwritten.
            </p>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          </div>
        )}
      </Modal>
    </>
  );
}
