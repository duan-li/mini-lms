# Mini-LMS: Technical Design and Stack Decisions

Nov 21, 2026 · @Daniel

## Overview

The mini-LMS is a Next.js and Supabase app where students book and manage consultations, and admins see every consultation in read-only mode. Security sits in two layers: the API checks every request, and Postgres row-level security (RLS) is the final guard.

| Role | Can do |
| --- | --- |
| Student | Sign up, log in, log out; list own consultations; book; mark complete or incomplete; reschedule; cancel |
| Admin | See all consultations across the system, read-only |

The assessment grades five things: how the task is built, how it scales, best practice, security, and consistent choices. Every decision below maps to at least one of them. The brief puts more weight on functionality than on visual styling, so the UI uses shadcn/ui.

## Features (planned)

Every feature in the brief is planned, and each one will be enforced in the API and again in the database. At submission this table becomes the list of what was actually delivered.

| Feature | UI | API | Enforced in the database by |
| --- | --- | --- | --- |
| Sign up, log in, log out | `/auth/*` pages from the template, logout in the header | Supabase Auth (template flow kept as is) | Supabase Auth; `profiles` row created by trigger with role `student` |
| List own consultations | `/dashboard` table, sorted by consultation time, status badge | `GET /api/consultations` | RLS: select own rows only; full index `(student_id, scheduled_at, id)` |
| Mark complete or incomplete | Toggle on scheduled and completed rows, optimistic update | `PATCH /api/consultations/:id` `{ completed }` | Trigger: only `scheduled` to `completed` and back, past bookings included; the time is set by the database |
| Book a consultation (first name, last name, reason, date and time) | Booking dialog, react-hook-form + zod | `POST /api/consultations` | Column grants limit insert fields; `student_id` set by a database default; trigger rejects past times; unique index blocks double booking |
| Reschedule | Date and time dialog, scheduled rows only | `PATCH /api/consultations/:id` `{ scheduledAt }` | Trigger: only from `scheduled`, future time only |
| Cancel | Confirm dialog, scheduled rows only | `POST /api/consultations/:id/cancel` | Trigger: only from `scheduled`; sets `cancelled_at` (soft) |
| Admin view of all consultations, read-only | `/admin` table with student ID and name, cursor pagination | `GET /api/admin/consultations` | RLS: admin select on all rows; every write policy requires a non-admin |
| Roles | Admin link shown only to admins | `withStudent` on all student routes, reads included (an admin gets 403); `withAdmin` on admin routes | `profiles.role`, `is_admin()`, no user update on `profiles` |
| README | Setup, review path, assumptions, decisions, future work |  |  |
| Migrations and schema | `supabase/migrations` + `seed.sql` |  | Rebuilt with `supabase db reset` |

## Review path

The README opens with a five-minute path, so a reviewer sees every feature working before reading any design. The seed gives student A and student B bookings, including a cancelled one and one in the past, and an admin account that booked as a student before it was promoted.

1. `npm install`, `npx supabase start`, `npx supabase db reset` (migrations + seed), copy `.env.example` to `.env.local` with values from `npx supabase status`, then `npm run dev`.
2. Sign up a new account at `/auth/sign-up` (confirm in Mailpit if asked). It lands on an empty student dashboard.
3. Log in as student A. Book time T1. Mark it complete, then mark it incomplete.
4. Reschedule it from T1 to T2. While T2 is still active, book T1 again: it succeeds, so rescheduling freed T1.
5. Cancel the T2 booking, then book T2 again: it succeeds, so cancelling freed T2. The cancelled row stays visible.
6. Mark A's past booking from the seed complete: past bookings can still be completed.
7. Log out. Protected pages redirect to login, and the API returns 401.
8. Log in as student B in the same browser. None of A's bookings appear, not even while the page loads.
9. Log in as the admin. All of A's and B's bookings appear, including cancelled ones, with no edit controls. The admin's own earlier booking is read-only too.
10. `npm test` runs the unit and integration tests.

**The README also states**

- Node.js version, container runtime (Docker Desktop or OrbStack), and that versions are pinned by the lockfile.
- Every environment variable and where its value comes from.
- Whether local sign-up needs email confirmation, and how to confirm in Mailpit at `http://127.0.0.1:54324`.
- The seed accounts and their local test passwords.
- A note that the steps above were checked from a fresh clone, added only after that check is done.

## Architecture

The app is MVC with a service layer: Route Handlers are the controllers, the service layer holds the rules, and Postgres enforces access no matter how it is reached.

&#91;embedded content: request flow · 4 layers, 2 checks\]

proxy.ts only shapes the page experience. Access is decided in the Route Handler and again by RLS, so a missed check in one layer is caught by the other.

The README carries this diagram as a Mermaid block, and the state diagram as a three-row table, so both survive on GitHub and in a Markdown export.

## Server and client boundary

Pages are Server Components that check the session and role before anything renders; the interactive parts are Client Components that call the Route Handlers.

