# Respawn Cyber Gaming booking system

@AGENTS.md

The product spec is `docs/SPEC.md`. Read it before any work. It defines the booking rules, data model, routes and the eight build milestones. Work on one milestone per session and stop when its "done when" condition is met.

## Status

- [x] 1. Scaffold
- [x] 2. Booking engine
- [x] 3. Auth and email
- [x] 4. Public booking flow
- [ ] 5. Dashboard
- [ ] 6. LAN requests
- [ ] 7. Settings
- [ ] 8. Jobs and launch

Tick a milestone in the same PR that completes it.

## Code layout rules

- `src/lib/booking/` holds pure functions (slot math, rule validation). No database access, no `Date.now()` without an injected clock.
- `src/server/booking-service.ts` is the only code that writes `bookings` and `slotLocks`. Pages, server actions and route handlers call it; they never write those collections directly.
- `src/server/models/` holds the Mongoose schemas. Field names follow the data model in the spec exactly.
- Availability is read from `slotLocks` only, never from overlap queries on `bookings`.
- A slot lock exists only while its booking holds slots (`pending_approval`, `confirmed`, `checked_in`). Any status change away from those deletes the booking's locks in the same transaction.
- There is no override or force path around a slot conflict. Do not add one.
- All dates are stored in UTC and shown in the venue timezone from `settings`. Never rely on server local time.
- Every user-facing string goes through next-intl (`messages/fr.json`). No hard-coded copy in components.
- Validate every server input with zod. Read environment variables through `getEnv()` in `src/lib/env.ts`, at the point of use, never at module top level.
- UI components follow shadcn/ui conventions in `src/components/ui/`.
- All email goes through `notify()` in `src/server/email/notify.ts`. It never throws; a booking must not fail because its email did.
- Role checks happen on the server with `getCurrentUser()` from `src/server/session.ts`. `role`, `blocked` and `noShowCount` are never writable through the auth API.

## Commands

```bash
pnpm dev          # local dev server
pnpm lint         # eslint
pnpm typecheck    # tsc --noEmit
pnpm test         # unit tests (no database)
pnpm test:int     # integration tests on an in-memory MongoDB replica set
pnpm test:e2e     # Playwright on a phone viewport; needs `pnpm build` first
pnpm build        # seeds if MONGODB_URI is set, then production build
pnpm seed         # seed settings, stations and the owner (reads .env.local)
```

Before opening a PR, all of lint, typecheck, test, test:int, build and test:e2e must pass. The e2e run needs a MongoDB binary download, so it may only work in CI.

## Notes

- Next.js here has Cache Components enabled (`cacheComponents: true`). A page or `GET` route that reads the database must either cache the read with `"use cache"` or run at request time (inside `<Suspense>`, or after `await connection()` in a route handler). See the docs referenced in `AGENTS.md`.
- Integration tests need a replica set because the booking engine uses transactions. Use `MongoMemoryReplSet`, as in `src/server/seed.int.test.ts`.
