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
type PancakeConv = {
  id: string;
  customerName: string | null;
  snippet: string | null;
  updatedAt?: string | null;
  avatar?: string | null;
};
type PancakeMsg = { id: string; fromPage: boolean; from: string | null; text: string | null; at: string | null };

function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

/** Loose name normalize for filtering (mirrors the SQL/auto-link normalizer). */
function norm(v: string): string {
  return v
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function OrderFacebookLink({
  orderId,
  order,
  customer,
  customerName,
  onSaved,
}: {
  orderId: string;
  order: { conversationId: string | null; url: string | null; status: string | null };
  customer: { pancakeConversationId: string | null; facebookConversationUrl: string | null };
  customerName?: string;
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

  // Pancake conversation SEARCH (§4). Loads the Page's conversations once (owner-gated,
  // server-side), then filters by name — pre-seeded with the customer's name.
  const [convs, setConvs] = useState<PancakeConv[] | null>(null);
  const [loadingConvs, setLoadingConvs] = useState(false);
  const [convError, setConvError] = useState<string | null>(null);
  const [convQuery, setConvQuery] = useState(customerName ?? '');

  const loadConvs = async () => {
    if (loadingConvs) return;
    setLoadingConvs(true);
    setConvError(null);
    try {
      const res = await fetch('/api/integrations/pancake/conversations', {
        headers: { accept: 'application/json' },
      });
      const body = (await res.json().catch(() => null)) as
        | { ok: boolean; message: string; conversations: PancakeConv[] }
        | null;
      if (!body) {
        setConvError('Pancake is unavailable right now. Try again, or paste the id.');
      } else if (body.ok) {
        setConvs(body.conversations);
      } else {
        setConvError(body.message);
      }
    } catch {
      setConvError('Pancake is unavailable right now. Try again, or paste the id.');
    } finally {
      setLoadingConvs(false);
    }
  };

  const filteredConvs = (() => {
    if (!convs) return [];
    const q = norm(convQuery);
    if (!q) return convs.slice(0, 20);
    return convs
      .filter((c) => {
        const n = norm(c.customerName ?? '');
        return n.includes(q) || q.includes(n) || c.id.includes(convQuery.trim());
      })
      .slice(0, 20);
  })();

  // View recent messages (§3) — reads the linked conversation's recent messages.
  const [messages, setMessages] = useState<PancakeMsg[] | null>(null);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [msgError, setMsgError] = useState<string | null>(null);

  const loadMessages = async () => {
    if (loadingMsgs) return;
    const id = (effConv ?? '').trim();
    if (!id) {
      setMsgError('No Pancake conversation is linked.');
      return;
    }
    setLoadingMsgs(true);
    setMsgError(null);
    try {
      const res = await fetch(
        `/api/integrations/pancake/messages?conversationId=${encodeURIComponent(id)}`,
        { headers: { accept: 'application/json' } },
      );
      const body = (await res.json().catch(() => null)) as
        | { ok: boolean; message?: string; messages?: PancakeMsg[] }
        | null;
      if (!body) setMsgError('Pancake is unavailable right now.');
      else if (body.ok) setMessages(body.messages ?? []);
      else setMsgError(body.message ?? 'Could not load messages.');
    } catch {
      setMsgError('Pancake is unavailable right now.');
    } finally {
      setLoadingMsgs(false);
    }
  };

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
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={openChat}
              className="rounded-md border border-border px-2 py-1 text-[11px] font-medium hover:bg-accent"
              data-testid="order-fb-open"
            >
              💬 Open conversation
            </button>
            {effConv ? (
              <button
                type="button"
                onClick={() => void loadMessages()}
                disabled={loadingMsgs}
                className="rounded-md border border-border px-2 py-1 text-[11px] font-medium hover:bg-accent disabled:opacity-60"
                data-testid="order-fb-view-messages"
              >
                {loadingMsgs ? 'Loading…' : '✉ View recent messages'}
              </button>
            ) : null}
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
          {msgError ? <p className="text-[10px] text-muted-foreground">{msgError}</p> : null}
          {messages ? (
            <ul
              className="max-h-40 space-y-1 overflow-auto rounded-md border border-border bg-background p-1.5"
              data-testid="order-fb-messages"
            >
              {messages.length === 0 ? (
                <li className="text-[11px] text-muted-foreground">No recent messages.</li>
              ) : (
                messages.map((m) => (
                  <li key={m.id} className={`text-[11px] ${m.fromPage ? 'text-right' : ''}`}>
                    <span className="font-medium">{m.fromPage ? 'You' : m.from ?? 'Customer'}:</span>{' '}
                    <span className="break-words">{m.text ?? '—'}</span>
                    {m.at ? (
                      <span className="block text-[9px] text-muted-foreground">{fmtWhen(m.at)}</span>
                    ) : null}
                  </li>
                ))
              )}
            </ul>
          ) : null}
        </div>
      ) : (
        <div className="space-y-1.5">
          {/* Search Pancake conversations by name (§4). Loads once, filters live. */}
          <div className="rounded-md border border-border bg-background p-1.5">
            <div className="flex items-center gap-1.5">
              <input
                value={convQuery}
                onChange={(e) => setConvQuery(e.target.value)}
                placeholder="Search Pancake by name…"
                className="h-8 flex-1 rounded-md border border-border bg-card px-2 text-[11px] outline-none focus:border-gold"
                data-testid="order-fb-search-input"
              />
              <button
                type="button"
                onClick={() => void loadConvs()}
                disabled={loadingConvs}
                className="rounded-md border border-border px-2 py-1 text-[11px] font-medium hover:bg-accent disabled:opacity-60"
                data-testid="order-fb-search"
              >
                {loadingConvs ? 'Loading…' : convs ? 'Reload' : '🔎 Search'}
              </button>
            </div>
            {convError ? (
              <p className="mt-1 text-[10px] text-muted-foreground">{convError}</p>
            ) : null}
            {convs ? (
              <ul
                className="mt-1 max-h-32 divide-y divide-border overflow-auto rounded border border-border"
                data-testid="order-fb-search-results"
              >
                {filteredConvs.length === 0 ? (
                  <li className="px-2 py-1.5 text-[11px] text-muted-foreground">No matches.</li>
                ) : (
                  filteredConvs.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setConv(c.id);
                          setNotice(`Selected ${c.customerName ?? 'conversation'} — Save to confirm.`);
                        }}
                        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11px] hover:bg-accent"
                        data-testid={`order-fb-pick-${c.id}`}
                      >
                        {c.avatar ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={c.avatar}
                            alt=""
                            className="h-6 w-6 shrink-0 rounded-full object-cover"
                          />
                        ) : (
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-bold text-muted-foreground">
                            {(c.customerName ?? '?').slice(0, 1).toUpperCase()}
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">{c.customerName ?? 'Unknown'}</span>
                          {c.snippet ? (
                            <span className="block truncate text-[10px] text-muted-foreground">
                              {c.snippet}
                            </span>
                          ) : null}
                          {c.updatedAt ? (
                            <span className="block text-[9px] text-muted-foreground">
                              Last: {fmtWhen(c.updatedAt)}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
          </div>

          <label className="block text-[10px] uppercase tracking-wide text-muted-foreground">
            Pancake conversation id (or search above / paste from Load conversations)
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