| Part | Runs on | Why |
| --- | --- | --- |
| `dashboard/page.tsx`, `admin/page.tsx` | Server | Verify the user and role, redirect if wrong, render the layout |
| Consultation table, dialogs, forms | Client (`'use client'`) | Interaction, optimistic updates, form state |
| Reads and writes from the browser | Route Handlers | The brief prefers APIs; one path for every change |
| Optional first-screen data | Server, via the service layer | If added, the page calls the service directly, never its own `/api` over HTTP |

**Account switching in one browser**

On a shared family or school computer, student B must never see student A's data, even for a moment while loading.

- Every query key includes the user ID. The student list uses `['consultations', userId]`; the admin list uses `['admin-consultations', userId, cursor]`.
- On sign-out, or when the signed-in user ID changes, the client calls `queryClient.clear()`.
- A token refresh for the same user keeps the cache, so the list does not reload for no reason.
- API responses with personal data send `Cache-Control: private, no-store`.

**Optimistic updates**

- The complete toggle updates the row at once and keeps a snapshot.
- On error, it restores the snapshot and shows the API's message.
- After success or failure, the list is refetched, so the server's state always wins.

## Project structure

The folders follow the layers in the diagram: `app/api` for controllers, `lib/services` for rules, `supabase/` for the database, and `tests/` split by test level.

```text
mini-lms/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                        # redirects to /dashboard or /auth/login
│   ├── providers.tsx                   # TanStack Query provider, clears cache on sign-out or user change
│   ├── auth/                           # from template: login, sign-up, confirm, error
│   ├── dashboard/page.tsx              # Server Component: session check, student layout
│   ├── admin/page.tsx                  # Server Component: admin check, read-only layout
│   └── api/
│       ├── consultations/
│       │   ├── route.ts                # GET list, POST create
│       │   └── [id]/
│       │       ├── route.ts            # PATCH reschedule or complete
│       │       └── cancel/route.ts     # POST cancel
│       └── admin/consultations/route.ts  # GET all, cursor-paginated
├── components/
│   ├── ui/                             # shadcn/ui
│   ├── consultations/                  # Client Components
│   │   ├── consultation-table.tsx
│   │   ├── booking-dialog.tsx
│   │   ├── reschedule-dialog.tsx
│   │   └── cancel-dialog.tsx
│   └── admin/admin-consultation-table.tsx
├── lib/
│   ├── api/
│   │   ├── with-auth.ts                # withAuth, withStudent, withAdmin, error mapping
│   │   ├── errors.ts                   # NotFound, Conflict, InvalidState → HTTP codes
│   │   └── client.ts                   # typed fetch helpers for the UI
│   ├── services/
│   │   ├── consultations.ts            # use cases, server-only
│   │   ├── consultation-rules.ts       # pure state rules (scheduled, completed, cancelled)
│   │   └── consultation-dto.ts         # row → DTO mappers
│   ├── validation/consultation.ts      # zod schemas, shared by form and API
│   ├── queries/consultations.ts        # TanStack Query hooks, keys include user ID
│   ├── supabase/
│   │   ├── client.ts                   # browser client (template)
│   │   ├── server.ts                   # session client (template)
│   │   └── proxy.ts                    # session refresh helper (template)
│   ├── database.types.ts               # generated by supabase gen types
│   └── env.ts                          # zod-validated environment variables
├── proxy.ts                            # Next.js 16: session refresh + page redirects
├── supabase/
│   ├── config.toml
│   ├── migrations/
│   │   ├── 20261121090000_profiles_and_roles.sql
│   │   ├── 20261121090100_consultations.sql
│   │   ├── 20261121090200_consultation_rules.sql
│   │   └── 20261121090300_rls_policies.sql
│   └── seed.sql                        # students A and B with bookings, admin promoted from a student
├── tests/
│   ├── unit/
│   │   ├── validation.test.ts
│   │   ├── consultation-rules.test.ts
│   │   └── consultation-dto.test.ts
│   ├── integration/
│   │   ├── helpers.ts                  # create users, sign in as a role
│   │   ├── rls.test.ts
│   │   ├── db-rules.test.ts
│   │   ├── concurrency.test.ts         # two bookings at once: one 201, one 409
│   │   └── api.test.ts
│   └── e2e/
│       ├── student-flow.spec.ts        # Playwright, optional
│       └── account-switch.spec.ts      # Playwright, optional
├── .github/workflows/ci.yml
├── .env.example
├── package-lock.json                   # pins every version
├── vitest.config.ts
├── playwright.config.ts
└── README.md                           # review path first, then setup and decisions
```

| Folder | Layer |
| --- | --- |
| `app/` pages + `components/` | View |
| `app/api/` | Controller (thin Route Handlers) |
| `lib/services/` | Service layer (Data Access Layer) |
| `lib/api/`, `lib/validation/` | Shared HTTP and validation helpers |
| `supabase/` | Model: schema, RLS, triggers, seed |
| `tests/` | Unit, integration, E2E |

`consultation-rules.ts` holds the state rules as pure functions, so they are unit-tested without a database. The same rules are enforced again by the trigger.

