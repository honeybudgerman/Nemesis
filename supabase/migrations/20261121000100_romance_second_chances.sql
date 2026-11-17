-- Phase 1: relationship history survives friendship recovery and subsequent breaks.
alter table public.court_npcs add column if not exists broken_since_day date;

-- Use the last recorded status transition for existing saves. Dates are local days.
update public.court_npcs n set broken_since_day = coalesce(
  (select (e.created_at at time zone u.timezone)::date
   from public.game_events e
   where e.game_profile_id = n.game_profile_id and e.event_type = 'COURT_RELATIONSHIP'
     and e.payload->>'npc' = n.npc_code and e.payload->>'to' = 'BROKEN'
   order by e.created_at desc limit 1),
  (now() at time zone u.timezone)::date)
from public.game_profiles p join public.users u on u.id = p.user_id
where p.id = n.game_profile_id and n.relationship_status = 'BROKEN' and n.broken_since_day is null;

-- Preserve a past break even when the old engine has already restored FRIENDS/CLOSE.
update public.court_npcs n set broken_since_day = (e.created_at at time zone u.timezone)::date
from public.game_profiles p join public.users u on u.id = p.user_id,
lateral (select distinct on (game_profile_id, payload->>'npc') game_profile_id, payload, created_at
         from public.game_events where event_type = 'COURT_RELATIONSHIP'
           and payload->>'to' in ('BROKEN', 'ROMANCE', 'PARTNER')
         order by game_profile_id, payload->>'npc', created_at desc) e
where p.id = n.game_profile_id and e.game_profile_id = n.game_profile_id
  and e.payload->>'npc' = n.npc_code and e.payload->>'to' = 'BROKEN'
  and n.relationship_status not in ('ROMANCE', 'PARTNER') and n.broken_since_day is null;

create or replace function public.nemesis_track_court_break()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_day date;
begin
  select (now() at time zone u.timezone)::date into v_day
    from public.game_profiles p join public.users u on u.id = p.user_id
    where p.id = new.game_profile_id;
  v_day := coalesce(nullif(current_setting('nemesis.court_day', true), '')::date, v_day);
  if new.relationship_status = 'BROKEN' and old.relationship_status <> 'BROKEN' then
    new.broken_since_day := v_day;
  elsif new.relationship_status in ('ROMANCE', 'PARTNER') and old.relationship_status not in ('ROMANCE', 'PARTNER') then
    if old.broken_since_day is not null and
       (v_day - old.broken_since_day < 7 or old.affection < 65 or old.trust < 55) then
      raise exception 'CHOICE_UNAVAILABLE' using errcode = 'P0001';
    end if;
    new.broken_since_day := null;
  end if;
  return new;
end;
$$;
revoke all on function public.nemesis_track_court_break() from public, anon, authenticated;
drop trigger if exists court_track_break on public.court_npcs;
create trigger court_track_break before update of relationship_status on public.court_npcs
for each row execute function public.nemesis_track_court_break();

