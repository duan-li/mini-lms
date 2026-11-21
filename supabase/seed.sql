-- Local development data only. Test passwords are listed in the README.
--
--   student.a@example.com  password123  student, four bookings (one starts a few
--                                       seconds after the seed runs, so it is
--                                       soon in the past and can be completed)
--   student.b@example.com  password123  student, two bookings, one cancelled
--   admin@example.com      password123  booked as a student, then promoted
--
-- Every trigger stays enabled: each row goes through the same rules as the app.

-- Accounts. The on_auth_user_created trigger gives each one a student profile.
-- Token columns are '' rather than NULL, which GoTrue expects.
with seed_users (id, email) as (
  values
    ('00000000-0000-4000-8000-00000000000a'::uuid, 'student.a@example.com'),
    ('00000000-0000-4000-8000-00000000000b'::uuid, 'student.b@example.com'),
    ('00000000-0000-4000-8000-0000000000ad'::uuid, 'admin@example.com')
)
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
select
  '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email,
  extensions.crypt('password123', extensions.gen_salt('bf')), now(),
  '{"provider": "email", "providers": ["email"]}', '{}', now(), now(),
  '', '', '', '', '', '', '', ''
from seed_users;

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select
  gen_random_uuid(), id, id::text,
  jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true),
  'email', now(), now(), now()
from auth.users
where id in (
  '00000000-0000-4000-8000-00000000000a',
  '00000000-0000-4000-8000-00000000000b',
  '00000000-0000-4000-8000-0000000000ad'
);

-- Bookings, on whole hours (UTC) so they read well in the UI. student_id is set here
-- because the seed runs without a session (auth.uid() is null).
insert into public.consultations (student_id, first_name, last_name, reason, scheduled_at)
values
  ('00000000-0000-4000-8000-00000000000a', 'Alice', 'Anders', 'Review my essay outline',
    date_trunc('day', now()) + interval '1 day 10 hours'),
  ('00000000-0000-4000-8000-00000000000a', 'Alice', 'Anders', 'Exam preparation plan',
    date_trunc('day', now()) + interval '3 days 14 hours'),
  ('00000000-0000-4000-8000-00000000000a', 'Alice', 'Anders', 'Feedback on the group project',
    date_trunc('day', now()) + interval '5 days 9 hours'),
  -- A few seconds ahead of the database time: in the past by the time a
  -- reviewer logs in, and still created through the normal future-time rule.
  ('00000000-0000-4000-8000-00000000000a', 'Alice', 'Anders', 'Catch-up on last week''s lab',
    now() + interval '5 seconds'),
  ('00000000-0000-4000-8000-00000000000b', 'Bob', 'Brown', 'Course selection advice',
    date_trunc('day', now()) + interval '2 days 11 hours'),
  ('00000000-0000-4000-8000-00000000000b', 'Bob', 'Brown', 'Questions about the assignment',
    date_trunc('day', now()) + interval '4 days 15 hours'),
  ('00000000-0000-4000-8000-0000000000ad', 'Ada', 'Admin', 'Booked before promotion to admin',
    date_trunc('day', now()) + interval '2 days 16 hours');

-- B cancels one booking: the row stays, and the admin still sees it.
update public.consultations
set cancelled_at = now()
where student_id = '00000000-0000-4000-8000-00000000000b'
  and reason = 'Questions about the assignment';

-- Promote the admin after its booking exists, as a real promotion would happen.
update public.profiles
set role = 'admin'
where id = '00000000-0000-4000-8000-0000000000ad';
