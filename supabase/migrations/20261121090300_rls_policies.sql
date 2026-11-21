-- Row access for consultations. Grants (previous migration) decide which
-- columns can be written; these policies decide which rows.
--
-- Permissive policies combine with OR, so every write policy checks the role
-- as well as ownership: otherwise an admin could still change rows they booked
-- before they were promoted. auth.uid() and is_admin() are wrapped in
-- (select ...) so Postgres evaluates them once per query, not once per row.

create policy "consultations: students read own"
  on public.consultations for select
  to authenticated
  using (student_id = (select auth.uid()));

create policy "consultations: admins read all"
  on public.consultations for select
  to authenticated
  using ((select public.is_admin()));

create policy "consultations: students insert own"
  on public.consultations for insert
  to authenticated
  with check (
    student_id = (select auth.uid())
    and not (select public.is_admin())
  );

create policy "consultations: students update own"
  on public.consultations for update
  to authenticated
  using (
    student_id = (select auth.uid())
    and not (select public.is_admin())
  )
  with check (
    student_id = (select auth.uid())
    and not (select public.is_admin())
  );

-- No delete policy (cancel is soft) and no admin write policy.
