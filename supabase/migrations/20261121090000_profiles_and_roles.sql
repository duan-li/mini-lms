-- Roles live in public.profiles, never in user_metadata (users can edit that
-- with updateUser). Every new account is a student; admins are promoted only
-- with SQL or the seed, because users have no write rights on this table.

create type public.app_role as enum ('student', 'admin');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.app_role not null default 'student',
  created_at timestamptz not null default now()
);

comment on table public.profiles is 'One row per auth user; holds the role. Written only by the sign-up trigger and by SQL.';

alter table public.profiles enable row level security;

-- Create the profile on sign-up. security definer so it can write
-- public.profiles while running as the auth service.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- True when the caller is an admin. security definer with an empty
-- search_path, so it reads profiles without RLS and cannot be hijacked
-- through a schema on the caller's path.
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
  );
$$;

-- Privileges are set explicitly rather than relying on platform defaults.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Read own profile; admins read all. No insert, update or delete policy:
-- users can never change a role.
create policy "profiles: read own"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()));

create policy "profiles: admins read all"
  on public.profiles for select
  to authenticated
  using ((select public.is_admin()));
