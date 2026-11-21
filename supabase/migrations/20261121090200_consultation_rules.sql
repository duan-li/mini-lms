-- State rules for consultations, enforced for every caller.
--
--   scheduled --complete--> completed --mark incomplete--> scheduled
--   scheduled --cancel----> cancelled (final)
--   scheduled --reschedule (future time only)--> scheduled
--
-- A client asks for a change by writing a column:
--   completed_at = <any time>  complete       completed_at = null  mark incomplete
--   cancelled_at = <any time>  cancel         scheduled_at = <new> reschedule
-- The trigger replaces client-sent times with now(), so the database records
-- when the change really happened. A repeated complete keeps the first time.
--
-- Errors use PostgREST's PTxxx convention, so the HTTP status is part of the code:
--   PT422  illegal state change
--   PT400  new or rescheduled time is not in the future

create function public.enforce_consultation_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.completed_at is not null or new.cancelled_at is not null then
      raise exception 'A new consultation must start as scheduled'
        using errcode = 'PT422';
    end if;
    if new.scheduled_at <= now() then
      raise exception 'Consultation time must be in the future'
        using errcode = 'PT400';
    end if;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  -- UPDATE
  if new.id is distinct from old.id
     or new.student_id is distinct from old.student_id
     or new.created_at is distinct from old.created_at then
    raise exception 'id, student_id and created_at cannot change'
      using errcode = 'PT422';
  end if;

  if old.cancelled_at is not null then
    raise exception 'A cancelled consultation cannot change'
      using errcode = 'PT422';
  end if;

  -- Cancel: only from scheduled, and nothing else may change with it.
  if new.cancelled_at is not null then
    if old.completed_at is not null then
      raise exception 'Only a scheduled consultation can be cancelled'
        using errcode = 'PT422';
    end if;
    if new.completed_at is not null or new.scheduled_at is distinct from old.scheduled_at then
      raise exception 'Cancel cannot be combined with another change'
        using errcode = 'PT422';
    end if;
    new.cancelled_at := now();
    return new;
  end if;

  -- Reschedule: only from scheduled, to a future time, as the only change.
  if new.scheduled_at is distinct from old.scheduled_at then
    if old.completed_at is not null then
      raise exception 'Only a scheduled consultation can be rescheduled'
        using errcode = 'PT422';
    end if;
    if new.completed_at is not null then
      raise exception 'Reschedule cannot be combined with another change'
        using errcode = 'PT422';
    end if;
    if new.scheduled_at <= now() then
      raise exception 'Consultation time must be in the future'
        using errcode = 'PT400';
    end if;
    return new;
  end if;

  -- Complete or mark incomplete. Past bookings are allowed: no time check here.
  if new.completed_at is not null then
    -- First complete records now(); a repeat keeps the original time.
    new.completed_at := coalesce(old.completed_at, now());
  end if;
  -- new.completed_at = null on a completed row marks it incomplete;
  -- on a scheduled row it is already null, so nothing changes.
  return new;
end;
$$;

revoke all on function public.enforce_consultation_rules() from public, anon, authenticated;

-- Name sorts before consultations_set_updated_at, so the rules run first.
create trigger consultations_enforce_rules
  before insert or update on public.consultations
  for each row execute function public.enforce_consultation_rules();

-- Privileges, explicit rather than platform defaults. Order matters: column
-- grants do nothing while a table-level grant exists, so revoke that first.
revoke all on public.consultations from anon, authenticated;
grant select on public.consultations to authenticated;
grant insert (first_name, last_name, reason, scheduled_at) on public.consultations to authenticated;
grant update (scheduled_at, completed_at, cancelled_at) on public.consultations to authenticated;