## Technology stack

The required stack is kept as given, and only small, well-known packages are added where they remove real work. The lockfile pins every version, and the README names the versions actually used.

| Layer | Choice | Required or added | Why |
| --- | --- | --- | --- |
| Framework | Next.js 16, App Router (proxy.ts) | Required | Full-stack in one app: UI, API routes and auth in one place |
| Language | TypeScript, strict mode | Required | Types from the database through the API to the UI |
| Database | Supabase Postgres | Required | Postgres with RLS, migrations and local dev via the Supabase CLI |
| Data access | @supabase/supabase-js + @supabase/ssr | Required | Queries run as the signed-in user, so RLS always applies |
| Auth | Supabase Auth | Required (via template) | Cookie sessions that work in Route Handlers |
| Validation | zod | Added | One schema for the form and the API |
| Forms | react-hook-form + zodResolver | Added | Form state and errors with the same zod schema |
| Client data | TanStack Query | Added | Caching, refetch after changes, optimistic updates |
| UI | shadcn/ui + Tailwind | Added | Accessible components without custom CSS |
| DB types | supabase gen types | Added (CLI) | Generated TypeScript types, no `any` |
| Tests | Vitest | Added | Unit tests and RLS integration tests |
| E2E (optional) | Playwright | Added | One main student flow, if time allows |
| CI | GitHub Actions | Added | Lint, typecheck and tests on every push |

## Key decisions

Each decision records the choice, why it was made, and what it costs. The common thread: use what the required stack already gives, and add a layer only when it pays for itself.

| # | Decision | Why | Trade-off |
| --- | --- | --- | --- |
| 1 | Next.js full-stack with Route Handlers, not a separate Express API | Required stack; auth cookies from @supabase/ssr work directly; one deploy, one set of types. | Heavy background work would later need its own service. The service layer makes that move easy. |
| 2 | Route Handlers (APIs), not Server Actions | The brief prefers APIs. One way to read and write keeps choices consistent. | Slightly more code than Server Actions for simple forms. |
| 3 | supabase-js, not an ORM | Required stack. supabase-js queries as the signed-in user, so Postgres applies that user's RLS policies. | Less expressive than an ORM for complex queries; those would become Postgres functions called with `rpc()`. |
| 4 | Thin Route Handlers + a service layer | Handlers only do HTTP: auth, parse, call the service, return a response. Rules live in the service, so they are easy to test and reuse. | One more file per feature. |
| 5 | Service layer follows the Next.js Data Access Layer pattern | It is `server-only`, checks access, and returns small DTOs, as the Next.js data security guide recommends. | None at this size. |
| 6 | No separate repository layer | supabase-js already abstracts data access. Another layer would only forward calls. | Split it out if data access grows complex. |
| 7 | Output DTOs via mapper functions | Turns `snake_case` rows into `camelCase` API fields, derives `status` from timestamps, and hides columns the client does not need. | A small mapper to maintain. |
| 8 | One zod schema shared by form and API | Rules are written once. Input types come from `z.infer`, so no separate input DTOs. | None. |
| 9 | TanStack Query on the client | All reads and writes go through the API. Optimistic toggle for complete, refetch after changes. Every list has loading, empty and error states; buttons are disabled while a request runs; cancel asks for confirmation. | The table renders on the client; the page shell and the session check stay in a Server Component (see Server and client boundary). |
| 10 | Generated database types | `supabase gen types` keeps queries type-safe without an ORM. | Regenerate after each migration. |

## Security and RBAC

RLS is the source of truth for who can touch which row, because the Supabase anon key is public and PostgREST can be called without going through the app. The API adds validation, business rules and clear errors on top.

**Roles**

- Roles live in `profiles.role` (enum `student` | `admin`). A trigger creates the profile with `student` on sign-up.
- Roles are never stored in `user_metadata`. Users can edit it with `updateUser`, which would let anyone make themselves admin.
- Admins are set only through SQL or the seed. Users have no update rights on `profiles`.

**RLS policies**

- `is_admin()` is a `security definer` function with `set search_path = ''`.
- Students can select their own rows. Insert and update policies check both ownership and role: `student_id = (select auth.uid()) and not (select is_admin())`.
- Admins have a select policy on all rows and no write policy.
- The role check in every write policy is required. Permissive policies combine with OR, so an ownership-only write policy would still let an admin change rows they booked before they were promoted.
- Policies wrap `auth.uid()` and `is_admin()` in `(select …)` so Postgres evaluates them once per query, not once per row.

| Action | Allowed when |
| --- | --- |
| Create a consultation | Role is `student`; the new row belongs to the user; it starts as `scheduled` |
| Update a consultation | Role is `student`; the row belongs to the user and still does after the update; the state change is legal |
| Read all consultations | Role is `admin` |
| Admin calls a student write route | API returns 403, and RLS blocks the write on its own |

**Rules the database enforces**

