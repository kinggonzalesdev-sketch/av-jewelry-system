'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  deleteSupplierCodeAction,
  upsertSupplierCodeAction,
} from '@/lib/inventory/supplier-actions';
import type { SupplierCode } from '@/lib/inventory/suppliers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Supplier-code manager (Settings). Maps the supplier initial the inventory code
 * parser extracts (e.g. "A" in SBA-N-2683) to a supplier name. Owner/Admin only;
 * the server action + DB function are the real gate.
 */
export function SupplierCodesPanel({ codes }: { codes: SupplierCode[] }) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    if (pending) return;
    const c = code.trim().toUpperCase();
    if (!/^[A-Z]{1,3}$/.test(c)) {
      setError('A supplier code must be 1–3 letters.');
      return;
    }
    if (!name.trim()) {
      setError('Enter the supplier name.');
      return;
    }
    setPending(true);
    setError(null);
    const res = await upsertSupplierCodeAction(c, name.trim());
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setCode('');
    setName('');
    router.refresh();
  };

  const remove = async (c: string) => {
    const res = await deleteSupplierCodeAction(c);
    if (res.ok) router.refresh();
    else setError(res.error);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-20">
          <Label htmlFor="supplier-code" className="text-xs">
            Code
          </Label>
          <Input
            id="supplier-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="A"
            maxLength={3}
            className="mt-1 h-9 uppercase"
          />
        </div>
        <div className="min-w-[160px] flex-1">
          <Label htmlFor="supplier-name" className="text-xs">
            Supplier Name
          </Label>
          <Input
            id="supplier-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Subasta Gold Trading"
            className="mt-1 h-9"
          />
        </div>
        <Button type="button" onClick={() => void add()} disabled={pending} className="h-9">
          {pending ? 'Saving…' : 'Add / Update'}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {codes.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No supplier codes yet. Add the initials your inventory codes use (the letter
          after the condition prefix).
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[360px] text-left text-sm" data-testid="supplier-codes">
            <thead className="border-b bg-muted/50 text-[10px] uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5">Code</th>
                <th className="px-3 py-1.5">Supplier</th>
                <th className="px-3 py-1.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {codes.map((s) => (
                <tr key={s.code}>
                  <td className="px-3 py-1.5 font-mono font-semibold">{s.code}</td>
                  <td className="px-3 py-1.5">{s.name}</td>
                  <td className="px-3 py-1.5 text-right">
                    <button
                      type="button"
                      onClick={() => void remove(s.code)}
                      className="rounded-md border border-border px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
