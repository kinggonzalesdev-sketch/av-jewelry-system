'use client';

import { useState } from 'react';

import { setOrderFacebookLinkAction } from '@/lib/orders/actions';

/**
 * Linked Facebook Customer panel (spec §3/§4/§6). Manages THIS order's own confirmed
 * Facebook/Pancake link — the conversation Send Invoice delivers to and the chat Open
 * FB Chat opens — independent of the customer profile (so a later profile edit can't
 * silently repoint it). States: Confirmed (the order has its own link), Using
 * customer's default (no order link yet, falling back to the customer), or Not linked.
 * Actions: Open conversation · Confirm / Change · Remove link.
 */
export function OrderFacebookLink({
  orderId,
  order,
  customer,
  onSaved,
}: {
  orderId: string;
  order: { conversationId: string | null; url: string | null; status: string | null };
  customer: { pancakeConversationId: string | null; facebookConversationUrl: string | null };
  onSaved: () => void;
}) {
  const hasOrderLink = Boolean(order.conversationId || order.url);
  // Effective link actually used by Send Invoice / Open FB Chat: order's own first.
  const effConv = order.conversationId ?? customer.pancakeConversationId;
  const effUrl = order.url ?? customer.facebookConversationUrl;
  const usingDefault = !hasOrderLink && Boolean(effConv || effUrl);

  const [editing, setEditing] = useState(false);
  const [conv, setConv] = useState(order.conversationId ?? customer.pancakeConversationId ?? '');
  const [url, setUrl] = useState(order.url ?? customer.facebookConversationUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await fn();
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? 'That could not be saved.');
      return;
    }
    setEditing(false);
    onSaved();
  };

  const openChat = () => {
    setNotice(null);
    if (effUrl) {
      window.open(effUrl, '_blank', 'noopener,noreferrer');
    } else {
      setNotice(
        'No open-link saved. Send Invoice can still deliver if a Pancake conversation is set.',
      );
    }
  };

  const stateLabel = hasOrderLink
    ? 'Confirmed for this order'
    : usingDefault
      ? "Using customer's default"
      : 'Not linked';
  const stateCls = hasOrderLink
    ? 'bg-green-600/15 text-green-700'
    : usingDefault
      ? 'bg-gold/20 text-gold-strong'
      : 'bg-muted text-muted-foreground';

  const shortConv = effConv ? `${effConv.slice(0, 22)}${effConv.length > 22 ? '…' : ''}` : null;

  return (
    <div
      className="space-y-2 rounded-md border border-border bg-card/40 p-2.5"
      data-testid="order-fb-link-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Linked Facebook Customer
        </p>
        <span
          className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase ${stateCls}`}
          data-testid="order-fb-link-state"
        >
          {stateLabel}
        </span>
      </div>

      {effConv || effUrl ? (
        <p className="break-all text-[11px] text-muted-foreground">
          {shortConv ? (
            <>
              Pancake: <span className="font-mono">{shortConv}</span>
            </>
          ) : (
            'No Pancake conversation'
          )}
          {effUrl ? ' · chat link saved' : ' · no chat link'}
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          No Facebook chat is linked — Send Invoice won&apos;t reach the customer until one
          is set.
        </p>
      )}

      {!editing ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={openChat}
            className="rounded-md border border-border px-2 py-1 text-[11px] font-medium hover:bg-accent"
            data-testid="order-fb-open"
          >
            💬 Open conversation
          </button>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setEditing(true);
            }}
            className="rounded-md border border-border px-2 py-1 text-[11px] font-medium hover:bg-accent"
            data-testid="order-fb-edit"
          >
            {hasOrderLink ? 'Change' : 'Confirm / Link'}
          </button>
          {hasOrderLink ? (
            <button
              type="button"
              onClick={() => void run(() => setOrderFacebookLinkAction(orderId, { conversationId: null, url: null }))}
              disabled={busy}
              className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-destructive hover:bg-accent disabled:opacity-60"
              data-testid="order-fb-remove"
            >
              Remove link
            </button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-1.5">
          <label className="block text-[10px] uppercase tracking-wide text-muted-foreground">
            Pancake conversation id (Integrations → Load conversations → Copy ID)
          </label>
          <input
            value={conv}
            onChange={(e) => setConv(e.target.value)}
            placeholder="e.g. 588622885161430_2825574771…"
            className="h-8 w-full rounded-md border border-border bg-background px-2 font-mono text-[11px] outline-none focus:border-gold"
            data-testid="order-fb-conv-input"
          />
          <label className="block text-[10px] uppercase tracking-wide text-muted-foreground">
            Messenger chat link (optional — for Open conversation)
          </label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://m.me/…"
            className="h-8 w-full rounded-md border border-border bg-background px-2 text-[11px] outline-none focus:border-gold"
            data-testid="order-fb-url-input"
          />
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() =>
                void run(() =>
                  setOrderFacebookLinkAction(orderId, {
                    conversationId: conv.trim() || null,
                    url: url.trim() || null,
                    method: 'manual',
                    confidence: 'confirmed',
                  }),
                )
              }
              disabled={busy}
              className="rounded-md bg-gold px-2.5 py-1 text-[11px] font-semibold text-black hover:bg-gold/90 disabled:opacity-60"
              data-testid="order-fb-save"
            >
              {busy ? 'Saving…' : 'Confirm & save to this order'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {notice ? <p className="text-[11px] text-muted-foreground">{notice}</p> : null}
      {error ? (
        <p role="alert" className="text-[11px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