- The migration sets every privilege the app needs explicitly and does not rely on platform defaults. It revokes table-level insert and update from `authenticated`, then grants only what is listed below. Select is granted on the whole table, and RLS then limits which rows each account sees.
- Insert is granted only on `first_name`, `last_name`, `reason` and `scheduled_at`. `student_id` defaults to `auth.uid()`; `completed_at`, `cancelled_at`, `created_at` and `updated_at` are set by the database.
- Update is granted only on `scheduled_at`, `completed_at` and `cancelled_at`.
- A trigger allows only the legal state changes (see Consultation states). It requires a future time only when a booking is created or its time changes, so a past booking can still be marked complete or incomplete.
- On a legal change, the trigger sets `completed_at` or `cancelled_at` to `now()`. On a repeat of the same request it keeps the existing value. Times sent by the client are ignored.
- Check constraints and the partial unique index cover the rest (see Data model).

**App layer**

- `student_id` always comes from the session. Any `student_id` or `role` in the request body is ignored. The student list filters by student\_id explicitly instead of relying on RLS alone.
- All student routes, reads included, use `withStudent`, so an admin gets 403. Admin routes use `withAdmin`. The wrappers control access to their API routes. RLS separately limits students to their own consultations and gives admins read-only access to all of them, so admin writes are blocked even without a wrapper.
- Route Handlers use the user's session client. The service role key is never used in the request path.
- The server verifies the user with `getUser()` or `getClaims()`, never `getSession()`, which does not verify the JWT.
- `proxy.ts` only refreshes the session and redirects pages. It is not an authorization layer: CVE-2025-29927 showed middleware-only auth can be bypassed.
- Server files import `server-only`, so they cannot end up in the client bundle.
- Environment variables are validated with zod at startup. Only public values use the `NEXT_PUBLIC_` prefix.
- Requests for someone else's consultation return 404, not 403, so the API does not reveal that the row exists.
- Logs record the request ID, route, user ID and error class. They never record the consultation reason, cookies or tokens. Unexpected errors return a generic 500.
- Responses with personal data send `Cache-Control: private, no-store`.

## Consultation states and booking rules

A booking is scheduled, completed or cancelled, and only a scheduled booking can be rescheduled or cancelled. The same rules live in `consultation-rules.ts`, the database trigger, the UI and the tests.

&#91;embedded content: consultation states · 3 states, 4 actions\]

A completed booking goes back to scheduled with mark incomplete before anything else can change. Past bookings follow the same rules: they can be marked complete or incomplete, but cannot be moved to another past time. The UI shows only the actions the current state allows.

| Request | Result |
| --- | --- |
| Mark complete on a scheduled booking | 200; `completed_at` set to `now()` by the database |
| Mark incomplete on a completed booking | 200; `completed_at` cleared to `NULL` |
| Cancel a scheduled booking | 200; `cancelled_at` set to `now()` by the database |
| `{ completed: true }` on a completed booking | 200 with the record unchanged: `completed_at` and `updated_at` keep their values |
| `{ completed: false }` on a scheduled booking | 200 with the record unchanged |
| Cancel on a cancelled booking | 422: cancel is an action, not a target state |
| Any other illegal change, such as completing a cancelled booking | 422 from the API; the trigger also blocks it in the database |

Only `{ completed }` is idempotent, because it names a target state. For a repeat, the service returns the current record without writing, and the `updated_at` trigger fires only when a value changes, so nothing moves.

**Booking promises**

| Situation | What the system promises |
| --- | --- |
| Student A sends the same time twice, at once | One active booking: one request gets 201, the other 409 |
| Students A and B book the same time | Both succeed, because there is no tutor or room capacity in scope |
| A cancels, then books the same time again | The new booking succeeds; the cancelled one stays, and the admin sees both |
| A reschedules away from a time | The old time is free to book again |

## Data model

Two tables cover the task: `profiles` for roles and `consultations` for bookings. State is stored as timestamps, and cancelling is a soft change, not a delete.

```sql
create type app_role as enum ('student', 'admin');

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  role app_role not null default 'student',
  created_at timestamptz not null default now()
);

create table consultations (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null default auth.uid() references profiles(id) on delete cascade,
  first_name text not null check (length(trim(first_name)) between 1 and 100),
  last_name  text not null check (length(trim(last_name))  between 1 and 100),
  reason     text not null check (length(trim(reason))     between 1 and 1000),
  scheduled_at timestamptz not null,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not (completed_at is not null and cancelled_at is not null))
);

-- one active booking per student per time; a cancelled time can be booked again
create unique index consultations_no_double_booking
  on consultations (student_id, scheduled_at) where cancelled_at is null;

-- student list: includes cancelled rows, sorted by consultation time
create index consultations_student_list
  on consultations (student_id, scheduled_at, id);

-- admin list: cursor pagination across all students
create index consultations_admin_list
  on consultations (scheduled_at, id);
```

