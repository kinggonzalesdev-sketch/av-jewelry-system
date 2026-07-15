# Tests

## Layout

| Directory            | Scope                                                    | Status              |
| -------------------- | -------------------------------------------------------- | ------------------- |
| `tests/unit/`        | Unit + component tests (jsdom, Vitest)                   | **Active**          |
| `tests/integration/` | Integration tests against a real local Supabase instance | Reserved — Phase 1+ |
| `tests/e2e/`         | End-to-end browser tests                                 | Reserved — Phase 11 |

`tests/integration/` and `tests/e2e/` are excluded in `vitest.config.ts` until the
phases that own them land. Integration tests need a running local Supabase and a
schema; neither exists in Phase 0.

## Commands

```bash
npm test         # run once
npm run test:watch
```

## What Phase 0 tests cover

Foundation only — there is no business logic to test yet:

- environment validation, including failing safely without echoing values
- the protected-route authentication boundary
- the absence of public sign-up and customer login
- application-shell rendering and the five approved nav items
- the privileged-module server-only boundary
- placeholder pages displaying no fake operational data
- secrets/gitignore guards and the Phase 0 scope boundary

## What Phase 0 deliberately does NOT test

**No business-workflow tests exist**, because no business workflow exists. A test
asserting claim, reservation, order, or payment behaviour now would be testing a
fiction and would create the false impression that the workflow is implemented.

When those workflows arrive, their tests must cover the invariants directly:
reserve-exactly-once at Confirmed Claim, no second deduction at Official Order,
idempotent and safely retryable critical writes, non-delegable Owner approvals, and
unauthorized actions changing no record.

## Note on structural tests

Several guards assert facts about the source tree (for example, "no sign-up route
exists") rather than runtime behaviour. That is deliberate: absence is a property of
the repository, and a runtime test cannot prove it. They are intended to fail loudly
if a future change quietly crosses one of these boundaries.
