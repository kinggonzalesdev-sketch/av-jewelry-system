'use client';

import { useActionState } from 'react';

import { syncPancakeAction, testPancakeAction } from '@/lib/integrations/actions';
import {
  EMPTY_INTEGRATION_STATE,
  type IntegrationActionState,
} from '@/lib/integrations/action-state';
import type { PancakeStatus } from '@/lib/integrations/pancake';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * Integrations (Bible §14.28) — honest connection status. Never shows a false
 * "connected". Pancake sync is gated on real API access the business provides.
 */

const PANCAKE_LABEL: Record<PancakeStatus['state'], { text: string; tone: string }> = {
  not_configured: { text: 'Not Connected', tone: 'bg-muted text-muted-foreground' },
  configured_unverified: {
    text: 'Configured — Unverified',
    tone: 'bg-amber-100 text-amber-800',
  },
  connected: { text: 'Connected', tone: 'bg-gold/15 text-gold-strong' },
};

export function IntegrationsView({
  pancake,
  canTest,
}: {
  pancake: PancakeStatus;
  canTest: boolean;
}) {
  const [state, testConnection, testing] = useActionState<
    IntegrationActionState,
    FormData
  >(testPancakeAction, EMPTY_INTEGRATION_STATE);
  const [syncState, syncNow, syncing] = useActionState<IntegrationActionState, FormData>(
    syncPancakeAction,
    EMPTY_INTEGRATION_STATE,
  );

  const badge = PANCAKE_LABEL[pancake.state];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            Pancake / Facebook
            <span
              data-testid="pancake-status"
              className={cn('rounded-md px-2 py-0.5 text-[11px] font-medium', badge.tone)}
            >
              {badge.text}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{pancake.detail}</p>

          <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">To enable Pancake sync</p>
            <ol className="mt-1 list-inside list-decimal space-y-0.5">
              <li>In Pancake, connect your Facebook Page and generate a page Access Token.</li>
              <li>
                In Vercel → Settings → Environment Variables, set{' '}
                <code>PANCAKE_API_URL</code> (e.g.{' '}
                <code>https://pages.fm/api/public_api/v1</code>) and{' '}
                <code>PANCAKE_API_KEY</code> (your access token). Secrets never reach the
                browser.
              </li>
              <li>Redeploy, then use “Test connection” below.</li>
            </ol>
            <p className="mt-1">
              Uses the pages.fm <code>access_token</code> query auth. For Pancake POS or a
              different base, set <code>PANCAKE_VERIFY_PATH</code> too.
            </p>
          </div>

          {canTest ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <form action={testConnection}>
                  <Button type="submit" variant="outline" disabled={testing}>
                    {testing ? 'Testing…' : 'Test connection'}
                  </Button>
                </form>
                <form action={syncNow}>
                  <Button type="submit" variant="outline" disabled={syncing}>
                    {syncing ? 'Syncing…' : 'Sync now'}
                  </Button>
                </form>
              </div>
              {state.error ? (
                <p role="alert" className="text-sm text-destructive">
                  {state.error}
                </p>
              ) : null}
              {state.success ? (
                <p className="text-sm text-muted-foreground">{state.success}</p>
              ) : null}
              {syncState.error ? (
                <p role="alert" className="text-sm text-destructive">
                  {syncState.error}
                </p>
              ) : null}
              {syncState.success ? (
                <p className="text-sm text-muted-foreground">{syncState.success}</p>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Only the Owner can test the connection.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
