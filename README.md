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
| `npm test` | All Vitest projects: `unit`, `integration` and `api` |
| `npm run test:unit` | Unit tests only; no database needed |
| `npm run test:integration` | Database integration tests; local Supabase must be running |
| `npm run test:api` | API tests over HTTP; local Supabase must be running, and the tests build and start their own app |
| `npm run db:types` | Regenerate `lib/database.types.ts` from the local database |

## API

Five JSON endpoints. Every route checks the session and the role before it does anything, and queries run as the signed-in user, so row-level security applies to every request.

| Method | Path | Who | Does |
| --- | --- | --- | --- |
| GET | `/api/consultations` | Student | The caller's own consultations by consultation time, cancelled ones included |
| POST | `/api/consultations` | Student | Books `{ firstName, lastName, reason, scheduledAt }`; starts as `scheduled` |
| PATCH | `/api/consultations/:id` | Student | `{ completed: true \| false }` sets the target state; `{ scheduledAt }` reschedules |
| POST | `/api/consultations/:id/cancel` | Student | Cancels a scheduled booking; the row stays, marked cancelled |
| GET | `/api/admin/consultations?cursor=&limit=` | Admin | Every consultation, ordered by `(scheduledAt, id)`, 20 per page by default (at most 100) |

`scheduledAt` is an ISO 8601 time with an offset, such as `2026-11-23T10:00:00+11:00`, and must be in the future. Any `student_id` or `role` in a body is ignored: ownership comes from the session.

Success is `{ "data": ... }`; the admin list adds `"nextCursor"`, which is `null` on the last page. Failure is `{ "error": { "code", "message", "fields"? } }`. Every response sends `Cache-Control: private, no-store`.

| Status | When |
| --- | --- |
| 200 / 201 | Success / created |
| 400 | Invalid input, with field errors; a past time; a malformed body or cursor |
| 401 | Not signed in |
| 403 | A student on the admin route, or an admin on any student route |
| 404 | No such consultation, or someone else's |
| 409 | The same student already has a booking at that time |
| 422 | A change the current state does not allow, such as cancelling a completed booking |
| 500 | Unexpected error, with a generic message |

A repeat of `{ completed }` with the state the booking already has returns 200 and changes nothing. A second cancel returns 422, because cancel is an action, not a target state.

Errors are logged as one JSON line with the request ID, route, user ID and error class. Logs never hold the request body (it carries the consultation reason), cookies or tokens. The request ID is also returned in the `X-Request-Id` header.

```bash
# Signed out: the API answers 401 (pages redirect to the login screen instead)
curl -i http://localhost:3000/api/consultations
```

## Tests

| Suite | What it proves |
| --- | --- |
| `tests/integration/rls.test.ts` | A student reads and changes only their own rows; another student's row is left unchanged; the admin reads every row, including its own pre-promotion booking, and can write none; no one can change a role or `student_id` |
| `tests/integration/db-rules.test.ts` | Complete, mark incomplete, reschedule and cancel follow the state rules; a repeat complete changes nothing; past bookings can be completed but not moved to the past; rescheduling and cancelling free a time |
| `tests/integration/concurrency.test.ts` | The same booking sent twice at once leaves one active row; two students can book the same time |
| `tests/unit/*.test.ts` | zod schemas, the state rules, row-to-DTO mapping, the admin cursor, and error-to-status mapping |
| `tests/api/api.test.ts` | Every status code above over HTTP with real session cookies: 401 signed out, 403 for the wrong role, 404 for another student's booking, 409 for a double booking (also two identical requests at once: one 201, one 409), 422 for illegal changes; admin paging where two bookings at the same time land on different pages; one booking taken through book, complete, mark incomplete, reschedule and cancel |

Integration tests run against local Supabase, so run `npx supabase start` first. They create fresh users for each test and delete them afterwards, so they do not depend on the seed. The keys come from `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` if set, otherwise from `npx supabase status`. The secret key is used only by the tests, to create users; the app never uses it.

**API tests** run against a real Next.js server. Their global setup (`tests/api/global-setup.ts`):

1. builds the app into `.next-test` (not `.next`, so a running `npm run dev` is left alone),
2. starts it with `next start` on port 3100, passing it only the public Supabase URL and key,
3. waits until `GET /api/consultations` answers 401,
4. stops only that process when the tests finish.

Each test signs in with `@supabase/ssr` on an in-memory cookie store and sends those cookies with every request, as a student or as an admin. The same steps run locally and in CI.

```bash
npx supabase start             # once; the tests do not start Supabase
npm run test:api               # builds, starts the app on :3100, runs the tests, stops it
API_TEST_SKIP_BUILD=1 npm run test:api   # reuse the last build when only tests changed
API_TEST_PORT=3200 npm run test:api      # if port 3100 is taken
```

## Continuous integration

GitHub Actions (`.github/workflows/ci.yml`) runs on every push and pull request: install, lint, typecheck, start local Supabase, `db reset`, check the generated types, then all the tests, including the API tests against their own build of the app.
