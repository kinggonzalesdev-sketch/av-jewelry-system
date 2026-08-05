'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';

import {
  saveSelectedPageAction,
  sendPancakeTestAction,
  syncPancakeConversationsAction,
} from '@/lib/integrations/actions';
import {
  EMPTY_INTEGRATION_STATE,
  type IntegrationActionState,
} from '@/lib/integrations/action-state';
import type {
  LinkedPancakeCustomer,
  PancakePageInfo,
  SelectedPancakePage,
} from '@/lib/integrations/pancake';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * Integrations (Bible §14.28) — Pancake Page management.
 *
 * The Primary Super Admin loads the managed Pages the server-side User Access
 * Token can see, picks A.V. Jewelry, and saves the selected Page ID. The token
 * never reaches the browser — the page list comes from a server route that keeps
 * it server-side.
 */

type PagesResponse = {
  ok: boolean;
  code: string;
  message: string;
  pages: PancakePageInfo[];
};

export function IntegrationsView({
  canManagePages = false,
  selectedPage = null,
  linkStatus = null,
  linkedCustomers = [],
}: {
  /** Primary Super Admin — the only one who may load/select Pages. */
  canManagePages?: boolean;
  /** The currently-saved Page selection, if any. */
  selectedPage?: SelectedPancakePage | null;
  /** Persistent count of customers already linked to Pancake conversations. */
  linkStatus?: { linked: number; total: number } | null;
  /** The actual customers already linked — so the operator can see WHO is linked. */
  linkedCustomers?: LinkedPancakeCustomer[];
}) {
  return (
    <div className="space-y-4">
      {canManagePages ? (
        <>
          <ManagedPagesCard selectedPage={selectedPage} />
          <ConversationsCard linkStatus={linkStatus} linkedCustomers={linkedCustomers} />
          <TestSendCard />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Pancake Page management is available to the Primary Super Admin only.
        </p>
      )}
    </div>
  );
}

type Conversation = {
  id: string;
  customerName: string | null;
  snippet: string | null;
  updatedAt: string | null;
};

/**
 * Load Pancake Conversations — lists the selected Page's conversations with each
 * one's FB name, last message, and conversation ID (with Copy), so the operator
 * can find the conversation ID to use in a test send.
 */
