'use client';

import { useState } from 'react';

import {
  ALL_EXPORT_SECTION_KEYS,
  EXPORT_SECTIONS,
  type ExportSectionKey,
} from '@/lib/export/sections';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';

/**
 * Export All Data (Owner/Admin) — opens a small modal to choose a date range,
 * all-vs-filtered, and which sections, then downloads one server-generated Excel
 * workbook. The browser never loads the dataset; it POSTs the options and streams
 * the finished file. The button locks while generating so a repeat click can't
 * start a second export.
 */
export function ExportAllButton({
  label = '⭳ Export All Data',
  testId = 'export-all-data',
  size,
}: {
  /** The trigger's wording. Dashboard Profile shows it as "Export Reports". */
  label?: string;
  testId?: string;
  size?: 'sm';
} = {}) {
  const [open, setOpen] = useState(false);
  const [applyRange, setApplyRange] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selected, setSelected] = useState<Set<ExportSectionKey>>(
    new Set(ALL_EXPORT_SECTION_KEYS),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (key: ExportSectionKey) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const runExport = async () => {
    if (busy) return;
    setError(null);
    if (selected.size === 0) {
      setError('Select at least one section to export.');
      return;
    }
    if (applyRange && (!from || !to)) {
      setError('Enter both a start and end date, or switch to All records.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/export/all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: from || null,
          to: to || null,
          applyRange,
          sections: [...selected],
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? 'The export could not be generated.');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `MineFlow-Data-Export-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setOpen(false);
    } catch {
      setError('The export could not be generated. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        {...(size ? { size } : {})}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        data-testid={testId}
      >
        {label}
      </Button>

      <Modal
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        title="Export All Data"
        description="Generates one Excel workbook (a sheet per section) from the live database."
        size="md"
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void runExport()}
              disabled={busy}
              data-testid="export-all-confirm"
            >
              {busy ? 'Generating…' : 'Export Excel'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {/* Records scope */}
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Records
            </p>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="scope"
                checked={!applyRange}
                onChange={() => setApplyRange(false)}
                data-testid="export-scope-all"
              />
              Include all records
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="scope"
                checked={applyRange}
                onChange={() => setApplyRange(true)}
                data-testid="export-scope-range"
              />
              Filter by date range
            </label>
            {applyRange ? (
              <div className="mt-1 flex flex-wrap items-end gap-2 pl-6">
                <div>
                  <Label htmlFor="exp-from" className="text-xs">
                    From
                  </Label>
                  <Input
                    id="exp-from"
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    className="mt-0.5 h-9"
                  />
                </div>
                <div>
                  <Label htmlFor="exp-to" className="text-xs">
                    To
                  </Label>
                  <Input
                    id="exp-to"
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className="mt-0.5 h-9"
                  />
                </div>
              </div>
            ) : null}
          </div>

          {/* Sections */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Sections
              </p>
              <div className="flex gap-2 text-xs">
                <button
                  type="button"
                  className="text-gold-strong hover:underline"
                  onClick={() => setSelected(new Set(ALL_EXPORT_SECTION_KEYS))}
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="text-muted-foreground hover:underline"
                  onClick={() => setSelected(new Set())}
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
              {EXPORT_SECTIONS.map((s) => (
                <label key={s.key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.has(s.key)}
                    onChange={() => toggle(s.key)}
                    data-testid={`export-section-${s.key}`}
                  />
                  {s.label}
                </label>
              ))}
            </div>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
