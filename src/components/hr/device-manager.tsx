'use client';

import { useActionState, useEffect, useRef, useState } from 'react';

import { registerDeviceAction, revokeDeviceAction } from '@/lib/hr/actions';
import { EMPTY_HR_STATE, type HrActionState } from '@/lib/hr/action-state';
import type { DeviceRow } from '@/lib/hr/devices';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { cn } from '@/lib/utils';

/**
 * Owner-only: register THIS phone as the approved shop device, and manage the
 * roster. Registering sets a server-side httpOnly cookie on this device — the raw
 * token is never in localStorage and never readable by JS. Only the active device
 * may clock in/out; everything else is refused and logged.
 */
export function DeviceManager({
  devices,
  thisApproved,
}: {
  devices: DeviceRow[];
  thisApproved: boolean;
}) {
  const [regState, register, registering] = useActionState<HrActionState, FormData>(
    registerDeviceAction,
    EMPTY_HR_STATE,
  );
  const [revState, revoke, revoking] = useActionState<HrActionState, FormData>(
    revokeDeviceAction,
    EMPTY_HR_STATE,
  );

  const notice = regState.error ?? revState.error ?? regState.success ?? revState.success;
  const isError = Boolean(regState.error ?? revState.error);
  const active = devices.filter((d) => d.isActive);

  const [showRegister, setShowRegister] = useState(false);
  // The roster + revoke controls collapse behind "Manage" so the device area is a compact
  // banner by default (Owner 2026-09-06) instead of a tall card. All the device-security
  // logic is unchanged — only the chrome is smaller.
  const [showManage, setShowManage] = useState(false);
  // Close the register dialog once registration succeeds (once per new success).
  const lastReg = useRef<string | null>(null);
  useEffect(() => {
    if (regState.success && regState.success !== lastReg.current) {
      lastReg.current = regState.success;
      setShowRegister(false);
    }
  }, [regState.success]);

  return (
    <div className="space-y-2">
      {/* Compact status banner: a coloured dot + one line + the primary action inline. */}
      <div
        className={cn(
          'flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm',
          thisApproved ? 'border-gold/40 bg-gold/10' : 'border-border bg-secondary/40',
        )}
        data-testid="this-device-status"
      >
        <span
          aria-hidden="true"
          className={cn(
            'h-2 w-2 shrink-0 rounded-full',
            thisApproved ? 'bg-gold' : 'bg-muted-foreground',
          )}
        />
        <span className="min-w-0 flex-1 truncate font-medium">
          {thisApproved ? 'Approved shop phone' : 'Shop phone not registered'}
        </span>
        {thisApproved ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setShowManage((s) => !s)}
            data-testid="device-manage-toggle"
            aria-expanded={showManage}
          >
            {showManage ? 'Hide' : 'Manage'}
          </Button>
        ) : (
          <Button type="button" size="sm" onClick={() => setShowRegister(true)}>
            Register this device
          </Button>
        )}
      </div>

      {notice ? (
        <p
          role="status"
          className={cn(
            'px-1 text-xs',
            isError ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {notice}
        </p>
      ) : null}

      {/* Roster + a second Register entry, revealed on demand for an approved device. */}
      {showManage ? (
        <Card>
          <CardContent className="space-y-3 pt-4">
            <div>
              <Button type="button" size="sm" onClick={() => setShowRegister(true)}>
                ＋ Register this device
              </Button>
            </div>
            {active.length > 0 ? (
              <div className="rounded-lg border border-border">
                <p className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Registered device(s)
                </p>
                <ul className="divide-y divide-border">
                  {active.map((d) => (
                    <li
                      key={d.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                    >
                      <span>
                        <span className="font-medium">{d.label}</span>{' '}
                        <span className="text-xs text-muted-foreground">
                          · registered{' '}
                          {new Date(d.createdAt).toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                          })}
                        </span>
                      </span>
                      <form action={revoke}>
                        <input type="hidden" name="deviceId" value={d.id} />
                        <Button
                          type="submit"
                          size="sm"
                          variant="destructive"
                          disabled={revoking}
                        >
                          Revoke
                        </Button>
                      </form>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Register this device — standard centered dialog. */}
      <Modal
        open={showRegister}
        onClose={() => setShowRegister(false)}
        title="Register this device"
        description="Makes THIS phone the approved shop device and deactivates any previous one."
        size="sm"
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowRegister(false)}
            >
              Cancel
            </Button>
            <Button type="submit" form="register-device-form" disabled={registering}>
              {registering ? 'Registering…' : 'Register this device'}
            </Button>
          </>
        }
      >
        <form id="register-device-form" action={register} className="space-y-3">
          <div className="max-w-sm">
            <Label htmlFor="device-label" className="text-xs">
              Device label
            </Label>
            <Input
              id="device-label"
              name="label"
              placeholder="Shop phone"
              className="mt-1 h-9"
            />
          </div>
          {regState.error ? (
            <p role="alert" className="text-sm text-destructive">
              {regState.error}
            </p>
          ) : null}
        </form>
      </Modal>
    </div>
  );
}
