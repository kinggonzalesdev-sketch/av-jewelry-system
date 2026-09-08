'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  loadTemplateHistoryAction,
  resetMessageTemplateAction,
  saveMessageTemplateAction,
} from '@/lib/messaging/actions';
import type { MessageTemplate, TemplateHistoryEntry } from '@/lib/messaging/templates';
import { unsupportedTokens } from '@/lib/messaging/template-vars';
import {
  AUTO_TEXT_TOKENS,
  AUTO_TEXT_VARIABLES,
  autoTextSampleValues,
  renderAutoText,
  type AutoTextMode,
} from '@/lib/messaging/auto-text';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
}

/**
 * The "Auto Sent Text Message" editor (Owner 2026-08-22) — the Capture Route B Private Reply.
 *
 * SEPARATE from the Invoice Message template: it has its own variables, its own validation whitelist,
 * and a MODE-AWARE Live Preview (Grams / Fixed Price) that runs the SAME engine the server uses, with
 * real computed totals + the conditional 20% Layaway DP. One template body carries both pricing blocks;
 * the inapplicable lines are suppressed automatically per mode. Save / Reset / History reuse the shared
 * message-template actions (this key is 'auto_text').
 */
export function AutoTextTemplateCard({ template }: { template: MessageTemplate }) {
  const router = useRouter();
  const [body, setBody] = useState(template.body);
  const [previewMode, setPreviewMode] = useState<AutoTextMode>('grams');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [history, setHistory] = useState<TemplateHistoryEntry[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const submittingRef = useRef(false);

  const unknown = unsupportedTokens(body, AUTO_TEXT_TOKENS);
  const blank = body.trim().length === 0;
  const dirty = body !== template.body;
  const canSave = !pending && !blank && unknown.length === 0 && dirty;

  const insertVariable = (token: string) => {
    const el = textareaRef.current;
    if (!el) {
      setBody((b) => b + token);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + token + body.slice(end));
    setSaved(false);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const save = async () => {
    if (!canSave || submittingRef.current) return;
    submittingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const res = await saveMessageTemplateAction(template.key, body);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(true);
      router.refresh();
    } finally {
      setPending(false);
      submittingRef.current = false;
    }
  };

  const reset = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await resetMessageTemplateAction(template.key);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setBody(template.defaultBody);
      setConfirmReset(false);
      setSaved(true);
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  const openHistory = async () => {
    setShowHistory(true);
    if (history === null) setHistory(await loadTemplateHistoryAction(template.key));
  };

  const previewText = renderAutoText(body, autoTextSampleValues(previewMode));

  return (
    <section
      className="rounded-xl border border-border bg-card p-4"
      data-testid={`template-${template.key}`}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{template.label}</h3>
        <p className="text-[11px] text-muted-foreground">
          Last updated {fmtDateTime(template.updatedAt)}
          {template.updatedByName ? ` by ${template.updatedByName}` : ''}
        </p>
      </div>

      <p className="mb-2 rounded-md border border-dashed border-border bg-secondary/30 p-2 text-[11px] text-muted-foreground">
        This is the message a customer receives automatically when the actual screenshot can’t be sent
        (Photo waiting). The <strong>grams</strong> lines (Item Per Gram, Grams) and the{' '}
        <strong>Fixed Price</strong> line are shown or hidden automatically to match each capture’s
        mode — you keep ONE template. <strong>Total Amount</strong> is computed (grams × rate, or the
        fixed price). <strong>For Layaway DP</strong> appears only when the total is ₱15,000 or more
        (20% of the total). Edit the wording freely; the numbers always come from the capture.
      </p>

      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Available variables
      </p>
      <div className="mb-2 flex flex-wrap gap-1">
        {AUTO_TEXT_VARIABLES.map((v) => (
          <button
            key={v.token}
            type="button"
            title={v.description}
            onClick={() => insertVariable(v.token)}
            data-testid={`var-chip-${v.token}`}
            className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] hover:bg-accent"
          >
            {v.token}
          </button>
        ))}
      </div>

      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Message content
        </span>
        <textarea
          ref={textareaRef}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setSaved(false);
          }}
          rows={16}
          data-testid={`template-body-${template.key}`}
          className="block w-full resize-y whitespace-pre-wrap rounded-md border border-border bg-background p-2 font-mono text-xs outline-none focus:border-gold focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
      </label>

      {/* Live preview — SAME engine + computed values the customer gets; toggle the capture mode. */}
      <div className="mt-2">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Live preview (sample data)
          </p>
          <div className="inline-flex overflow-hidden rounded-md border border-border" role="group">
            {(['grams', 'fixed'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setPreviewMode(m)}
                data-testid={`autotext-preview-mode-${m}`}
                aria-pressed={previewMode === m}
                className={`px-2 py-0.5 text-[10px] font-medium ${
                  previewMode === m
                    ? 'bg-gold text-black'
                    : 'bg-background text-muted-foreground hover:bg-accent'
                }`}
              >
                {m === 'grams' ? 'Grams' : 'Fixed Price'}
              </button>
            ))}
          </div>
        </div>
        <pre
          className="whitespace-pre-wrap rounded-md border border-dashed border-border bg-secondary/30 p-2 text-xs"
          data-testid={`template-preview-${template.key}`}
        >
          {previewText}
        </pre>
      </div>

      {blank ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          A message template cannot be blank.
        </p>
      ) : null}
      {unknown.length > 0 ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          Unsupported variable{unknown.length > 1 ? 's' : ''}: {unknown.join(', ')}. Use only the
          variables above.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="mt-2 text-xs text-green-700">
          Saved.
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => void save()}
          disabled={!canSave}
          data-testid={`template-save-${template.key}`}
        >
          {pending ? 'Saving…' : 'Save'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setConfirmReset(true)}
          data-testid={`template-reset-${template.key}`}
        >
          Reset to Default
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => void openHistory()}>
          History
        </Button>
      </div>

      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        critical
        size="sm"
        title="Reset to default?"
        description="The current wording is replaced by the shipped default."
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void reset()}
              disabled={pending}
            >
              {pending ? 'Resetting…' : 'Reset to Default'}
            </Button>
          </>
        }
      >
        <p className="text-sm">
          <strong>{template.label}</strong> goes back to its original wording. The current version is
          kept in history, so this can be undone by pasting it back.
        </p>
      </Modal>

      <Modal
        open={showHistory}
        onClose={() => setShowHistory(false)}
        size="lg"
        title={`${template.label} — history`}
        description="Previous versions, newest first."
        footer={
          <Button type="button" onClick={() => setShowHistory(false)}>
            Close
          </Button>
        }
      >
        {history === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No previous versions — this template has not been changed yet.
          </p>
        ) : (
          <ul className="space-y-3">
            {history.map((h) => (
              <li key={h.id} className="rounded-lg border border-border p-3">
                <p className="mb-1 text-[11px] text-muted-foreground">
                  {fmtDateTime(h.updatedAt)}
                  {h.updatedByName ? ` · ${h.updatedByName}` : ''}
                </p>
                <pre className="whitespace-pre-wrap rounded-md bg-secondary/30 p-2 text-xs">
                  {h.previousBody}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </section>
  );
}
