'use client';

import { useState } from 'react';

import { saveMessagingSequenceAction } from '@/lib/messaging/actions';
import type { MessagingSequenceSettings } from '@/lib/messaging/sequence-settings';
import {
  MESSAGE_SEQUENCE_OPTIONS,
  TEXT_SEND_ATTEMPTS_MAX,
  TEXT_SEND_ATTEMPTS_MIN,
  type MessageSequence,
} from '@/lib/capture/message-sequence';
import { Button } from '@/components/ui/button';

const ATTEMPT_CHOICES = Array.from(
  { length: TEXT_SEND_ATTEMPTS_MAX - TEXT_SEND_ATTEMPTS_MIN + 1 },
  (_, i) => TEXT_SEND_ATTEMPTS_MIN + i,
);

/**
 * Settings → Live Selling / Messaging (Owner 2026-09-24). The Private Reply Sequence and Text
 * Send Attempts for Incoming Captures. Saving affects NEW messaging flows only; a capture already
 * being sent keeps the sequence it started with.
 */
export function MessageSequenceCard({ initial }: { initial: MessagingSequenceSettings }) {
  const [mode, setMode] = useState<MessageSequence>(initial.mode);
  const [attempts, setAttempts] = useState<number>(initial.attempts);
  const [saved, setSaved] = useState<{ mode: MessageSequence; attempts: number }>({
    mode: initial.mode,
    attempts: initial.attempts,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const dirty = mode !== saved.mode || attempts !== saved.attempts;

  const save = async () => {
    if (busy || !dirty) return;
    setBusy(true);
    setMessage(null);
    const res = await saveMessagingSequenceAction({ mode, attempts });
    setBusy(false);
    if (!res.ok) {
      setMessage({ tone: 'error', text: res.error });
      return;
    }
    setSaved({ mode: res.settings.mode, attempts: res.settings.attempts });
    setMessage({ tone: 'ok', text: 'Saved ✓ — applies to new captures.' });
  };

  return (
    <section
      className="rounded-xl border border-border bg-card p-4"
      aria-labelledby="live-messaging-h"
      data-testid="message-sequence-card"
    >
      <h2 id="live-messaging-h" className="mb-1 text-sm font-semibold text-foreground">
        Live Selling / Messaging
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        How Incoming Captures message the customer. Changes apply to new captures; a capture
        already being sent keeps the sequence it started with.
      </p>

      {!initial.available ? (
        <p
          role="status"
          className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800"
        >
          This setting needs its database update before it can be saved. Until then, captures
          keep the previous behaviour.
        </p>
      ) : null}

      <fieldset className="space-y-2">
        <legend className="mb-1 text-xs font-semibold text-foreground">Private Reply Sequence</legend>
        {MESSAGE_SEQUENCE_OPTIONS.map((opt) => (
          <label
            key={opt.value}
            className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${
              mode === opt.value ? 'border-primary bg-primary/5' : 'border-border'
            }`}
          >
            <input
              type="radio"
              name="private-reply-sequence"
              value={opt.value}
              checked={mode === opt.value}
              onChange={() => setMode(opt.value)}
              className="mt-0.5 h-4 w-4 shrink-0"
              data-testid={`sequence-option-${opt.value}`}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">{opt.label}</span>
              <span className="block text-xs text-muted-foreground">{opt.description}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor="text-send-attempts" className="text-xs font-semibold text-foreground">
          Text Send Attempts
        </label>
        <select
          id="text-send-attempts"
          value={attempts}
          onChange={(e) => setAttempts(Number(e.target.value))}
          disabled={mode !== 'screenshot_first'}
          className="h-11 rounded-md border border-border bg-background px-3 text-base sm:h-9 sm:text-sm"
          data-testid="text-send-attempts"
        >
          {ATTEMPT_CHOICES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">
          total tries after the screenshot ({TEXT_SEND_ATTEMPTS_MIN}–{TEXT_SEND_ATTEMPTS_MAX}); only
          temporary errors are retried.
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          onClick={() => void save()}
          disabled={busy || !dirty || !initial.available}
          data-testid="message-sequence-save"
        >
          {busy ? 'Saving…' : 'Save'}
        </Button>
        {message ? (
          <span
            role={message.tone === 'error' ? 'alert' : 'status'}
            className={`text-xs ${message.tone === 'error' ? 'text-destructive' : 'text-emerald-600'}`}
          >
            {message.text}
          </span>
        ) : null}
      </div>
    </section>
  );
}
