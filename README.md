# Gaming café booking

Booking and management system for a gaming café: customers book PC stations, the PS5 or the whole venue for a LAN from live availability, and staff run every reservation from one calendar.

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

`GET /api/health` returns `{ "ok": true, "db": "up" }` when the app can reach MongoDB.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Local dev server |
| `pnpm build` | Production build |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript, no emit |
| `pnpm test` | Unit tests, no database |
| `pnpm test:int` | Integration tests on an in-memory MongoDB replica set |
| `pnpm seed` | Idempotent seed; never overwrites existing settings or stations |

## Deploying

Import the repo in Vercel and set the environment variables from `.env.example`. Run `pnpm seed` once against the production database.
