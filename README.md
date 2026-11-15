# Respawn Cyber Gaming booking

Booking and management system for Respawn Cyber Gaming, a gaming café in Dar El Beïda, Algiers: customers book PC stations, the PS5 or the whole venue for a LAN from live availability, and staff run every reservation from one calendar.

The full product spec is in [`docs/SPEC.md`](docs/SPEC.md).

## Stack

Next.js (App Router) on Vercel, MongoDB Atlas with Mongoose, Tailwind CSS with shadcn/ui, next-intl (French first), zod, Vitest.

## Getting started

Requires Node 22 and pnpm.

```bash
pnpm install
cp .env.example .env.local   # then fill in MONGODB_URI and OWNER_EMAIL
pnpm seed                    # creates settings, 10 PCs, the PS5 and the owner account
pnpm dev                     # http://localhost:3000
```

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Local dev server |
| `pnpm build` | Seeds if `MONGODB_URI` is set, then builds |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript, no emit |
| `pnpm test` | Unit tests, no database |
| `pnpm test:int` | Integration tests on an in-memory MongoDB replica set |
| `pnpm seed` | Idempotent seed; never overwrites existing settings or stations |

## Deploying

Every push to `main` deploys to Vercel. The build runs the seed first whenever `MONGODB_URI` is set, so a new database is populated by its first deploy; the seed never overwrites existing settings or stations.

`GET /api/health` returns `{ "ok": true, "db": "up", "seeded": true }` when the app can reach MongoDB and the seed has run.

The Atlas cluster must accept connections from Vercel: in Atlas, Network Access, allow `0.0.0.0/0`.
