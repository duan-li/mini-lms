-- Match the four-digit ISO years accepted by the booking forms and API.
-- Apply to newly assigned times. Existing records retain their history and
-- can still be completed, reopened, cancelled or rescheduled under the usual rules.
create function public.reject_unsupported_consultation_time()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Consultation time must have a UTC year between 1 and 9999'
    using errcode = '23514', constraint = 'consultations_scheduled_at_range';
end;
$$;

revoke all on function public.reject_unsupported_consultation_time() from public, anon, authenticated;

create trigger consultations_check_time_range
  before insert or update of scheduled_at on public.consultations
  for each row
  when (new.scheduled_at < timestamptz '0001-01-01 00:00:00+00'
     or new.scheduled_at >= timestamptz '10000-01-01 00:00:00+00')
  execute function public.reject_unsupported_consultation_time();
