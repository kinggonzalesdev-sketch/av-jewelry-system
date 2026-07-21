'use client';

import { useActionState } from 'react';

import { testPancakeAction } from '@/lib/integrations/actions';
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
 * "connected". Pancake sync is gated on real API access the business provides;
 * the printer is gated on a real-device validation (see Capabilities).
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
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              <li>A Pancake plan with API access + a page access token.</li>
              <li>
                Set <code>PANCAKE_API_URL</code> and <code>PANCAKE_API_KEY</code> as
                server environment variables (secrets never reach the browser).
              </li>
              <li>
                Then buyers, conversations, orders, and mining can sync — no manual
                re-encoding.
              </li>
            </ul>
          </div>

          {canTest ? (
            <form action={testConnection} className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="outline" disabled={testing}>
                {testing ? 'Testing…' : 'Test connection'}
              </Button>
              {state.error ? (
                <span role="alert" className="text-sm text-destructive">
                  {state.error}
                </span>
              ) : null}
              {state.success ? (
                <span className="text-sm text-muted-foreground">{state.success}</span>
              ) : null}
            </form>
          ) : (
            <p className="text-xs text-muted-foreground">
              Only the Owner can test the connection.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            Bluetooth printer (XP-236B)
            <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              Gated
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Direct browser printing stays OFF until the real XP-236B passes a device
            validation (recorded at Capabilities). The status control in the shell never
            claims “Printer Ready” without it. See the hardware audit for the exact facts
            still required.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
