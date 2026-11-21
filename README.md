# Mini-LMS

Students book and manage consultations; admins see every consultation, read-only. Built with Next.js 16 (App Router), TypeScript and Supabase (Postgres, Auth, row-level security).

> Work in progress. This README grows with each milestone.

## Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | 24 (see `.nvmrc`) | npm 11 comes with it |
| Container runtime | Docker Desktop or OrbStack | Must be running before `npx supabase start` |

Every package version, including the Supabase CLI, is pinned by `package-lock.json`. The CLI is a dev dependency, so there is nothing to install globally.

Versions used: Next.js 16.4.6, React 19, `@supabase/ssr` 0.12, `@supabase/supabase-js` 2.119, Supabase CLI 3.2, Postgres 17, zod 4, Vitest 5.

## Setup

```bash
npm install
npx supabase start          # first run downloads the Supabase images
npx supabase db reset       # applies migrations and the seed
cp .env.example .env.local  # then fill it in (see below)
npm run dev                 # http://localhost:3000
```

## Environment variables

| Variable | Where the value comes from | Exposed to the browser |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `npx supabase status`: Project URL (`http://127.0.0.1:54321`) | Yes |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `npx supabase status`: Publishable key | Yes |

To write `.env.local` in one step:

```bash
npx supabase status -o env \
  --override-name api.url=NEXT_PUBLIC_SUPABASE_URL \
  --override-name auth.publishable_key=NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
  | grep '^NEXT_PUBLIC_' > .env.local
```

`lib/env.ts` validates these with zod when the server starts. A missing or invalid value stops startup with a message that names the variable, for example:

```text
Invalid environment variables:
  - NEXT_PUBLIC_SUPABASE_URL: is missing
```

The local Supabase keys are fixed development values, not secrets. `.env.local` is git-ignored all the same.

## Accounts and email

Local sign-up does **not** need email confirmation (`enable_confirmations = false` in `supabase/config.toml`). After signing up at `/auth/sign-up` the account is signed in straight away, even though the page says to check your email. Emails the app does send (such as password resets) land in Mailpit at http://127.0.0.1:54324.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server on port 3000 |
| `npm run lint` | ESLint (Next.js core-web-vitals and TypeScript rules) |
| `npm run typecheck` | `tsc --noEmit`, strict mode |
| `npm test` | All Vitest projects: `unit` and `integration` |
| `npm run test:unit` | Unit tests only; no database needed |
| `npm run test:integration` | Integration tests; local Supabase must be running |

## Continuous integration

GitHub Actions (`.github/workflows/ci.yml`) runs on every push and pull request: install, lint, typecheck, start local Supabase, `db reset`, then the tests.
