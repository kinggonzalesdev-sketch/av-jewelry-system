'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  loadTemplateHistoryAction,
  resetMessageTemplateAction,
  saveMessageTemplateAction,
} from '@/lib/messaging/actions';
import type { MessageTemplate, TemplateHistoryEntry } from '@/lib/messaging/templates';
import {
  renderTemplate,
  SAMPLE_VALUES,
  TEMPLATE_VARIABLES,
  unsupportedTokens,
} from '@/lib/messaging/template-vars';
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
 * One template's editor: content, clickable variable chips, a live preview built
 * from sample data, Save, Reset to Default, and its version history.
 *
 * The preview uses the SAME substitution the server uses when it renders a real
 * message, so what the Owner sees here is what a customer will get — only with
 * sample values instead of a real order's.
 */
function TemplateCard({ template }: { template: MessageTemplate }) {
  const router = useRouter();
  const [body, setBody] = useState(template.body);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [history, setHistory] = useState<TemplateHistoryEntry[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const submittingRef = useRef(false);

  const unknown = unsupportedTokens(body);
  const blank = body.trim().length === 0;
  const dirty = body !== template.body;
  const canSave = !pending && !blank && unknown.length === 0 && dirty;

  /** Insert a variable AT THE CURSOR, not at the end. */
  const insertVariable = (token: string) => {
    const el = textareaRef.current;
    if (!el) {
      setBody((b) => b + token);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    setSaved(false);
    // Restore the caret just after the inserted token.
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

      {/* Variable chips — click to insert at the cursor. */}
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Available variables
      </p>
      <div className="mb-2 flex flex-wrap gap-1">
        {TEMPLATE_VARIABLES.map((v) => (
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
          rows={10}
          data-testid={`template-body-${template.key}`}
          className="block w-full resize-y whitespace-pre-wrap rounded-md border border-border bg-background p-2 font-mono text-xs outline-none focus:border-gold"
        />
      </label>

      {/* Live preview — same substitution the server does, with sample data. */}
      <div className="mt-2">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Live preview (sample data)
        </p>
        <pre
          className="whitespace-pre-wrap rounded-md border border-dashed border-border bg-secondary/30 p-2 text-xs"
          data-testid={`template-preview-${template.key}`}
        >
          {renderTemplate(body, SAMPLE_VALUES)}
        </pre>
      </div>

      {blank ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          A message template cannot be blank.
        </p>
      ) : null}
      {unknown.length > 0 ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          Unsupported variable{unknown.length > 1 ? 's' : ''}: {unknown.join(', ')}. Use
          only the variables above.
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
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void openHistory()}
        >
          History
        </Button>
      </div>

      {/* Reset needs a confirmation — it discards the current wording. */}
      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        critical
        size="sm"
        title="Reset to default?"
        description="The current wording is replaced by the shipped default."
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmReset(false)}
            >
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
          <strong>{template.label}</strong> goes back to its original wording. The current
          version is kept in history, so this can be undone by pasting it back.
        </p>
      </Modal>

      {/* Version history. */}
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

/** The Message Templates screen — Super Admin only (the page enforces it too). */
export function MessageTemplatesPanel({ templates }: { templates: MessageTemplate[] }) {
  if (templates.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No message templates could be loaded.
      </p>
    );
  }
  return (
    <div className="space-y-4" data-testid="message-templates">
      {templates.map((t) => (
        <TemplateCard key={t.key} template={t} />
      ))}
    </div>
  );
}