| Choice | Why |
| --- | --- |
| `completed_at` and `cancelled_at` timestamps | Carry both the state and when it happened. The DTO derives `status` from them. |
| Soft cancel | Admins still see cancelled bookings, and the history is kept for audit. |
| `student_id` defaults to `auth.uid()` | Ownership is set by the database, not sent by the client. |
| Partial unique index on `(student_id, scheduled_at)` | At most one active booking per student per time, and a cancelled time can be booked again. When two requests arrive at once, one wins and the other gets 409. No locks are needed, because there is no tutor capacity to share. |
| Full index on `(student_id, scheduled_at, id)` | Serves the student list, which includes cancelled rows. The partial index cannot, because it leaves cancelled rows out. |
| Index on `(scheduled_at, id)` | Supports cursor pagination for the admin list. |
| `timestamptz`, stored as UTC | A `datetime-local` input has no time zone, so the client converts it to an ISO string with an offset before sending. The server compares in UTC; the UI shows times in the user's time zone. |
| Names stored on the consultation | The brief asks the form for first and last name, so they are kept as a snapshot. |
| Migrations in `supabase/migrations` + `seed.sql` | `supabase db reset` rebuilds the database the same way every time. No changes made by hand in the dashboard. |

## Database migrations

The schema lives only in plain SQL migrations managed by the Supabase CLI, applied in timestamp order. Nothing is changed by hand in the dashboard, so any machine can rebuild the same database with one command.

| Order | Migration | What it creates |
| --- | --- | --- |
| 1 | `profiles_and_roles` | `app_role` enum, `profiles` table, `handle_new_user` trigger on `auth.users`, `is_admin()` function, RLS on `profiles` (read own, admin reads all, no user updates) |
| 2 | `consultations` | `consultations` table with `student_id default auth.uid()`, check constraints, partial unique index, student list index, admin list index, `updated_at` trigger that fires only when a value changes |
| 3 | `consultation_rules` | State-change trigger (only legal changes; future time on create or reschedule; sets completed\_at and cancelled\_at to now()); explicit privileges: revoke table-level insert and update from `authenticated`, then grant select on the table, and insert and update on named columns only |
| 4 | `rls_policies` | RLS on `consultations`: students select own rows; insert and update require ownership and a non-admin role; admin selects all rows; no admin writes |

Each migration does one job, and the order follows the dependencies: roles first, then the table, then its rules, then its policies.

**Workflow**

1. `supabase migration new <name>` creates a timestamped file in `supabase/migrations`.
2. Write the SQL. Each file runs in its own transaction, so a failed migration leaves nothing half-applied.
3. `supabase db reset` drops the local database, applies every migration in order, then runs `seed.sql`.
4. `supabase gen types typescript --local > lib/database.types.ts`, committed with the migration.
5. Integration tests run against the freshly reset database.
6. CI repeats steps 3 to 5, and fails if the generated types differ from the committed file.
7. A hosted project gets the same files with `supabase db push`.

**Rules**

- Forward-only: an applied migration is never edited. A fix is a new migration.
- Schema, RLS, triggers and grants all live in migrations. `supabase db diff` is used only to check that nothing drifted.
- `seed.sql` is for local development only: students A and B with bookings (one cancelled, one in the past), and an admin promoted from a student who already had a booking, with test passwords listed in the README. A real admin would be promoted with a one-off SQL statement.
- Later changes to live tables follow expand and contract: add the new column, backfill, switch the code, then drop the old one. This avoids downtime.

## API design

Five endpoints cover the task, all JSON, all behind the same `withAuth` wrapper. Cancel is its own action because it changes state, not deletes a row.

| Method | Path | Who | Does |
| --- | --- | --- | --- |
| GET | `/api/consultations` | Student (`withStudent`) | Lists the caller's own consultations by consultation time, including cancelled ones; filters by `student_id` explicitly |
| POST | `/api/consultations` | Student (`withStudent`) | Books a consultation (starts as `scheduled`) |
| PATCH | `/api/consultations/:id` | Student (`withStudent`) | Sets `{ completed }` to a target state, or reschedules `{ scheduledAt }` when scheduled |
| POST | `/api/consultations/:id/cancel` | Student (`withStudent`) | Cancels a scheduled booking (soft) |
| GET | `/api/admin/consultations?cursor=` | Admin (`withAdmin`) | Lists all consultations, cursor-paginated |

**Status codes**

| Code | When |
| --- | --- |
| 200 / 201 | Success / created |
| 400 | Invalid input, with field-level errors from zod |
| 401 | Not signed in |
| 403 | Wrong role: a student on admin routes, or an admin on any student route |
| 404 | Not found, or someone else's consultation |
| 409 | Same student, same time already booked (Postgres `23505`) |
| 422 | Illegal state change, such as cancelling a completed booking |
| 500 | Unexpected error, generic message only |

**Response shape**: success is `{ "data": … }`, failure is `{ "error": { "code", "message", "fields"? } }`.

**Admin pagination**: the response is `{ "data": [...], "nextCursor": "..." }`, and `nextCursor` is `null` on the last page. Rows are ordered by `(scheduled_at, id)` ascending, and the cursor carries both values, so two bookings at the same time never repeat or go missing between pages.

