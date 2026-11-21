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

## Database

The schema lives only in SQL migrations under `supabase/migrations`, applied in order:

| Migration | What it creates |
| --- | --- |
| `profiles_and_roles` | `app_role` enum, `profiles`, sign-up trigger that creates a `student` profile, `is_admin()`, RLS on `profiles` |
| `consultations` | `consultations` table, check constraints, the double-booking unique index, list indexes, `updated_at` trigger |
| `consultation_rules` | State trigger (legal changes only, future time on create or reschedule, completion and cancel times set by the database) and column-level grants |
| `rls_policies` | Students read and write their own rows; admins read all rows and write none |

```bash
npx supabase db reset   # drop the local database, apply every migration, then supabase/seed.sql
npm run db:types        # regenerate lib/database.types.ts after a schema change, and commit it
```

CI regenerates the types after `db reset` and fails if they differ from the committed `lib/database.types.ts`.

### Seed accounts

`supabase/seed.sql` creates three confirmed accounts for local use only. They share the test password `password123`.

| Email | Role | Bookings |
| --- | --- | --- |
| `student.a@example.com` | student | Three future bookings, plus one set a few seconds after the seed runs, so it is in the past by the time you log in and can be marked complete |
| `student.b@example.com` | student | One future booking and one cancelled booking |
| `admin@example.com` | admin | One booking made as a student before promotion; it is read-only now |

Admins are promoted only with SQL, never from the app:

```sql
update public.profiles set role = 'admin' where id = '<user id>';
```

Every trigger stays on while seeding, so each seeded row passed the same rules as the app. Run `npx supabase db reset` again for a fresh set of future bookings.

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
| `npm run db:types` | Regenerate `lib/database.types.ts` from the local database |

## Tests

| Suite | What it proves |
| --- | --- |
| `tests/integration/rls.test.ts` | A student reads and changes only their own rows; another student's row is left unchanged; the admin reads every row, including its own pre-promotion booking, and can write none; no one can change a role or `student_id` |
| `tests/integration/db-rules.test.ts` | Complete, mark incomplete, reschedule and cancel follow the state rules; a repeat complete changes nothing; past bookings can be completed but not moved to the past; rescheduling and cancelling free a time |
| `tests/integration/concurrency.test.ts` | The same booking sent twice at once leaves one active row; two students can book the same time |

Integration tests run against local Supabase, so run `npx supabase start` first. They create fresh users for each test and delete them afterwards, so they do not depend on the seed. The keys come from `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` if set, otherwise from `npx supabase status`. The secret key is used only by the tests, to create users; the app never uses it.

## Continuous integration

GitHub Actions (`.github/workflows/ci.yml`) runs on every push and pull request: install, lint, typecheck, start local Supabase, `db reset`, check the generated types, then the tests.
