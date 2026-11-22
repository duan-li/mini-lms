# Mini-LMS: Development Plan

Nov 21, 2026 · @Daniel

The plan builds the riskiest part first, and each milestone ends in a working, tested state with its own commits, built from the [design doc v3.1](https://claude.ai/artifact/JNptjRKAYmbSZHbxstqcGX). The deadline is Monday 23 Nov, 2:45pm, 48 hours after the email; the internal target is Monday noon. The README grows with each milestone, so M6 only re-runs it from a fresh clone and submits. This plan is final; from here, changes happen in the code.

> 2026-11-22 验收以包含 M6 的公开 main 提交 `10c50e6` 为准。下列证据和未勾选原因见[完整验收报告](ACCEPTANCE.md)。勾选表示该条计划的交付物有证据，安全发现和里程碑完成条件单独列于报告。

## M1 Project setup

The template runs against local Supabase, with tooling and CI in place before any feature code. Design reference: [Technology stack and Project structure](https://claude.ai/artifact/JNptjRKAYmbSZHbxstqcGX).

- [x] `npx create-next-app --example with-supabase mini-lms`; confirm Next.js 16, App Router, TypeScript strict **验收依据** e1bb949；package.json、tsconfig.json、app/layout.tsx。
- [x] `npm install supabase --save-dev`, `npx supabase init`, `npx supabase start` (OrbStack or Docker running) **验收依据** 3488a1f；package.json、supabase/config.toml；隔离库启动成功。
- [x] `.env.local` from `npx supabase status`; `lib/env.ts` validates it with zod; commit `.env.example` **验收依据** .env.example、lib/env.ts、instrumentation.ts；status 生成的配置启动成功。
- [x] First real test: `env.test.ts` shows a missing variable gives a readable error (Vitest fails on an empty suite) **验收依据** tests/unit/env.test.ts，5 例。
- [x] Add zod, react-hook-form, `@tanstack/react-query`, shadcn/ui (button, table, dialog, form, badge, toast) **验收依据** package.json、components/ui/、app/providers.tsx。
- [x] Vitest with two projects (unit, integration); scripts `test`, `typecheck`, `lint` **验收依据** vitest.config.mts、package.json；另含真实 HTTP 的 api project。
- [x] GitHub Actions: install, lint, typecheck, `supabase start`, `db reset`, test **验收依据** .github/workflows/ci.yml；报告中的 main CI。
- [x] Sign up, log in and log out through the template; note whether local sign-up needs email confirmation in Mailpit **验收依据** tests/e2e/student-flow.spec.ts、account-switch.spec.ts；supabase/config.toml 的 enable_confirmations。
- [x] README start: prerequisites, setup commands, environment variables **验收依据** README 的 Prerequisites、Setup、Environment variables。

**Done when**: a new account can sign up, log in and log out locally, and `env.test.ts` passes locally and in CI.

**Commits**: `chore: scaffold from with-supabase template` · `chore: tooling, env validation and CI`

## M2 Database, RLS and database tests

The security model is built and proven first, because every later milestone depends on it. Design reference: Data model, Database migrations, Security and RBAC, Consultation states.

- [x] Migration 1 `profiles_and_roles`: enum, `profiles`, `handle_new_user` trigger, `is_admin()`, RLS on `profiles` **验收依据** 20261121090000_profiles_and_roles.sql；rls.test.ts 的 profiles 组。
- [x] Migration 2 `consultations`: table with `student_id default auth.uid()`, checks, three indexes, `updated_at` trigger that fires only when a value changes **验收依据** 20261121090100_consultations.sql；db-rules.test.ts 的真实更新及重复完成用例。
- [x] Migration 3 `consultation_rules`: state trigger (legal changes only; future time on create or reschedule; sets `completed_at` / `cancelled_at`). Privileges in this order: revoke table-level insert and update from `authenticated`, then grant select on the table, then grant insert and update on the named columns **验收依据** 20261121090200_consultation_rules.sql；db-rules.test.ts；日期边界见验收报告。
- [x] Migration 4 `rls_policies`: student select own; insert and update need ownership and a non-admin role; admin select all **验收依据** 20261121090300_rls_policies.sql；rls.test.ts 的 student/admin 组。
- [x] `seed.sql`: students A and B with future bookings and one cancelled; an admin promoted from a student with a booking. Student A also gets a booking scheduled a few seconds after the database time at insertion: by review step 6 it is in the past and can be marked complete. All database triggers stay enabled, so every seeded row passes the normal rules **验收依据** supabase/seed.sql；reset 后学生 2 人 6 条、管理员 1 人 1 条。
- [x] `supabase gen types typescript --local > lib/database.types.ts`; CI regenerates to a temp file and fails if it differs **验收依据** CI 的 Check generated database types；本地生成结果与提交文件逐字节相同。
- [x] `tests/integration/helpers.ts`: create users and sign in as a role (service role in tests only) **验收依据** tests/integration/helpers.ts、global-setup.ts；app 运行时使用公开 key。
- [x] `rls.test.ts`: **验收依据** tests/integration/rls.test.ts 第 42、106、118、138、205、215 行；21 例。
  - A can update A's booking; the same update on B's booking changes nothing (RLS affects 0 rows, no error), so assert B's row is unchanged
  - Admin sees A's, B's and its own pre-promotion bookings; an update to its own old row changes nothing
  - A student cannot change `profiles.role` or `student_id`
- [x] `db-rules.test.ts`: **验收依据** tests/integration/db-rules.test.ts 第 93、102、148、210、231、243、267、280 行；29 例。
  - Complete, mark incomplete (`completed_at` back to `NULL`), reschedule, cancel; completing a cancelled row and rescheduling a completed row fail
  - A repeat `{ completed: true }` keeps both `completed_at` and `updated_at`; a second cancel fails
  - A booking created a few seconds ahead can be completed once that time has passed; moving it to another past time fails
  - Rescheduling frees the old time while the new one is active; cancelling frees that time
- [x] `concurrency.test.ts`: the same student books the same time twice at once and one active row remains; two different students book the same time and both succeed **验收依据** tests/integration/concurrency.test.ts 两个并发测试。
- [x] README: seed accounts, their test passwords, `db reset` and type generation **验收依据** README 的 Database、Seed accounts、Scripts。

**Done when**: `npx supabase db reset` runs clean from empty, including the seed; every policy, trigger and constraint has a passing allow test and deny test; the CI type check passes.

**Commits**: `feat(db): profiles and roles` · `feat(db): consultations schema` · `feat(db): state rules and grants` · `feat(db): RLS policies` · `test(db): RLS, rules and concurrency`

## M3 Services and API

All five endpoints work and return the designed status codes, before any UI exists. Design reference: API design, Code conventions, Consultation states.

- [x] `lib/validation/consultation.ts`: zod schemas for create, reschedule and complete **验收依据** lib/validation/consultation.ts；tests/unit/validation.test.ts。
- [x] `lib/services/consultation-rules.ts`: pure state rules, with unit tests **验收依据** lib/services/consultation-rules.ts；同名 unit 测试 12 例。
- [x] `lib/services/consultation-dto.ts`: student and admin DTOs, derived `status`, with unit tests **验收依据** lib/services/consultation-dto.ts；同名 unit 测试 4 例。
- [x] `lib/api/errors.ts` + `with-auth.ts`: `withAuth`, `withStudent`, `withAdmin`; error mapping (400, 401, 403, 404, 409, 422, 500); logs without reason text or tokens **验收依据** lib/api/with-auth.ts、errors.ts；tests/unit/with-auth.test.ts、errors.test.ts 和 HTTP 状态测试；日志结论限应用 wrapper。
- [x] `lib/services/consultations.ts` (`server-only`): list (filters by `student_id`), create, set completed (no write on a repeat), reschedule, cancel, admin list with cursor **验收依据** lib/services/consultations.ts；tests/integration/services.test.ts 24 例。
- [x] Five Route Handlers, each about five lines; `Cache-Control: private, no-store` on personal data **验收依据** app/api/ 下四个 route.ts 共五个方法；with-auth.ts 统一设置响应头；api.test.ts 第 139 行。
- [x] API test harness: tests run against a real Next.js server over HTTP. A Vitest global setup builds the app, starts it on its own port (3100), waits until it is ready, and stops only that process at the end, so a reviewer's running npm run dev on port 3000 is untouched. The same path runs locally and in CI. In CI, the local Supabase URL and public key are set before the build; the secret key used to create test users goes only to the test process. Each test signs in with a `@supabase/ssr` client on an in-memory cookie store, then sends those cookies with every request, as a student or as the admin **验收依据** tests/api/global-setup.ts、http.ts 和 CI 的 Test with coverage；端口 3100/3101。
- [x] `api.test.ts`: the status matrix from Test coverage, including 403 for an admin on student routes, 422 for rescheduling a completed booking, and `nextCursor` paging with two bookings at the same time **验收依据** tests/api/api.test.ts 第 143、296、367、471 行；49 个 HTTP 用例。
- [x] API concurrency: two identical booking requests at once return one 201 and one 409 (the database test already proves only one row is written) **验收依据** tests/api/api.test.ts 第 512 行；数据库并发断言见 M2。
- [x] README: test commands, and that local Supabase must be running first; the tests start their own app **验收依据** README 的 Scripts、Tests、Running them。

**Done when**: every row of the API column in Test coverage passes over HTTP, and one booking goes through book, complete, mark incomplete, reschedule and cancel with a student's cookies.

**Commits**: `feat(api): validation, rules and DTOs` · `feat(api): auth wrappers and error mapping` · `feat(api): consultation endpoints` · `feat(api): admin list with cursor` · `test(api): status codes and paging`

## M4 Student UI

A student can do everything in the brief from the dashboard, using only the API from M3. Design reference: Server and client boundary, Features.

- [x] `providers.tsx`: Query client; clear it on sign-out or user ID change, not on token refresh **验收依据** app/providers.tsx、lib/queries/auth-cache.ts；tests/unit/queries.test.ts 第 15–31 行。
- [x] `lib/queries/consultations.ts`: hooks with keys `['consultations', userId]`; typed fetch helpers in `lib/api/client.ts` **验收依据** lib/queries/consultations.ts、lib/api/client.ts；api-client.test.ts、queries.test.ts。
- [x] `dashboard/page.tsx` as a Server Component: session and role check, redirect if wrong **验收依据** app/dashboard/page.tsx、lib/auth/viewer.ts；学生流程及管理员跳转 E2E。
- [x] Header: reuse the template's auth button and logout, so the account switch can be tested in this milestone **验收依据** components/app-header.tsx、auth-button.tsx、logout-button.tsx；account-switch.spec.ts。
- [x] `consultation-table.tsx`: status badge; loading, empty and error states; only the actions the state allows **验收依据** components/consultations/consultation-table.tsx、status-badge.tsx；student-flow.spec.ts。
- [x] Complete toggle with optimistic update, rollback on error, refetch when settled **验收依据** lib/queries/consultations.ts 的 onMutate/onError/onSettled；PR #4 记录了失败回滚检查。
- [x] Booking, reschedule and cancel dialogs: react-hook-form + shared zod schema; `datetime-local` converted to ISO with offset; buttons disabled while pending; cancel asks to confirm **验收依据** booking-dialog.tsx、reschedule-dialog.tsx、cancel-dialog.tsx；有输入的两个表单共享 zod，纯确认取消无表单字段；夏令时偏差见报告。
- [x] `proxy.ts`: session refresh and page redirects only **验收依据** proxy.ts、lib/supabase/proxy.ts、with-auth.ts；登出后 API 返回 401。
- [x] README: review path steps 2 to 8 **验收依据** README Review path 第 2–8 步；student-flow.spec.ts、account-switch.spec.ts。

**Done when**: review path steps 2 to 8 pass by hand in the browser, including the T1 / T2 order and completing the past booking.

**Commits**: `feat(ui): query provider and hooks` · `feat(ui): student dashboard` · `feat(ui): booking, reschedule and cancel dialogs`

## M5 Admin UI and hardening

The admin sees every booking read-only, and the cross-cutting checks are finished. Design reference: Features, Security and RBAC, Test coverage.

- [x] `admin/page.tsx` as a Server Component with the admin check; students redirected away **验收依据** app/admin/page.tsx；admin.spec.ts 第 11 行。
- [x] `admin-consultation-table.tsx`: student ID and name, status, no edit controls; a plain `Load more` button driven by `nextCursor`; key `['admin-consultations', userId, cursor]` **验收依据** components/admin/admin-consultation-table.tsx、lib/queries/admin-consultations.ts；key 另含 limit，区分页大小。
- [x] Load more check: two bookings at the same time fall on different pages, and both appear in the UI **验收依据** tests/e2e/admin.spec.ts 第 22 行；每页一行记录位置和唯一 ID。
- [x] Header: admin link shown only to admins **验收依据** components/app-header.tsx；admin.spec.ts 验证两种角色。
- [x] Coverage gate in CI: 90% line and branch coverage for `lib/services` and `lib/validation`, v8 provider; fill the gaps **验收依据** vitest.config.mts、CI Test with coverage；实测见报告。
- [x] Optional: Playwright `student-flow.spec.ts` and `account-switch.spec.ts` **验收依据** tests/e2e/student-flow.spec.ts、account-switch.spec.ts；另有 admin.spec.ts。
- [x] README: review path step 9 and the admin account **验收依据** README Review path 第 9 步及 Seed accounts。

**Done when**: review path step 9 passes, including the admin's own old booking being read-only, and every test is green in CI.

**Commits**: `feat(ui): admin read-only list` · `test: coverage gaps` · `test(e2e): student flow and account switch` (if time allows)

## M6 README, fresh-clone check and submission

A reviewer can clone the repo and reproduce every promise from the README alone. Design reference: Review path, Assumptions, Future work.

- [x] README: finish the review path, key decisions, assumptions and future work, cut down from the design doc; no internal revision history **验收依据** main README 第 39、332、350、364 行；工作树已快进到该合并提交。
- [x] README: architecture as Mermaid, states as a three-row table; check both render on GitHub **验收依据** main README 第 148、191 行；匿名 Chromium 在 GitHub 实际读取图中 7 个节点、状态表 3 行。
- [x] Replace every target with what was measured: test counts, coverage numbers, what E2E covers; list anything cut under future work **验收依据** main README 第 277、294、364 行；实测对照见报告。
- [x] Fresh clone in a new folder: follow the README word by word, fix anything that breaks, then add the fresh-clone note **验收依据** PR #6 的 fresh-clone 记录、b6c43a8 修复、main README 第 7 行；另从公开 main 全新克隆并执行 npm install，git status --porcelain 为空，复核条件见报告。
- [x] Check no secrets are committed: `.env.local` ignored, only local Supabase keys in docs **验收依据** git check-ignore .env.local、git ls-files、凭据特征扫描与 PR #6；检查范围见报告。
- [x] Push and check CI is green **验收依据** GitHub Actions main 合并提交的运行链接见报告。
- [ ] Re-read the assessment email for the submission method (upload link or repo link), and check the reviewer can access what is submitted **验收依据** 部分完成。PDF 第 1 页确认 Rippling 上传入口，公开仓库可匿名访问；实际上传材料和收件方可见性未获证实。
- [ ] Submit by Monday 12:00 **验收依据** 未取得带时间戳的 Rippling 回执。周一 12:00 是 PLAN 内部目标，邮件规定的期限是 14:45。

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
