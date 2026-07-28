'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { importInventoryItemsAction } from '@/lib/inventory/actions';
import { parseInventoryCode } from '@/lib/inventory/code-parser';
import { parseCsv, type ParsedCsv } from '@/lib/import/parse-csv';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';

/**
 * Inventory import (spec §A/§B). Upload a CSV → map the columns → PREVIEW with
 * parsing, validation, and duplicate detection → confirm. Nothing is written on
 * file selection; only valid, non-duplicate rows are inserted on confirm, and the
 * original inventory code is preserved exactly (§C). Excel (.xlsx) parsing needs a
 * library the project does not depend on yet — CSV is supported here honestly.
 */

export function InventoryImportButton({ existingCodes }: { existingCodes: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState<ParsedCsv | null>(null);
  const [fileName, setFileName] = useState('');
  const [itemCol, setItemCol] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    inserted: number;
    skipped: number;
    duplicates: number;
    invalid: number;
  } | null>(null);

  const existing = useMemo(() => new Set(existingCodes), [existingCodes]);

  function reset() {
    setCsv(null);
    setFileName('');
    setItemCol('');
    setError(null);
    setResult(null);
    setPending(false);
  }

  async function onFile(file: File | null | undefined) {
    if (!file) return;
    setError(null);
    setResult(null);
    if (!/\.csv$/i.test(file.name)) {
      setError('Please choose a .csv file. Excel (.xlsx) import needs a library not yet installed.');
      return;
    }
    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      if (parsed.headers.length === 0) {
        setError('That file has no columns.');
        return;
      }
      setCsv(parsed);
      setFileName(file.name);
      // Best-effort auto-mapping of the one column we need — the raw item entry.
      const find = (re: RegExp) => parsed.headers.find((h) => re.test(h)) ?? '';
      setItemCol(find(/item|code/i) || (parsed.headers[0] ?? ''));
    } catch {
      setError('The file could not be read.');
    }
  }

  const preview = useMemo(() => {
    if (!csv || !itemCol) return [];
    const itemIdx = csv.headers.indexOf(itemCol);
    // A duplicate detected within the SAME upload (before it ever hits the DB).
    const seen = new Set<string>();
    return csv.rows.map((r, i) => {
      const itemStr = (r[itemIdx] ?? '').trim();
      const p = parseInventoryCode(itemStr);
      const code = p.inventoryCode;
      const dup = code ? existing.has(code) || seen.has(code) : false;
      if (code) seen.add(code);
      return {
        sourceRow: i + 2,
        itemStr,
        p,
        dup,
        valid: p.status === 'ok',
      };
    });
  }, [csv, itemCol, existing]);

  const importable = preview.filter((r) => r.valid && !r.dup);
  const duplicates = preview.filter((r) => r.dup).length;
  const invalid = preview.filter((r) => !r.valid).length;

  async function confirmImport() {
    setPending(true);
    setError(null);
    try {
      const items = importable.map((r) => ({
        itemCode: r.p.inventoryCode as string,
        itemName: r.p.itemType,
        // Price stays blank (its mapping was removed) — Date Encoded is set to the
        // import date by the database default; Facebook Name stays blank too.
        price: null,
        grams: r.p.grams,
        size: r.p.size,
        supplier: null,
      }));
      const res = await importInventoryItemsAction(items);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResult({
        inserted: res.inserted,
        skipped: res.skipped,
        duplicates,
        invalid,
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
  ) : csv ? (
    <>
      <Button type="button" variant="outline" onClick={reset}>
        Choose another file
      </Button>
      <Button
        type="button"
        onClick={() => void confirmImport()}
        disabled={pending || importable.length === 0}
      >
        {pending ? 'Importing…' : `Import ${importable.length} valid row(s)`}
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
        onClose={() => {
          reset();
          setOpen(false);
        }}
        title="Import inventory from Excel / CSV"
        description="Upload a .csv, map the columns, review the preview, then confirm. Nothing is saved until you confirm."
        size="lg"
        critical
        footer={footer}
      >
        {result ? (
          <div className="space-y-2 py-4 text-center" role="status">
            <p className="text-sm font-semibold text-foreground">Import complete</p>
            <p className="text-sm text-muted-foreground">
              <span className="text-green-600">{result.inserted} imported</span> ·{' '}
              <span className="text-amber-600">{result.duplicates} duplicate</span> ·{' '}
              <span className="text-destructive">{result.invalid} invalid</span> ·{' '}
              {result.skipped} skipped in total. Imported items now appear in the table —
              no refresh needed.
            </p>
          </div>
        ) : !csv ? (
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
                .csv · the item column holds codes like SBA-N-2683 1.80g 16&quot;
              </span>
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                data-testid="inventory-import-file"
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
              {fileName} · {csv.rows.length} data row(s)
            </p>

            {/* Column mapping — only the raw item column is needed. Everything else
                (code, grams, size) is parsed from it; price/supplier/date are not
                mapped (price/Facebook blank; Date Encoded = import date). */}
            <div>
              <Label className="text-xs" htmlFor="import-item-col">
                Item Column *
              </Label>
              <select
                id="import-item-col"
                value={itemCol}
                onChange={(e) => setItemCol(e.target.value)}
                className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
              >
                {csv.headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>

            {/* Validation summary */}
            <div className="flex flex-wrap gap-3 rounded-lg border border-border bg-card p-2.5 text-xs">
              <span>{preview.length} rows detected</span>
              <span className="text-green-600">{importable.length} valid new</span>
              <span className="text-amber-600">{duplicates} duplicate</span>
              <span className="text-destructive">{invalid} need review</span>
            </div>

            {/* Preview table */}
            <div className="max-h-[45vh] overflow-auto rounded-lg border border-border">
              <table className="w-full min-w-[760px] text-left text-[11px]">
                <thead className="sticky top-0 bg-muted/80 text-[10px] uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-1.5">Row</th>
                    <th className="px-3 py-1.5">Original</th>
                    <th className="px-3 py-1.5">Code</th>
                    <th className="px-3 py-1.5">Condition</th>
                    <th className="px-3 py-1.5">Supplier Code</th>
                    <th className="px-3 py-1.5">Type</th>
                    <th className="px-3 py-1.5">Grams</th>
                    <th className="px-3 py-1.5">Size</th>
                    <th className="px-3 py-1.5">Duplicate</th>
                    <th className="px-3 py-1.5">Validation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {preview.slice(0, 300).map((r) => (
                    <tr
                      key={r.sourceRow}
                      className={r.dup ? 'bg-amber-500/5' : !r.valid ? 'bg-destructive/5' : ''}
                    >
                      <td className="px-3 py-1 tabular-nums">{r.sourceRow}</td>
                      <td className="px-3 py-1 font-mono">{r.itemStr}</td>
                      <td className="px-3 py-1 font-mono">{r.p.inventoryCode ?? '—'}</td>
                      <td className="px-3 py-1">{r.p.condition ?? '—'}</td>
                      <td className="px-3 py-1">{r.p.supplierInitial ?? '—'}</td>
                      <td className="px-3 py-1">{r.p.itemType ?? '—'}</td>
                      <td className="px-3 py-1 tabular-nums">{r.p.grams ?? '—'}</td>
                      <td className="px-3 py-1">{r.p.size ?? '—'}</td>
                      <td className="px-3 py-1">
                        {r.dup ? (
                          <span className="text-amber-600">Duplicate</span>
                        ) : (
                          <span className="text-green-600">New</span>
                        )}
                      </td>
                      <td className="px-3 py-1">
                        {r.valid ? (
                          <span className="text-green-600">OK</span>
                        ) : (
                          <span
                            className="text-destructive"
                            title={r.p.issues.join(' ')}
                          >
                            Needs review
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Confirming imports the {importable.length} valid, non-duplicate row(s).
              Duplicates and needs-review rows are skipped — never overwritten.
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
