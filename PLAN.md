# Mini-LMS: Development Plan

Nov 21, 2026 · @Daniel

The plan builds the riskiest part first, and each milestone ends in a working, tested state with its own commits, built from the [design doc v3.1](https://claude.ai/artifact/JNptjRKAYmbSZHbxstqcGX). The deadline is Monday 23 Nov, 2:45pm, 48 hours after the email; the internal target is Monday noon. The README grows with each milestone, so M6 only re-runs it from a fresh clone and submits. This plan is final; from here, changes happen in the code.

## M1 Project setup

The template runs against local Supabase, with tooling and CI in place before any feature code. Design reference: [Technology stack and Project structure](https://claude.ai/artifact/JNptjRKAYmbSZHbxstqcGX).

- [ ] `npx create-next-app --example with-supabase mini-lms`; confirm Next.js 16, App Router, TypeScript strict
- [ ] `npm install supabase --save-dev`, `npx supabase init`, `npx supabase start` (OrbStack or Docker running)
- [ ] `.env.local` from `npx supabase status`; `lib/env.ts` validates it with zod; commit `.env.example`
- [ ] First real test: `env.test.ts` shows a missing variable gives a readable error (Vitest fails on an empty suite)
- [ ] Add zod, react-hook-form, `@tanstack/react-query`, shadcn/ui (button, table, dialog, form, badge, toast)
- [ ] Vitest with two projects (unit, integration); scripts `test`, `typecheck`, `lint`
- [ ] GitHub Actions: install, lint, typecheck, `supabase start`, `db reset`, test
- [ ] Sign up, log in and log out through the template; note whether local sign-up needs email confirmation in Mailpit
- [ ] README start: prerequisites, setup commands, environment variables

**Done when**: a new account can sign up, log in and log out locally, and `env.test.ts` passes locally and in CI.

**Commits**: `chore: scaffold from with-supabase template` · `chore: tooling, env validation and CI`

## M2 Database, RLS and database tests

The security model is built and proven first, because every later milestone depends on it. Design reference: Data model, Database migrations, Security and RBAC, Consultation states.

- [ ] Migration 1 `profiles_and_roles`: enum, `profiles`, `handle_new_user` trigger, `is_admin()`, RLS on `profiles`
- [ ] Migration 2 `consultations`: table with `student_id default auth.uid()`, checks, three indexes, `updated_at` trigger that fires only when a value changes
- [ ] Migration 3 `consultation_rules`: state trigger (legal changes only; future time on create or reschedule; sets `completed_at` / `cancelled_at`). Privileges in this order: revoke table-level insert and update from `authenticated`, then grant select on the table, then grant insert and update on the named columns
- [ ] Migration 4 `rls_policies`: student select own; insert and update need ownership and a non-admin role; admin select all
- [ ] `seed.sql`: students A and B with future bookings and one cancelled; an admin promoted from a student with a booking. Student A also gets a booking scheduled a few seconds after the database time at insertion: by review step 6 it is in the past and can be marked complete. All database triggers stay enabled, so every seeded row passes the normal rules
- [ ] `supabase gen types typescript --local > lib/database.types.ts`; CI regenerates to a temp file and fails if it differs
- [ ] `tests/integration/helpers.ts`: create users and sign in as a role (service role in tests only)
- [ ] `rls.test.ts`:
  - A can update A's booking; the same update on B's booking changes nothing (RLS affects 0 rows, no error), so assert B's row is unchanged
  - Admin sees A's, B's and its own pre-promotion bookings; an update to its own old row changes nothing
  - A student cannot change `profiles.role` or `student_id`
- [ ] `db-rules.test.ts`:
  - Complete, mark incomplete (`completed_at` back to `NULL`), reschedule, cancel; completing a cancelled row and rescheduling a completed row fail
  - A repeat `{ completed: true }` keeps both `completed_at` and `updated_at`; a second cancel fails
  - A booking created a few seconds ahead can be completed once that time has passed; moving it to another past time fails
  - Rescheduling frees the old time while the new one is active; cancelling frees that time
- [ ] `concurrency.test.ts`: the same student books the same time twice at once and one active row remains; two different students book the same time and both succeed
- [ ] README: seed accounts, their test passwords, `db reset` and type generation

**Done when**: `npx supabase db reset` runs clean from empty, including the seed; every policy, trigger and constraint has a passing allow test and deny test; the CI type check passes.

**Commits**: `feat(db): profiles and roles` · `feat(db): consultations schema` · `feat(db): state rules and grants` · `feat(db): RLS policies` · `test(db): RLS, rules and concurrency`

## M3 Services and API

All five endpoints work and return the designed status codes, before any UI exists. Design reference: API design, Code conventions, Consultation states.

- [ ] `lib/validation/consultation.ts`: zod schemas for create, reschedule and complete
- [ ] `lib/services/consultation-rules.ts`: pure state rules, with unit tests
- [ ] `lib/services/consultation-dto.ts`: student and admin DTOs, derived `status`, with unit tests
- [ ] `lib/api/errors.ts` + `with-auth.ts`: `withAuth`, `withStudent`, `withAdmin`; error mapping (400, 401, 403, 404, 409, 422, 500); logs without reason text or tokens
- [ ] `lib/services/consultations.ts` (`server-only`): list (filters by `student_id`), create, set completed (no write on a repeat), reschedule, cancel, admin list with cursor
- [ ] Five Route Handlers, each about five lines; `Cache-Control: private, no-store` on personal data
- [ ] API test harness: tests run against a real Next.js server over HTTP. A Vitest global setup builds the app, starts it on its own port (3100), waits until it is ready, and stops only that process at the end, so a reviewer's running npm run dev on port 3000 is untouched. The same path runs locally and in CI. In CI, the local Supabase URL and public key are set before the build; the secret key used to create test users goes only to the test process. Each test signs in with a `@supabase/ssr` client on an in-memory cookie store, then sends those cookies with every request, as a student or as the admin
- [ ] `api.test.ts`: the status matrix from Test coverage, including 403 for an admin on student routes, 422 for rescheduling a completed booking, and `nextCursor` paging with two bookings at the same time
- [ ] API concurrency: two identical booking requests at once return one 201 and one 409 (the database test already proves only one row is written)
- [ ] README: test commands, and that local Supabase must be running first; the tests start their own app

**Done when**: every row of the API column in Test coverage passes over HTTP, and one booking goes through book, complete, mark incomplete, reschedule and cancel with a student's cookies.

**Commits**: `feat(api): validation, rules and DTOs` · `feat(api): auth wrappers and error mapping` · `feat(api): consultation endpoints` · `feat(api): admin list with cursor` · `test(api): status codes and paging`

## M4 Student UI

A student can do everything in the brief from the dashboard, using only the API from M3. Design reference: Server and client boundary, Features.

- [ ] `providers.tsx`: Query client; clear it on sign-out or user ID change, not on token refresh
- [ ] `lib/queries/consultations.ts`: hooks with keys `['consultations', userId]`; typed fetch helpers in `lib/api/client.ts`
- [ ] `dashboard/page.tsx` as a Server Component: session and role check, redirect if wrong
- [ ] Header: reuse the template's auth button and logout, so the account switch can be tested in this milestone
- [ ] `consultation-table.tsx`: status badge; loading, empty and error states; only the actions the state allows
- [ ] Complete toggle with optimistic update, rollback on error, refetch when settled
- [ ] Booking, reschedule and cancel dialogs: react-hook-form + shared zod schema; `datetime-local` converted to ISO with offset; buttons disabled while pending; cancel asks to confirm
- [ ] `proxy.ts`: session refresh and page redirects only
- [ ] README: review path steps 2 to 8

**Done when**: review path steps 2 to 8 pass by hand in the browser, including the T1 / T2 order and completing the past booking.

**Commits**: `feat(ui): query provider and hooks` · `feat(ui): student dashboard` · `feat(ui): booking, reschedule and cancel dialogs`

## M5 Admin UI and hardening

The admin sees every booking read-only, and the cross-cutting checks are finished. Design reference: Features, Security and RBAC, Test coverage.

- [ ] `admin/page.tsx` as a Server Component with the admin check; students redirected away
- [ ] `admin-consultation-table.tsx`: student ID and name, status, no edit controls; a plain `Load more` button driven by `nextCursor`; key `['admin-consultations', userId, cursor]`
- [ ] Load more check: two bookings at the same time fall on different pages, and both appear in the UI
- [ ] Header: admin link shown only to admins
- [ ] Coverage gate in CI: 90% line and branch coverage for `lib/services` and `lib/validation`, v8 provider; fill the gaps
- [ ] Optional: Playwright `student-flow.spec.ts` and `account-switch.spec.ts`
- [ ] README: review path step 9 and the admin account

**Done when**: review path step 9 passes, including the admin's own old booking being read-only, and every test is green in CI.

**Commits**: `feat(ui): admin read-only list` · `test: coverage gaps` · `test(e2e): student flow and account switch` (if time allows)

## M6 README, fresh-clone check and submission

A reviewer can clone the repo and reproduce every promise from the README alone. Design reference: Review path, Assumptions, Future work.

- [ ] README: finish the review path, key decisions, assumptions and future work, cut down from the design doc; no internal revision history
- [ ] README: architecture as Mermaid, states as a three-row table; check both render on GitHub
- [ ] Replace every target with what was measured: test counts, coverage numbers, what E2E covers; list anything cut under future work
- [ ] Fresh clone in a new folder: follow the README word by word, fix anything that breaks, then add the fresh-clone note
- [ ] Check no secrets are committed: `.env.local` ignored, only local Supabase keys in docs
- [ ] Push and check CI is green
- [ ] Re-read the assessment email for the submission method (upload link or repo link), and check the reviewer can access what is submitted
- [ ] Submit by Monday 12:00

**Done when**: the fresh clone passes the review path end to end, the submission follows the method in the email, and a submission confirmation is received before the 2:45pm deadline.

**Commits**: `docs: README with review path` · `chore: fixes from fresh-clone check`

## Risks and cut list

Never cut: the security model, the state rules, the key business tests, the manual review path, the admin's ability to page through every booking, and a README that reproduces cleanly. Everything else can shrink if a milestone runs late.

| Risk | Early sign | Response |
| --- | --- | --- |
| Local Supabase will not start | `supabase start` fails or hangs in M1 | Switch to OrbStack, or skip unused services with `-x`; stop after 30 minutes and use a free hosted project for development only |
| Template and Next.js 16 do not match | Type or runtime errors in the template's auth | Pin a compatible Next.js 16 release and its dependencies, re-check sign-up, login and logout, and record the versions in the README |
| RLS tests are flaky | Tests pass alone but fail together | Fresh users per test, run integration tests one file at a time |
| UI takes longer than planned | M4 not done by Sunday evening | Cut from the list below, in order |

**Cut in this order if time runs short**

1. Playwright E2E: keep the manual review path instead
2. Coverage gate in CI: keep the coverage report and state the real numbers in the README
3. Optimistic update: use a plain refetch after each change

Each cut goes into the README's future work, so the reviewer sees it was a choice.
