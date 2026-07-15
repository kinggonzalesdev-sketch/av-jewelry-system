# Domain modules

Reserved for future business-domain modules. **Empty by design in Phase 0.**

Phase 0 is the application foundation. No operational business module exists yet, and
none may be added here without its approved phase.

## Intended layout (Roadmap Phases 1–9)

Each module owns its own server actions, validation schemas, and tests, and stays
traceable to the Development Bible section that specifies it (Bible §33.16):

```
src/modules/<domain>/
  actions.ts      # server actions — authorize at execution time
  queries.ts      # server-side reads
  schema.ts       # zod validation
  components/     # domain UI
```

Anticipated domains, each gated behind its roadmap phase: customers, live batches,
items, claims, orders, payments, layaway, fulfillment, approvals, inventory,
reporting.

## Rules any module here must follow

These are not style preferences — they are the approved invariants:

- **`Development-Bible.md` is authoritative.** No module may silently redefine an
  approved business rule (Bible §33.2).
- **Authorization happens at the trusted server/data boundary.** UI visibility is not
  authorization; assignment is not permission; role title is not authority.
- **Permission, shop/page scope, record state, and Owner approval are revalidated at
  execution time** — not only at render time (Bible §29.8).
- **Inventory reserves exactly once at Confirmed Claim.** Official Order must **not**
  deduct again (Bible §19, §22.3).
- **Critical writes are atomic, idempotent, and safely retryable.** A retry must never
  duplicate claims, reservations, orders, payments, messages, releases, approvals, or
  stock returns (Bible §29.7–29.9).
- **The six Owner-approved actions are non-delegable**, and creating an approval
  request does not execute the action (Bible §5.13, §22.14).
- **Audit attribution cannot be erased**; unauthorized actions must change no record.
- **Manual claim entry and manual customer-message fallback always remain available.**
