'use client';

import { useState } from 'react';

import { usePwa } from '@/components/pwa/pwa-provider';
import { Button } from '@/components/ui/button';

/**
 * Compact App Information (Owner 2026-09-05): mode, connectivity, public build id, update state.
 * Shows only public facts — never a secret, token, or project credential.
 */
export function AppInformation() {
  const {
    standalone,
    online,
    version,
    serviceWorker,
    updateReady,
    checkForUpdate,
    applyUpdate,
  } = usePwa();
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState<string | null>(null);

  const check = async () => {
    setChecking(true);
    await checkForUpdate();
    setChecking(false);
    setChecked(new Date().toLocaleTimeString());
  };

  const rows: Array<[string, string]> = [
    ['App', 'MineFlow'],
    ['Mode', standalone ? 'Installed app' : 'Browser'],
    ['Connection', online ? 'Online' : 'Offline'],
    ['Version', version],
    [
      'Updates',
      serviceWorker === 'unsupported'
        ? 'Not supported by this browser'
        : serviceWorker === 'unregistered'
          ? 'Not active (browser mode / development)'
          : updateReady
            ? 'Update available'
            : 'Up to date',
    ],
  ];

  return (
    <div className="space-y-3" data-testid="pwa-app-information">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd
              className="font-medium text-foreground"
              data-testid={`pwa-info-${k.toLowerCase()}`}
            >
              {v}
            </dd>
          </div>
        ))}
      </dl>
      {serviceWorker === 'registered' ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void check()}
            disabled={checking}
          >
            {checking ? 'Checking…' : 'Check for updates'}
          </Button>
          {updateReady ? (
            <Button
              type="button"
              size="sm"
              onClick={applyUpdate}
              data-testid="pwa-info-update-now"
            >
              Update now
            </Button>
          ) : null}
          {checked ? (
            <span className="text-xs text-muted-foreground">Checked {checked}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