function ConversationsCard({
  linkStatus,
  linkedCustomers = [],
}: {
  linkStatus?: { linked: number; total: number } | null;
  linkedCustomers?: LinkedPancakeCustomer[];
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [rows, setRows] = useState<Conversation[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  // "Who is linked" — a collapsible, searchable list of the customers already tied to
  // a Pancake conversation, so the operator sees exactly WHO is linked, not just a
  // count, and can copy a valid (page-scoped) conversation id to test a send.
  const [linkedOpen, setLinkedOpen] = useState(false);
  const [linkedQuery, setLinkedQuery] = useState('');
  const filteredLinked = useMemo(() => {
    const q = linkedQuery.trim().toLowerCase();
    if (!q) return linkedCustomers;
    return linkedCustomers.filter(
      (c) =>
        c.displayName.toLowerCase().includes(q) ||
        c.conversationId.toLowerCase().includes(q),
    );
  }, [linkedCustomers, linkedQuery]);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const [syncState, sync, syncing] = useActionState<IntegrationActionState, FormData>(
    syncPancakeConversationsAction,
    EMPTY_INTEGRATION_STATE,
  );

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (c) =>
        (c.customerName ?? '').toLowerCase().includes(q) ||
        (c.snippet ?? '').toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q),
    );
  }, [rows, query]);

  const load = async () => {
    setLoading(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch('/api/integrations/pancake/conversations', {
        headers: { accept: 'application/json' },
      });
      const body = (await res.json().catch(() => null)) as
        | { ok: boolean; message: string; conversations: Conversation[]; debug?: string | null }
        | null;
      if (!body) {
        setError('Pancake API unavailable. Please try again.');
        setRows([]);
      } else if (body.ok) {
        setRows(body.conversations);
        setNote(body.message);
        setQuery('');
        setOpen(false);
      } else {
        setRows([]);
        const detail = body.debug ? `\n\nPancake response: ${body.debug}` : '';
        setError(`${body.message}${detail}`);
      }
    } catch {
      setRows([]);
      setError('Pancake API unavailable. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const copy = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Pancake Conversations</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* PERSISTENT status — read from the database on every page load, so the
            operator can see the links are SAVED and never disappear. */}
        {linkStatus && linkStatus.total > 0 ? (
          <p
            className={cn(
              'rounded-lg border px-3 py-2 text-sm',
              linkStatus.linked > 0
                ? 'border-green-700/40 bg-green-700/10 text-green-700'
                : 'border-border text-muted-foreground',
            )}
            data-testid="pancake-link-status"
          >
            {linkStatus.linked > 0 ? (
              <>
                ✅ <strong>{linkStatus.linked} of {linkStatus.total}</strong> customers are linked
                to Pancake.
              </>
            ) : (
              <>
                No customers are linked yet. Click <strong>⚡ Auto-link</strong> once — the links are
                then saved and won&apos;t disappear.
              </>
            )}
          </p>
        ) : null}

        {/* WHO is linked — the actual customers, not just the count (Owner request).
            Collapsed by default; each row shows the name and its page-scoped
            conversation id with Copy, so it doubles as the list of valid ids to
            test-send against. */}
        {linkedCustomers.length > 0 ? (
          <div>
            <button
              type="button"
              onClick={() => setLinkedOpen((o) => !o)}
              aria-expanded={linkedOpen}
              className="flex w-full items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-left text-sm outline-none focus:border-gold"
              data-testid="pancake-linked-toggle"
            >
              <span className="text-muted-foreground">
                View linked customers ({linkedCustomers.length})
              </span>
              <span className="text-muted-foreground">{linkedOpen ? '▴' : '▾'}</span>
            </button>
            {linkedOpen ? (
              <div className="mt-1 overflow-hidden rounded-md border border-border bg-card">
                <div className="border-b border-border p-2">
                  <input
                    value={linkedQuery}
                    onChange={(e) => setLinkedQuery(e.target.value)}
                    placeholder="Search linked customers…"
                    className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-gold"
                    data-testid="pancake-linked-search"
                  />
                </div>
                <ul
                  className="max-h-64 divide-y divide-border overflow-auto"
                  data-testid="pancake-linked-list"
                >
                  {filteredLinked.length === 0 ? (
                    <li className="px-3 py-3 text-sm text-muted-foreground">No matches.</li>
                  ) : (
                    filteredLinked.map((c) => (
                      <li key={c.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{c.displayName}</p>
                          <p className="truncate font-mono text-[10px] text-muted-foreground">
                            {c.conversationId}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void copy(c.conversationId)}
                          className="shrink-0 rounded-md border border-border px-2 py-0.5 text-[11px] hover:bg-accent"
                          data-testid={`pancake-linked-copy-${c.id}`}
                        >
                          {copied === c.conversationId ? 'Copied' : 'Copy ID'}
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <form action={sync}>
            <Button type="submit" disabled={syncing} data-testid="pancake-sync-customers">
              {syncing ? 'Auto-linking…' : '⚡ Auto-link conversations to customers'}
            </Button>
          </form>
          <Button
            type="button"
            variant="outline"
            onClick={() => void load()}
            disabled={loading}
            data-testid="pancake-load-conversations"
          >
            {loading ? 'Loading…' : 'Load conversations'}
          </Button>
        </div>
        {syncState.error ? (
          <p role="alert" className="whitespace-pre-wrap break-words text-sm text-destructive">
            {syncState.error}
          </p>
        ) : null}
        {syncState.success ? (
          <p className="text-sm text-green-700" data-testid="pancake-sync-result">
            {syncState.success}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="whitespace-pre-wrap break-words text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
        {rows.length > 0 ? (
          <div ref={pickerRef} className="relative">
            {/* Collapsed trigger — opens a searchable dropdown instead of a long list. */}
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              className="flex w-full items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-left text-sm outline-none focus:border-gold"
              data-testid="pancake-conversations-toggle"
            >
              <span className="text-muted-foreground">
                {rows.length} conversation{rows.length === 1 ? '' : 's'} — click to search
              </span>
              <span className="text-muted-foreground">▾</span>
            </button>
            {open ? (
              <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-md border border-border bg-card shadow-lg">
                <div className="border-b border-border p-2">
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search by name, message, or ID…"
                    className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-gold"
                    data-testid="pancake-conversations-search"
                  />
                </div>
                <ul className="max-h-64 divide-y divide-border overflow-auto">
                  {filtered.length === 0 ? (
                    <li className="px-3 py-3 text-sm text-muted-foreground">No matches.</li>
                  ) : (
                    filtered.map((c) => (
                      <li key={c.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{c.customerName ?? 'Unknown'}</p>
                          {c.snippet ? (
                            <p className="truncate text-xs text-muted-foreground">{c.snippet}</p>
                          ) : null}
                          <p className="truncate font-mono text-[11px] text-muted-foreground">
                            {c.id}
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void copy(c.id)}
                        >
                          {copied === c.id ? 'Copied' : 'Copy ID'}
                        </Button>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * Test Pancake send — verify the send pipeline end-to-end from the browser (no
 * mobile app needed). Enter a REAL Pancake conversation id and a message; the
 * server sends it with the configured page/token. Never sends by Facebook name.
 */
function TestSendCard() {
  const [state, action, pending] = useActionState<IntegrationActionState, FormData>(
    sendPancakeTestAction,
    EMPTY_INTEGRATION_STATE,
  );

  const inputClass =
    'h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-gold';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Test Pancake send</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-sm text-muted-foreground">
          Verify the send works with a REAL Pancake conversation id (from your Pancake
          inbox). This sends an actual message — use your own test conversation.
        </p>
        <form action={action} className="space-y-2">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Conversation ID
            </span>
            <input
              name="conversationId"
              required
              placeholder="e.g. the Pancake conversation id"
              className={inputClass}
              data-testid="pancake-test-conversation"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Message
            </span>
            <input
              name="message"
              defaultValue="MineFlow test message ✅"
              className={inputClass}
              data-testid="pancake-test-message"
            />
          </label>
          <Button type="submit" disabled={pending} data-testid="pancake-test-send">
            {pending ? 'Sending…' : 'Send test message'}
          </Button>
        </form>
        {state.error ? (
          <p
            role="alert"
            className="mt-2 whitespace-pre-wrap break-words text-sm text-destructive"
          >
            {state.error}
          </p>
        ) : null}
        {state.success ? (
          <p
            className="mt-2 whitespace-pre-wrap break-words text-sm text-green-700"
            data-testid="pancake-test-result"
          >
            {state.success}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ManagedPagesCard({
  selectedPage,
}: {
  selectedPage: SelectedPancakePage | null;
}) {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadNote, setLoadNote] = useState<string | null>(null);
  const [pages, setPages] = useState<PancakePageInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string>(selectedPage?.pageId ?? '');
  const [copied, setCopied] = useState(false);

  const [saveState, saveSelected, saving] = useActionState<
    IntegrationActionState,
    FormData
  >(saveSelectedPageAction, EMPTY_INTEGRATION_STATE);

  const chosen = pages.find((p) => p.id === selectedId) ?? null;

  const loadPages = async () => {
    setLoading(true);
    setLoadError(null);
    setLoadNote(null);
    setCopied(false);
    try {
      const res = await fetch('/api/integrations/pancake/pages', {
        headers: { accept: 'application/json' },
      });
      const body = (await res.json().catch(() => null)) as PagesResponse | null;
      if (!body) {
        setLoadError('Pancake API unavailable. Please try again in a moment.');
        setPages([]);
        return;
      }
      if (body.ok) {
        setPages(body.pages);
        setLoadNote(body.message);
        // Keep a prior saved choice selected if it is still present.
        if (!body.pages.some((p) => p.id === selectedId)) {
          setSelectedId(body.pages[0]?.id ?? '');
        }
      } else {
        setPages([]);
        setLoadError(body.message);
      }
    } catch {
      setPages([]);
      setLoadError('Pancake API unavailable. Please try again in a moment.');
    } finally {
      setLoading(false);
    }
  };

  const copyPageId = async () => {
    if (!selectedId) return;
    try {
      await navigator.clipboard.writeText(selectedId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Managed Pages</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Load the Facebook / Instagram Pages your Pancake User Access Token manages,
          then select <strong>A.V. Jewelry</strong> as the Page this system posts as.
          The token stays on the server — it is never sent to your browser.
        </p>

        {selectedPage ? (
          <div
            className="rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-xs"
            data-testid="pancake-selected-page"
          >
            <p className="font-medium text-foreground">
              Currently selected: {selectedPage.pageName ?? 'Page'} ({selectedPage.pageId})
            </p>
            {selectedPage.selectedByName || selectedPage.selectedAt ? (
              <p className="mt-0.5 text-muted-foreground">
                Selected
                {selectedPage.selectedByName ? ` by ${selectedPage.selectedByName}` : ''}
                {selectedPage.selectedAt
                  ? ` on ${new Date(selectedPage.selectedAt).toLocaleString()}`
                  : ''}
                .
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => void loadPages()}
            disabled={loading}
            data-testid="pancake-load-pages"
          >
            {loading ? 'Loading…' : 'Load Pancake Pages'}
          </Button>
        </div>

        {loadError ? (
          <p role="alert" className="text-sm text-destructive" data-testid="pancake-load-error">
            {loadError}
          </p>
        ) : null}
        {loadNote ? (
          <p className="text-sm text-muted-foreground" data-testid="pancake-load-note">
            {loadNote}
          </p>
        ) : null}

        {pages.length > 0 ? (
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Select Page
              </span>
              <select
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-gold"
                value={selectedId}
                onChange={(e) => {
                  setSelectedId(e.target.value);
                  setCopied(false);
                }}
                data-testid="pancake-page-select"
              >
                {pages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.id}
                    {p.platform ? ` (${p.platform})` : ''}
                    {p.connected === false ? ' · disconnected' : ''}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Selected Page ID
              </span>
              <div className="flex items-center gap-2">
                <input
                  className="h-10 w-full rounded-lg border border-border bg-muted/40 px-3 text-sm tabular-nums outline-none"
                  value={selectedId}
                  readOnly
                  data-testid="pancake-page-id"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void copyPageId()}
                  disabled={!selectedId}
                  data-testid="pancake-copy-page-id"
                >
                  {copied ? 'Copied' : 'Copy Page ID'}
                </Button>
              </div>
            </label>

            <form action={saveSelected}>
              <input type="hidden" name="pageId" value={selectedId} />
              <input type="hidden" name="pageName" value={chosen?.name ?? ''} />
              <input type="hidden" name="platform" value={chosen?.platform ?? ''} />
              <Button
                type="submit"
                disabled={saving || !selectedId}
                data-testid="pancake-save-page"
              >
                {saving ? 'Saving…' : 'Save Selected Page'}
              </Button>
            </form>
          </div>
        ) : null}

        {saveState.error ? (
          <p role="alert" className="text-sm text-destructive">
            {saveState.error}
          </p>
        ) : null}
        {saveState.success ? (
          <p
            className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-foreground"
            data-testid="pancake-save-note"
          >
            {saveState.success}
          </p>
        ) : null}

        <p className="text-[11px] text-muted-foreground">
          Security: the request runs server-side only, the User Access Token is never
          returned or logged, and only the Primary Super Admin can load or select Pages.
        </p>
      </CardContent>
    </Card>
  );
}