**Handler shape**: `withAuth` verifies the user, builds the session client, and maps errors to the codes above. Each handler parses input with zod, calls one service function, and returns its DTO. In Next.js 15 and 16, `params` is a Promise and is awaited first.

## Code conventions

A Route Handler is about five lines: `withAuth` owns the cross-cutting work, and the service returns a DTO, never a raw row.

**A thin Route Handler**

```ts
// app/api/consultations/[id]/route.ts
import { withStudent } from '@/lib/api/with-auth';
import { updateConsultationSchema } from '@/lib/validation/consultation';
import { updateConsultation } from '@/lib/services/consultations';

export const PATCH = withStudent<{ id: string }>(async ({ req, supabase, user, params }) => {
  const { id } = await params;
  const input = updateConsultationSchema.parse(await req.json());
  const consultation = await updateConsultation(supabase, user.id, id, input);
  return Response.json({ data: consultation });
});
```

**What `withAuth` does**

```ts
// lib/api/with-auth.ts
import 'server-only';

export function withAuth<P>(handler: (ctx: AuthContext<P>) => Promise<Response>) {
  return async (req: Request, { params }: { params: Promise<P> }) => {
    try {
      const supabase = await createClient();          // the user's session client, never the service role
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return fail(401, 'unauthenticated', 'Please sign in.');
      return await handler({ req, supabase, user, params });
    } catch (err) {
      return toErrorResponse(err);                     // ZodError 400, NotFound 404, Conflict 409, InvalidState 422, else 500
    }
  };
}
```

`withAdmin` wraps `withAuth` and returns 403 unless `is_admin()` is true. The database still enforces the same rule through RLS.

`withStudent` wraps every student route, reads included, the same way and returns 403 for an admin. The wrappers control access to routes; RLS controls which rows each account can read or write, and blocks admin writes on its own.

**DTOs**

```ts
// lib/services/consultation-dto.ts
import 'server-only';
import type { Tables } from '@/lib/database.types';

type Row = Tables<'consultations'>;

export type ConsultationDTO = {
  id: string;
  firstName: string;
  lastName: string;
  reason: string;
  scheduledAt: string;
  status: 'scheduled' | 'completed' | 'cancelled';
};

export type AdminConsultationDTO = ConsultationDTO & { studentId: string };

export function toConsultationDTO(row: Row): ConsultationDTO {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    reason: row.reason,
    scheduledAt: row.scheduled_at,
    status: row.cancelled_at ? 'cancelled' : row.completed_at ? 'completed' : 'scheduled',
  };
}

export const toAdminConsultationDTO = (row: Row): AdminConsultationDTO => ({
  ...toConsultationDTO(row),
  studentId: row.student_id,
});
```

**Rules**

- Handlers hold no business rules, no try/catch and no direct queries.
- Services take the Supabase client and the user ID as parameters, so tests can pass in a client signed in as any role.
- Services throw typed errors (`NotFound`, `Conflict`, `InvalidState`); `withAuth` turns them into HTTP codes in one place.
- Input types come from `z.infer` on the zod schema. Output types are the DTOs. Students never receive `studentId`; admins do, because they need to know whose booking it is.

## Testing and quality

Most tests are fast Vitest tests close to the rules, with the RLS integration tests first, because they prove the security model. Playwright covers one main flow only, if time allows.

| Level | Tool | What it proves |
| --- | --- | --- |
| Unit | Vitest | zod schemas reject bad input (empty names, past times); service rules reject invalid state changes |
| Integration: database | Vitest + local Supabase | Student A cannot read or change B's rows; a student cannot change their role or `student_id`; admin can read all but write nothing, even rows it booked as a student; two identical bookings sent at once leave one active row; duplicate bookings fail; cancelled rows cannot be rescheduled |
| Integration: API | Vitest | 401, 400, 403, 404, 409 and 422 come back as designed; a `student_id` in the body is ignored |
| End to end | Playwright (optional) | Sign up, book, complete, mark incomplete, reschedule, cancel; student B in the same browser never sees A's data; a student is kept out of `/admin` |

Integration tests cover what the UI cannot: someone calling the API or the database directly. E2E tests cover the wiring a user clicks through.

**Test setup**: the service role key is used only in tests, to create users. Each test uses its own data, and `supabase db reset` runs first.

**CI**: GitHub Actions runs lint, typecheck and tests on every push.

**Commit history**: small, meaningful commits, for example `feat(db): consultations schema and RLS`, then `feat(api): create and list consultations`, then `test: RLS policies`. Reviewers can follow how the work was built.

**AI usage**: planned README wording, kept only once it is true: AI is used for scaffolding, and security-critical parts (RLS, triggers, the auth wrapper) are reviewed by hand and covered by tests.

## Test coverage (target)

The plan: every feature and every security rule gets at least one test that should pass and one that should fail. Line coverage is measured for TypeScript; for the database, the measure is that each policy, trigger and constraint has both an allow test and a deny test. At submission this section lists the tests that exist and the coverage measured.

