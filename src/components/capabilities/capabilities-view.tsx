'use client';

import { useActionState } from 'react';

import {
  EMPTY_CAPABILITY_STATE,
  recordValidationAction,
  setCapabilityAction,
  type CapabilityActionState,
} from '@/lib/capabilities/actions';
import type { CapabilityStatus } from '@/lib/capabilities/service';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Conditional capabilities (Bible §27, §14, §13, §26).
 *
 * The screen states the truth plainly: nothing here is implemented or
 * validated, everything is off, and every workflow has a manual fallback that
 * works today. Enabling requires evidence, and the database enforces that.
 */
export function CapabilitiesView({
  capabilities,
  isOwner,
}: {
  capabilities: CapabilityStatus[];
  isOwner: boolean;
}) {
  const [validateState, validate, validating] = useActionState<
    CapabilityActionState,
    FormData
  >(recordValidationAction, EMPTY_CAPABILITY_STATE);
  const [toggleState, toggle, toggling] = useActionState<CapabilityActionState, FormData>(
    setCapabilityAction,
    EMPTY_CAPABILITY_STATE,
  );

  const notices = [validateState, toggleState];

  return (
    <div className="space-y-4">
      <Card className="border-amber-500">
        <CardContent className="pt-6">
          <p className="text-sm font-semibold">No integration here has been validated</p>
          <p className="mt-1 text-sm text-muted-foreground">
            The Xprinter XP-236B, Pancake, Meta, and native capture are all unverified —
            no driver or adapter is implemented, and none has been tested against real
            hardware or a real vendor account. Every capability is off, and every workflow
            below has a manual fallback that works today. V1 launches on those fallbacks.
          </p>
        </CardContent>
      </Card>

      {notices.map((n, i) =>
        n.error ? (
          <p key={`e${i}`} role="alert" className="text-sm text-destructive">
            {n.error}
          </p>
        ) : null,
      )}
      {notices.map((n, i) =>
        n.success ? (
          <p key={`s${i}`} className="text-sm text-muted-foreground">
            {n.success}
          </p>
        ) : null,
      )}

      <ul className="space-y-2">
        {capabilities.map((c) => (
          <li key={c.key}>
            <Card>
              <CardContent className="space-y-2 pt-6">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{c.label}</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {c.key} · {c.bibleReference}
                    </p>
                  </div>
                  <span
                    className={
                      c.isEnabled
                        ? 'rounded-full border px-2 py-0.5 text-xs'
                        : 'rounded-full border border-amber-500 px-2 py-0.5 text-xs'
                    }
                  >
                    {c.isEnabled ? 'Enabled' : 'Off'}
                    {c.hasPassingValidation ? ' · validated' : ' · unvalidated'}
                  </span>
                </div>

                {!c.isEnabled ? (
                  <p className="rounded border px-2 py-1.5 text-xs text-muted-foreground">
                    {c.blockedReason}
                  </p>
                ) : null}

                <p className="text-xs">
                  <span className="text-muted-foreground">Manual fallback: </span>
                  <strong>{c.manualFallback}</strong>
                </p>

                {isOwner ? (
                  <div className="space-y-2 border-t pt-2">
                    <form action={validate} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="capabilityKey" value={c.key} />
                      <div>
                        <Label htmlFor={`dev-${c.key}`} className="text-xs">
                          Device or vendor tested
                        </Label>
                        <Input
                          id={`dev-${c.key}`}
                          name="deviceOrVendor"
                          required
                          placeholder="e.g. XP-236B s/n 12345, Android 14"
                          className="h-8 w-56"
                        />
                      </div>
                      <div>
                        <Label htmlFor={`ev-${c.key}`} className="text-xs">
                          Evidence
                        </Label>
                        <Input
                          id={`ev-${c.key}`}
                          name="evidenceNote"
                          required
                          placeholder="What did you observe?"
                          className="h-8 w-56"
                        />
                      </div>
                      <Button
                        type="submit"
                        name="outcome"
                        value="passed"
                        size="sm"
                        variant="outline"
                        disabled={validating}
                      >
                        Record Pass
                      </Button>
                      <Button
                        type="submit"
                        name="outcome"
                        value="failed"
                        size="sm"
                        variant="outline"
                        disabled={validating}
                      >
                        Record Fail
                      </Button>
                    </form>

                    <form action={toggle}>
                      <input type="hidden" name="capabilityKey" value={c.key} />
                      <input
                        type="hidden"
                        name="enabled"
                        value={c.isEnabled ? 'false' : 'true'}
                      />
                      <Button
                        type="submit"
                        size="sm"
                        variant={c.isEnabled ? 'destructive' : 'default'}
                        disabled={toggling}
                      >
                        {c.isEnabled ? 'Disable' : 'Enable'}
                      </Button>
                    </form>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Only the Owner may record a validation or change a capability.
                  </p>
                )}
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      <p className="text-xs text-muted-foreground">
        Recording evidence is not enabling — the two are separate, deliberate steps.
        Enabling without a passing real-device validation is refused by the database, not
        merely hidden here. Disabling is never gated: retreating to the manual fallback
        must always be easier than staying on an untested path.
      </p>
    </div>
  );
}