create or replace function public.court_interact(
  p_user_id  uuid,
  p_key      text,
  p_npc_code text,
  p_action   text,
  p_day      date,
  p_changes  jsonb,
  p_message  jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hero public.kingdoms;
  v_profile_id uuid;
  v_prev jsonb;
  v_npc public.court_npcs%rowtype;
  v_result jsonb;
begin
  v_hero := public.nemesis_hero_kingdom(p_user_id);
  v_profile_id := v_hero.game_profile_id;
  select result into v_prev from public.court_actions where game_profile_id = v_profile_id and idempotency_key = p_key;
  if v_prev is not null then
    return v_prev || jsonb_build_object('status', 'duplicate');
  end if;
  if p_action not in ('talk', 'counsel', 'gift', 'walk') then
    raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
  end if;

  select * into v_npc from public.court_npcs where game_profile_id = v_profile_id and npc_code = p_npc_code for update;
  if v_npc.id is null or v_npc.recruited_at is null then
    raise exception 'NPC_NOT_AVAILABLE' using errcode = 'P0001';
  end if;
  if v_npc.last_interaction_day is not distinct from p_day then
    raise exception 'ALREADY_INTERACTED' using errcode = 'P0001';
  end if;

  perform set_config('nemesis.court_day', p_day::text, true);
  if not public.nemesis_court_apply(v_profile_id, v_hero, p_changes, v_npc.id) then
    return jsonb_build_object('status', 'stale');
  end if;
  update public.court_npcs set last_interaction_day = p_day where id = v_npc.id;
  insert into public.court_messages (game_profile_id, npc_id, action, content, source)
  values (v_profile_id, v_npc.id, p_action, left(p_message->>'content', 1200), p_message->>'source');

  v_result := jsonb_build_object('status', 'applied', 'npc', p_npc_code, 'action', p_action);
  insert into public.court_actions (game_profile_id, idempotency_key, action_type, result)
  values (v_profile_id, p_key, 'INTERACT', v_result);
  return v_result;
end;
$$;

create or replace function public.court_choose(
  p_user_id  uuid,
  p_key      text,
  p_event_id uuid,
  p_choice   text,
  p_day      date,
  p_changes  jsonb,
  p_outcome  jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hero public.kingdoms;
  v_profile_id uuid;
  v_prev jsonb;
  v_event public.court_events%rowtype;
  v_result jsonb;
begin
  v_hero := public.nemesis_hero_kingdom(p_user_id);
  v_profile_id := v_hero.game_profile_id;
  select result into v_prev from public.court_actions where game_profile_id = v_profile_id and idempotency_key = p_key;
  if v_prev is not null then
    return v_prev || jsonb_build_object('status', 'duplicate');
  end if;

  select * into v_event from public.court_events where id = p_event_id and game_profile_id = v_profile_id for update;
  if v_event.id is null or v_event.status <> 'OPEN' then
    raise exception 'EVENT_NOT_OPEN' using errcode = 'P0001';
  end if;
  if not (v_event.choices @> jsonb_build_array(jsonb_build_object('code', p_choice))) then
    raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
  end if;

  perform set_config('nemesis.court_day', p_day::text, true);
  if not public.nemesis_court_apply(v_profile_id, v_hero, p_changes, v_event.id) then
    return jsonb_build_object('status', 'stale');
  end if;
  update public.court_events set
    status = 'RESOLVED', selected_choice = p_choice, outcome = p_outcome, resolved_at = now(), resolved_day = p_day
   where id = v_event.id;

  v_result := jsonb_build_object('status', 'applied', 'event', v_event.event_code, 'choice', p_choice);
  insert into public.court_actions (game_profile_id, idempotency_key, action_type, result)
  values (v_profile_id, p_key, 'CHOOSE', v_result);
  insert into public.game_events (game_profile_id, event_type, payload)
  values (v_profile_id, 'COURT_EVENT', jsonb_build_object('code', v_event.event_code, 'title', p_outcome->>'title', 'choice', p_outcome->>'choice'));
  return v_result;
end;
$$;

create or replace function public.open_court_event_with_mode(
  p_user_id      uuid,
  p_day          date,
  p_code         text,
  p_participants text[],
  p_choices      jsonb,
  p_max_open     integer,
  p_manual       boolean
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hero public.kingdoms;
  v_id uuid;
begin
  v_hero := public.nemesis_hero_kingdom(p_user_id);
  -- Serialize manual and scheduled openings for the same player.
  perform 1 from public.game_profiles where id = v_hero.game_profile_id for update;

  select id into v_id from public.court_events
    where game_profile_id = v_hero.game_profile_id and event_code = p_code and status = 'OPEN';
  if found then
    return jsonb_build_object('status', 'exists', 'id', v_id);
  end if;
  if exists (select 1 from public.court_events where game_profile_id = v_hero.game_profile_id and event_day = p_day) then
    return jsonb_build_object('status', 'exists');
  end if;
  if (select count(*) from public.court_events where game_profile_id = v_hero.game_profile_id and status = 'OPEN') >= least(p_max_open, 2) then
    return jsonb_build_object('status', 'full');
  end if;
  insert into public.court_events (game_profile_id, event_code, event_day, participants, choices, opened_manually)
  values (v_hero.game_profile_id, p_code, p_day, p_participants, p_choices, p_manual)
  on conflict (game_profile_id, event_code) do update set
    event_day = excluded.event_day, status = 'OPEN', selected_choice = null, outcome = null,
    resolved_at = null, resolved_day = null, choices = excluded.choices,
    participants = excluded.participants, opened_manually = excluded.opened_manually
  where court_events.status = 'RESOLVED' and (
    (p_code in ('liara_reconcile', 'selvina_reconcile')
    and exists (select 1 from public.court_npcs n
      where n.game_profile_id = v_hero.game_profile_id
        and n.npc_code = split_part(p_code, '_', 1)
        and n.broken_since_day >= court_events.resolved_day
        and p_day - n.broken_since_day >= 7
        and n.affection >= 65 and n.trust >= 55
        and n.relationship_status not in ('ROMANCE', 'PARTNER')))
    or (p_code in ('liara_commitment', 'selvina_commitment') and exists (
      select 1 from public.court_events r where r.game_profile_id = v_hero.game_profile_id
        and r.event_code = split_part(p_code, '_', 1) || '_reconcile'
        and r.status = 'RESOLVED' and r.selected_choice = 'reconcile'
        and r.resolved_day > court_events.resolved_day))
  )
  returning id into v_id;
  return jsonb_build_object('status', case when v_id is null then 'exists' else 'opened' end, 'id', v_id);
end;
$$;