| Feature or rule | Unit | DB integration | API integration | E2E |
| --- | --- | --- | --- | --- |
| Sign-up creates a student profile |  | Profile row with role `student` |  | Sign up |
| List own consultations |  | A cannot see B's rows | 200 own list; 401 signed out; 403 for admin | Dashboard shows bookings |
| Book | zod: empty names, past time, long reason | Constraints; past time rejected; `student_id` comes from the default | 201; 400 with fields; 409 duplicate | Book from dialog |
| Concurrent duplicate booking |  | Two identical inserts at once leave one active row | Two requests at once: one 201, one 409 |  |
| Mark complete or incomplete | Rules: scheduled and completed only | Cancelled row blocked; `completed_at` set by the database | 200 both ways; 422 when cancelled | Complete, then mark incomplete |
| Past booking | Rules: complete allowed in the past | Yesterday's booking can be completed and marked incomplete; moving it to another past time fails | 200 to complete; 400 for a past reschedule | Complete the seeded past booking |
| Repeat request | Same target state is a no-op | Second `{ completed: true }` keeps the first `completed_at` and updated\_at; a second cancel is rejected | 200 with the record unchanged |  |
| Reschedule | Rules: scheduled only, future only | Completed and cancelled rows blocked; old time free while the new one is active | 200; 404 for B's row; 422 when completed | Reschedule, then rebook the old time |
| Cancel | Rules: scheduled only | Completed and cancelled rows blocked; cancelled time free again | 200; 422 when completed or already cancelled | Cancel, then rebook that time |
| Admin reads all, read-only |  | Admin reads all rows; every admin write fails, including rows it booked as a student | 200 for admin; 403 for student; 403 for admin on student routes | Student kept out of `/admin` |
| Admin pagination | Cursor encode and decode | Two bookings at the same time split across pages | `nextCursor` set, then `null` on the last page |  |
| No role escalation |  | Student cannot update `profiles.role` | `role` in body ignored |  |
| No ownership tampering |  | Column grants block `student_id`, `completed_at` on insert | `student_id` in body ignored |  |
| Account switch in one browser | Query keys include user ID |  | `Cache-Control: private, no-store` on personal data | B never sees A's data, even while loading |
| DTO and error mapping | Row to DTO, derived `status`; `23505` to 409 |  | Response shape `{ data }` / `{ error }` |  |

**Targets**

- Target: 90% or more line and branch coverage for `lib/services` and `lib/validation`, reported by Vitest with the v8 provider.
- Target: every RLS policy, trigger and constraint has an allow test and a deny test.
- E2E: the student flow and the account switch, if time allows. More E2E is listed under future work.
- CI fails if any test fails or a coverage target is missed.
- At submission, each target above is replaced by the number actually measured.

## Assumptions

The brief leaves these details open on purpose, so each one is a stated choice.

- Everyone who signs up is a student. Admins are promoted only through SQL or the seed, and an admin's own earlier bookings become read-only.
- Cancelling keeps the row and sets `cancelled_at`. It does not delete.
- States: scheduled and completed can switch back and forth; only a scheduled booking can be rescheduled or cancelled; cancelled is final. A completed booking is marked incomplete before it can change.
- New and rescheduled times must be in the future. A past booking can still be marked complete or incomplete, and a future booking can be marked complete too, since the brief sets no limit.
- A student can have one active booking per time. Different students can book the same time, because there is no tutor or room capacity in scope. A cancelled time can be booked again.
- The student list is ordered by consultation time and includes past and cancelled bookings.
- First and last name are entered on the form, as the brief asks, even though the user has an account.
- Times are stored in UTC and shown in the browser's time zone.
- The admin view is read-only, enforced in the API and again in the database.
- The app targets Next.js 16, so `proxy.ts` replaces `middleware.ts`.

## Future work and known limitations

The scope stops at what the brief asks. These are the next steps, roughly in the order they would add value.

- **Tutor availability and capacity**: real slots per tutor. This is where locking or an exclusion constraint on time ranges would come in.
- **Notifications**: booking confirmations and reminders through a queue or scheduled job, reusing the service layer.
- **Audit log**: who changed what and when, for admins.
- **Rate limiting** on booking and auth endpoints.
- **Role claim in the JWT** through a Supabase custom access token hook, to avoid a lookup in `is_admin()`.
- **Per-user time zone** saved in the profile, instead of the browser's.
- **More E2E coverage** with Playwright beyond the two main flows.
- **A multi-stage Dockerfile** with Next.js standalone output, for deployment. Local development stays on `npm run dev` plus the Supabase CLI.
- **A separate service** if logic grows or other clients need the same API. The service layer can move with few changes.

## Revision history

Version 2 applied the first design review: it fixed three defects (admin writes, state changes, the student list index) and tightened the wording. Version 3 applies the second review: past bookings, idempotent requests, the student read route and pagination. This section is internal and stays out of the submitted README. To compare word by word, open Version history from the doc name menu.

