'use client';

import { useState } from 'react';

import { saveMessagingSequenceAction } from '@/lib/messaging/actions';
import type { MessagingSequenceSettings } from '@/lib/messaging/sequence-settings';
import {
  MESSAGE_SEQUENCE_OPTIONS,
  TEXT_SEND_ATTEMPTS_MAX,
  TEXT_SEND_ATTEMPTS_MIN,
  attemptSettingFor,
  type MessageSequence,
} from '@/lib/capture/message-sequence';
import { Button } from '@/components/ui/button';

const ATTEMPT_CHOICES = Array.from(
  { length: TEXT_SEND_ATTEMPTS_MAX - TEXT_SEND_ATTEMPTS_MIN + 1 },
  (_, i) => TEXT_SEND_ATTEMPTS_MIN + i,
);

type Saved = { mode: MessageSequence; attempts: number; screenshotAttempts: number };

/**
 * Settings → Live Selling / Messaging (Owner 2026-09-24). The Private Reply Sequence and its
 * attempt setting for Incoming Captures: Text Send Attempts on Screenshot First, Screenshot Send
 * Attempts on Computation First (Owner 2026-09-25). Saving affects NEW messaging flows only; a
 * capture already being sent keeps the sequence it started with.
 */
export function MessageSequenceCard({ initial }: { initial: MessagingSequenceSettings }) {
  const [mode, setMode] = useState<MessageSequence>(initial.mode);
  const [attempts, setAttempts] = useState<number>(initial.attempts);
  const [screenshotAttempts, setScreenshotAttempts] = useState<number>(initial.screenshotAttempts);
  const [saved, setSaved] = useState<Saved>({
    mode: initial.mode,
    attempts: initial.attempts,
    screenshotAttempts: initial.screenshotAttempts,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const setting = attemptSettingFor(mode);
  const screenshotSetting = setting === 'screenshot';
  const dirty =
    mode !== saved.mode ||
    (screenshotSetting ? screenshotAttempts !== saved.screenshotAttempts : attempts !== saved.attempts);
  // Computation First needs its own database update (migration 20260925120000).
  const blocked = mode === 'computation_first' && !initial.computationFirstAvailable;

  const save = async () => {
    if (busy || !dirty || blocked) return;
    setBusy(true);
    setMessage(null);
    const res = await saveMessagingSequenceAction({
      mode,
      attempts: screenshotSetting ? screenshotAttempts : attempts,
    });
    setBusy(false);
    if (!res.ok) {
      setMessage({ tone: 'error', text: res.error });
      return;
    }
    setSaved({
      mode: res.settings.mode,
      attempts: res.settings.attempts,
      screenshotAttempts: res.settings.screenshotAttempts,
    });
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

      {blocked && initial.available ? (
        <p
          role="status"
          className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800"
          data-testid="computation-first-unavailable"
        >
          Computation First needs its database update before it can be saved.
        </p>
      ) : null}

      {screenshotSetting ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label htmlFor="screenshot-send-attempts" className="text-xs font-semibold text-foreground">
            Screenshot Send Attempts
          </label>
          <select
            id="screenshot-send-attempts"
            value={screenshotAttempts}
            onChange={(e) => setScreenshotAttempts(Number(e.target.value))}
            className="h-11 rounded-md border border-border bg-background px-3 text-base sm:h-9 sm:text-sm"
            data-testid="screenshot-send-attempts"
          >
            {ATTEMPT_CHOICES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">
            total tries after the computation ({TEXT_SEND_ATTEMPTS_MIN}–{TEXT_SEND_ATTEMPTS_MAX});
            only temporary errors are retried.
          </span>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label htmlFor="text-send-attempts" className="text-xs font-semibold text-foreground">
            Text Send Attempts
          </label>
          <select
            id="text-send-attempts"
            value={attempts}
            onChange={(e) => setAttempts(Number(e.target.value))}
            disabled={setting !== 'text'}
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
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          onClick={() => void save()}
          disabled={busy || !dirty || !initial.available || blocked}
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
