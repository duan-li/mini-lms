-- Bookings. State is stored as timestamps: scheduled (both null), completed
-- (completed_at set) or cancelled (cancelled_at set). Cancel is soft.

create table public.consultations (
  id uuid primary key default gen_random_uuid(),
  -- Ownership comes from the session, never from the client.
  student_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  first_name text not null check (length(trim(first_name)) between 1 and 100),
  last_name text not null check (length(trim(last_name)) between 1 and 100),
  reason text not null check (length(trim(reason)) between 1 and 1000),
  scheduled_at timestamptz not null,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint consultations_single_state check (not (completed_at is not null and cancelled_at is not null))
);

comment on table public.consultations is 'Student bookings. State rules: consultations_enforce_rules trigger.';

-- Deny by default until the policies in the rls_policies migration exist.
alter table public.consultations enable row level security;

-- One active booking per student per time; a cancelled time can be booked again.
create unique index consultations_no_double_booking
  on public.consultations (student_id, scheduled_at)
  where cancelled_at is null;

-- Student list: includes cancelled rows, sorted by consultation time.
create index consultations_student_list
  on public.consultations (student_id, scheduled_at, id);

-- Admin list: cursor pagination across all students.
create index consultations_admin_list
  on public.consultations (scheduled_at, id);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;

-- Fires only when a value really changes, so a repeated request leaves
-- updated_at alone. BEFORE triggers fire in name order, so this one runs after
-- consultations_enforce_rules (next migration) and sees its final row.
create trigger consultations_set_updated_at
  before update on public.consultations
  for each row
  when (old.* is distinct from new.*)
  execute function public.set_updated_at();