| Version | Date | Summary |
| --- | --- | --- |
| 3.1 | 21 Nov 2026 | Two precision fixes from the review of version 3 (changes below) |
| 3 | 21 Nov 2026 | Second design review applied (changes below); design frozen for implementation |
| 2 | 21 Nov 2026 | First design review applied (changes below) |
| 1 | 21 Nov 2026 | First design |

**Changes in version 2**

| Section | Change | Why |
| --- | --- | --- |
| Security and RBAC | Student insert and update policies check role as well as ownership; an action table states who may do what | Permissive policies combine with OR, so an admin could still write rows booked before promotion |
| Security and RBAC, Migrations | Table-level insert and update revoked first; insert limited to four columns; `student_id` defaults to `auth.uid()` | Supabase grants table-level rights by default, so column grants alone did nothing; insert was unrestricted |
| Security, API design, Code conventions, Architecture | `withStudent` added: an admin on a student write route gets 403 | Role checked in the API as well as in RLS |
| Consultation states and booking rules (new) | State diagram: scheduled and completed switch both ways; only scheduled can be rescheduled or cancelled; cancelled is final | Complete, then cancel, would break the check constraint and return 500 |
| Consultation states and booking rules (new) | Booking promises table, plus a concurrent booking test | Turns the unique index into a promise a reviewer can check |
| Data model | Full index `(student_id, scheduled_at, id)` added; the partial index is no longer claimed for the list; list ordered by consultation time | The partial index leaves out cancelled rows; "newest first" was ambiguous |
| Server and client boundary (new) | What renders on server and client; cache cleared on account switch; optimistic rollback | Shared computers must never show the previous student's data |
| Review path (new) | Five-minute path and README checklist; seed has a cancelled booking and an admin promoted from a student | Reviewers see every feature working first |
| Features, Test coverage | Marked as planned and target; to be replaced by actual results at submission | The doc describes a plan, not finished work |
| Overview, Key decisions, Technology stack | UI sentence matches the brief; removed the claim about Contour's own stack; softer Prisma wording; Next.js 16, full package names, lockfile | Accuracy |
| Security and RBAC | Logs exclude the consultation reason, cookies and tokens; personal responses send `Cache-Control: private, no-store` | Less personal data in logs and caches |
| Architecture, Future work | README gets the diagram as Mermaid; a deployment Dockerfile added to future work | The embedded diagram does not render on GitHub |

**Changes in version 3**

| Section | Change | Why |
| --- | --- | --- |
| Security and RBAC, Migrations, Architecture, Assumptions | The trigger requires a future time only on create or reschedule; past bookings can be marked complete or incomplete | Checking the time on every update would block completing yesterday's booking |
| Security and RBAC, Consultation states | The database sets `completed_at` and `cancelled_at` to `now()`; times sent by the client are ignored | Timestamps must record when the change really happened |
| Consultation states, API design | A repeat of the same target state returns 200 and keeps the first `completed_at` | A retry after a lost response should succeed, not fail with 422 |
| API design, Security, Features, Code conventions | `GET /api/consultations` uses `withStudent` and filters by `student_id` explicitly; an admin gets 403 | `/api/consultations` always means "my bookings", and the query matches the student list index |
| API design, Test coverage | Admin pagination response with `nextCursor`, ordered by `(scheduled_at, id)`, plus a same-time test | Reviewers can see how to fetch the next page, and ties never repeat or vanish |
| Server and client boundary, Project structure | Cache cleared on sign-out or user change, not on token refresh; separate keys for student and admin lists | Clearing on every auth event reloads data for no reason |
| Key decisions | Prisma comparison removed | Setting claims alone does not make a bypass role follow RLS; the comparison was not needed |
| Security and RBAC, Migrations | The migration sets privileges explicitly instead of citing Supabase defaults | Defaults can differ between projects; a migration should rebuild the same rights from an empty database |
| Review path | New order: book T1, move to T2, rebook T1, cancel T2, rebook T2; sign-up added; seeded past booking completed | One run now proves that rescheduling and cancelling each free a time |
| Review path, Testing and quality | Claims about the fresh-clone check and AI review are marked as planned until done | The submission should only state what has been verified |
| Architecture | The README uses Mermaid for the architecture and a table for the states | Embedded diagrams become placeholders in a Markdown export |

**Changes in version 3.1**

| Section | Change | Why |
| --- | --- | --- |
| Security and RBAC, Code conventions | The wrappers guard routes; RLS guards rows and blocks admin writes. The claim that RLS repeats every role check is removed | RLS cannot tell which route a request came from; admins may read all rows, so only `withStudent` keeps an admin off the student list |
| Security and RBAC, Migrations | Select on `consultations` is granted explicitly | The doc said every privilege is explicit, but listed only insert and update |
| Consultation states, Migrations, Test coverage | Only `{ completed }` is idempotent; a second cancel returns 422; a repeat leaves `completed_at` and `updated_at` unchanged; marking incomplete clears `completed_at` | "The state the booking already has" read as if a repeat cancel also returned 200, which the tests contradict |
