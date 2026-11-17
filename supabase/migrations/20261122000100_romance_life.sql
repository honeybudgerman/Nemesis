-- Romance phase 2. Apply after phase 1; all existing event IDs and outcomes survive.
alter table public.court_npcs
  add column if not exists status_since_day date,
  add column if not exists absent_until_day date;

update public.court_npcs n set status_since_day = coalesce(
  (select (e.created_at at time zone u.timezone)::date from public.game_events e
    where e.game_profile_id = n.game_profile_id and e.event_type = 'COURT_RELATIONSHIP'
      and e.payload->>'npc' = n.npc_code and e.payload->>'to' = n.relationship_status
    order by e.created_at desc limit 1),
  (now() at time zone u.timezone)::date)
from public.game_profiles p join public.users u on u.id = p.user_id
where p.id = n.game_profile_id and n.status_since_day is null;

-- Every occurrence has its own ID. Keep one open occurrence per event code.
alter table public.court_events drop constraint court_events_game_profile_id_event_code_key;
create unique index court_events_open_code_uq on public.court_events (game_profile_id, event_code) where status = 'OPEN';
create index court_events_resolved_code_idx on public.court_events (game_profile_id, event_code, resolved_day desc) where status = 'RESOLVED';

-- Server-owned recurrence rules mirror CourtEventDef.cooldownDays.
create table public.court_event_rules (
  event_code text primary key,
  npc_code text not null,
  cooldown_days integer not null check (cooldown_days > 0),
  required_status text not null check (required_status in ('ROMANCE', 'PARTNER')),
  min_status_days integer not null default 0 check (min_status_days >= 0)
);
alter table public.court_event_rules enable row level security;
revoke all on public.court_event_rules from public, anon, authenticated;
grant select on public.court_event_rules to service_role;
insert into public.court_event_rules (event_code, npc_code, cooldown_days, required_status, min_status_days) values
  ('liara_partner_evening', 'liara', 7, 'PARTNER', 0),
  ('selvina_partner_evening', 'selvina', 7, 'PARTNER', 0),
  ('liara_partner_anniversary', 'liara', 30, 'PARTNER', 30),
  ('selvina_partner_anniversary', 'selvina', 30, 'PARTNER', 30);

create or replace function public.nemesis_track_court_break()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_day date;
begin
  select (now() at time zone u.timezone)::date into v_day
    from public.game_profiles p join public.users u on u.id = p.user_id
    where p.id = new.game_profile_id;
  v_day := coalesce(nullif(current_setting('nemesis.court_day', true), '')::date, v_day);
  if tg_op = 'INSERT' then
    new.status_since_day := v_day;
    return new;
  end if;
  if new.relationship_status is distinct from old.relationship_status then
    new.status_since_day := v_day;
  end if;
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

drop trigger court_track_break on public.court_npcs;
create trigger court_track_break before insert or update of relationship_status on public.court_npcs
for each row execute function public.nemesis_track_court_break();

create or replace function public.nemesis_court_apply(p_profile_id uuid, p_hero public.kingdoms, p_changes jsonb, p_ref_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n jsonb;
  v_row public.court_npcs%rowtype;
  v_r jsonb;
  v_a uuid;
  v_b uuid;
  v_res public.resource_type;
  v_delta bigint;
  v_balance bigint;
  v_morale integer;
  v_territory text;
begin
  -- 1. Lock every touched character and check versions before changing anything.
  for v_n in select * from jsonb_array_elements(coalesce(p_changes->'npcs', '[]'::jsonb)) loop
    select * into v_row from public.court_npcs
     where game_profile_id = p_profile_id and npc_code = v_n->>'code' for update;
    if v_row.id is null then
      raise exception 'NPC_NOT_AVAILABLE' using errcode = 'P0001';
    end if;
    if v_row.version <> (v_n->>'expected_version')::integer then
      return false;
    end if;
  end loop;

  -- 2. Free positions that change hands first (one holder per position).
  update public.court_npcs c set position = null
    from jsonb_array_elements(coalesce(p_changes->'npcs', '[]'::jsonb)) x
   where c.game_profile_id = p_profile_id and c.npc_code = x->>'code'
     and c.position is distinct from nullif(x->>'position', '');

  for v_n in select * from jsonb_array_elements(coalesce(p_changes->'npcs', '[]'::jsonb)) loop
    select * into v_row from public.court_npcs where game_profile_id = p_profile_id and npc_code = v_n->>'code';
    if nullif(v_n->>'position', '') is not null and not (v_n->>'position' = any (v_row.eligible_positions)) then
      raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
    end if;
    if v_n ? 'absent_until_day' and nullif(v_n->>'absent_until_day', '')::date is distinct from v_row.absent_until_day then
      if nullif(v_n->>'absent_until_day', '')::date is not null and
         (nullif(v_n->>'absent_until_day', '')::date <= nullif(current_setting('nemesis.court_day', true), '')::date
          or nullif(v_n->>'absent_until_day', '')::date > nullif(current_setting('nemesis.court_day', true), '')::date + 3) then
        raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
      end if;
    end if;
    update public.court_npcs set
      absent_until_day = case when v_n ? 'absent_until_day' then nullif(v_n->>'absent_until_day', '')::date else absent_until_day end,
      loyalty             = (v_n->'stats'->>'loyalty')::smallint,
      affection           = (v_n->'stats'->>'affection')::smallint,
      trust               = (v_n->'stats'->>'trust')::smallint,
      ambition            = (v_n->'stats'->>'ambition')::smallint,
      jealousy            = (v_n->'stats'->>'jealousy')::smallint,
      influence           = (v_n->'stats'->>'influence')::smallint,
      relationship_status = v_n->>'status',
      position            = nullif(v_n->>'position', ''),
      version             = version + 1,
      updated_at          = now()
     where id = v_row.id;
    if v_row.relationship_status <> v_n->>'status' then
      insert into public.game_events (game_profile_id, event_type, payload)
      values (p_profile_id, 'COURT_RELATIONSHIP', jsonb_build_object('npc', v_row.npc_code, 'name', v_row.name, 'from', v_row.relationship_status, 'to', v_n->>'status'));
    end if;
  end loop;

  update public.armies a set commander_npc_id = (
    select id from public.court_npcs where game_profile_id = p_profile_id and position = 'commander'
  ), updated_at = now()
   where a.kingdom_id = p_hero.id;

  -- 3. Ties between characters (deltas, clamped).
  for v_r in select * from jsonb_array_elements(coalesce(p_changes->'relations', '[]'::jsonb)) loop
    select id into v_a from public.court_npcs where game_profile_id = p_profile_id and npc_code = least(v_r->>'a', v_r->>'b');
    select id into v_b from public.court_npcs where game_profile_id = p_profile_id and npc_code = greatest(v_r->>'a', v_r->>'b');
    if v_a is null or v_b is null or v_a = v_b then
      raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
    end if;
    insert into public.court_relationships (game_profile_id, npc_a_id, npc_b_id)
    values (p_profile_id, v_a, v_b)
    on conflict (game_profile_id, npc_a_id, npc_b_id) do nothing;
    update public.court_relationships set
      affinity   = greatest(0, least(100, affinity + coalesce((v_r->>'affinity')::integer, 0))),
      rivalry    = greatest(0, least(100, rivalry + coalesce((v_r->>'rivalry')::integer, 0))),
      trust      = greatest(0, least(100, trust + coalesce((v_r->>'trust')::integer, 0))),
      updated_at = now()
     where game_profile_id = p_profile_id and npc_a_id = v_a and npc_b_id = v_b;
  end loop;

  -- 4. Resources through the ledger; never below zero.
  foreach v_res in array array['gold', 'food', 'knowledge', 'influence']::public.resource_type[] loop
    v_delta := coalesce((p_changes->'resources'->>v_res::text)::bigint, 0);
    if v_delta = 0 then
      continue;
    end if;
    select case v_res when 'gold' then gold when 'food' then food when 'knowledge' then knowledge else influence end
      into v_balance from public.kingdoms where id = p_hero.id;
    if v_balance + v_delta < 0 then
      raise exception 'INSUFFICIENT_RESOURCES' using errcode = 'P0001';
    end if;
    perform public.nemesis_apply_resource(p_profile_id, p_hero.id, v_res, v_delta, 'COURT', 'court', p_ref_id);
  end loop;

  -- 5. Army morale.
  v_morale := coalesce((p_changes->>'morale')::integer, 0);
  if v_morale <> 0 then
    update public.armies set morale = greatest(0, least(100, morale + v_morale)), updated_at = now() where kingdom_id = p_hero.id;
  end if;

  -- 6. A territory joins peacefully: only neutral or faction lands.
  v_territory := nullif(p_changes->>'territory', '');
  if v_territory is not null then
    update public.territories set owner_type = 'HERO', owner_kingdom_id = p_hero.id, faction_name = null, updated_at = now()
     where game_profile_id = p_profile_id and territory_code = v_territory and owner_type in ('NEUTRAL', 'FACTION');
    if not found then
      raise exception 'TERRITORY_UNAVAILABLE' using errcode = 'P0001';
    end if;
    insert into public.game_events (game_profile_id, event_type, payload)
    select p_profile_id, 'TERRITORY_JOINED', jsonb_build_object('territory', name)
      from public.territories where game_profile_id = p_profile_id and territory_code = v_territory;
  end if;
  return true;
end;
$$;

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
  if v_npc.absent_until_day > p_day then
    raise exception 'CHOICE_UNAVAILABLE' using errcode = 'P0001';
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

  if p_choice <> 'dismiss' and exists (select 1 from public.court_npcs n where n.game_profile_id = v_profile_id
      and n.npc_code = any(v_event.participants) and n.absent_until_day > p_day) then
    raise exception 'CHOICE_UNAVAILABLE' using errcode = 'P0001';
  end if;
  if p_choice <> 'dismiss' and exists (select 1 from public.court_event_rules r join public.court_npcs n
      on n.game_profile_id = v_profile_id and n.npc_code = r.npc_code
      where r.event_code = v_event.event_code and (n.relationship_status <> r.required_status
        or n.recruited_at is null or n.status_since_day is null or p_day - n.status_since_day < r.min_status_days)) then
    raise exception 'CHOICE_UNAVAILABLE' using errcode = 'P0001';
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

create or replace function public.court_assign(
  p_user_id  uuid,
  p_key      text,
  p_position text,
  p_npc_code text,
  p_changes  jsonb
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
  if p_position not in ('commander', 'treasurer', 'chancellor', 'envoy') then
    raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
  end if;
  if p_npc_code is not null then
    select * into v_npc from public.court_npcs where game_profile_id = v_profile_id and npc_code = p_npc_code;
    if v_npc.id is null or v_npc.recruited_at is null then
      raise exception 'NPC_NOT_AVAILABLE' using errcode = 'P0001';
    end if;
    if v_npc.absent_until_day > (select (now() at time zone u.timezone)::date from public.users u where u.id = p_user_id) then
      raise exception 'CHOICE_UNAVAILABLE' using errcode = 'P0001';
    end if;
    if not (p_position = any (v_npc.eligible_positions)) then
      raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
    end if;
  end if;

  if not public.nemesis_court_apply(v_profile_id, v_hero, p_changes, v_npc.id) then
    return jsonb_build_object('status', 'stale');
  end if;
  -- The change set must leave exactly the requested holder in place.
  if p_npc_code is not null and not exists (
    select 1 from public.court_npcs where game_profile_id = v_profile_id and npc_code = p_npc_code and position = p_position
  ) then
    raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
  end if;
  if p_npc_code is null and exists (
    select 1 from public.court_npcs where game_profile_id = v_profile_id and position = p_position
  ) then
    raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
  end if;

  v_result := jsonb_build_object('status', 'applied', 'position', p_position, 'npc', p_npc_code);
  insert into public.court_actions (game_profile_id, idempotency_key, action_type, result)
  values (v_profile_id, p_key, 'ASSIGN', v_result);
  insert into public.game_events (game_profile_id, event_type, payload)
  values (v_profile_id, 'POSITION_ASSIGNED', jsonb_build_object('position', p_position, 'npc', p_npc_code, 'name', v_npc.name));
  return v_result;
end;
$$;

create or replace function public.open_court_event_with_mode(
  p_user_id uuid, p_day date, p_code text, p_participants text[], p_choices jsonb, p_max_open integer, p_manual boolean
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_hero public.kingdoms;
  v_id uuid;
  v_previous public.court_events%rowtype;
  v_rule public.court_event_rules%rowtype;
  v_repeat boolean := false;
begin
  v_hero := public.nemesis_hero_kingdom(p_user_id);
  perform 1 from public.game_profiles where id = v_hero.game_profile_id for update;
  select id into v_id from public.court_events where game_profile_id = v_hero.game_profile_id
    and event_code = p_code and status = 'OPEN';
  if found then return jsonb_build_object('status', 'exists', 'id', v_id); end if;
  if exists (select 1 from public.court_events where game_profile_id = v_hero.game_profile_id and event_day = p_day) then
    return jsonb_build_object('status', 'exists');
  end if;
  if (select count(*) from public.court_events where game_profile_id = v_hero.game_profile_id and status = 'OPEN') >= least(p_max_open, 2) then
    return jsonb_build_object('status', 'full');
  end if;
  if exists (select 1 from public.court_npcs n where n.game_profile_id = v_hero.game_profile_id
      and n.npc_code = any(p_participants) and n.absent_until_day > p_day) then
    return jsonb_build_object('status', 'unavailable');
  end if;
  select * into v_rule from public.court_event_rules where event_code = p_code;
  if found and not exists (select 1 from public.court_npcs n where n.game_profile_id = v_hero.game_profile_id
      and n.npc_code = v_rule.npc_code and n.recruited_at is not null
      and n.relationship_status = v_rule.required_status and n.status_since_day is not null
      and p_day - n.status_since_day >= v_rule.min_status_days) then
    return jsonb_build_object('status', 'unavailable');
  end if;
  select * into v_previous from public.court_events where game_profile_id = v_hero.game_profile_id
    and event_code = p_code and status = 'RESOLVED' order by resolved_day desc, created_at desc limit 1;
  if found then
    v_repeat := v_rule.cooldown_days is not null and p_day - v_previous.resolved_day >= v_rule.cooldown_days;
    if p_code in ('liara_reconcile', 'selvina_reconcile') then
      v_repeat := exists (select 1 from public.court_npcs n where n.game_profile_id = v_hero.game_profile_id
        and n.npc_code = split_part(p_code, '_', 1) and n.broken_since_day >= v_previous.resolved_day
        and p_day - n.broken_since_day >= 7 and n.affection >= 65 and n.trust >= 55
        and n.relationship_status not in ('ROMANCE', 'PARTNER'));
    elsif p_code in ('liara_commitment', 'selvina_commitment') then
      v_repeat := exists (select 1 from public.court_events e where e.game_profile_id = v_hero.game_profile_id
        and e.event_code = split_part(p_code, '_', 1) || '_reconcile' and e.status = 'RESOLVED'
        and e.selected_choice = 'reconcile' and e.resolved_day > v_previous.resolved_day);
    end if;
    if not coalesce(v_repeat, false) then return jsonb_build_object('status', 'exists'); end if;
  end if;
  insert into public.court_events (game_profile_id, event_code, event_day, participants, choices, opened_manually)
    values (v_hero.game_profile_id, p_code, p_day, p_participants, p_choices, p_manual) returning id into v_id;
  return jsonb_build_object('status', 'opened', 'id', v_id);
end;
$$;

revoke all on function public.nemesis_court_apply(uuid, public.kingdoms, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.nemesis_track_court_break() from public, anon, authenticated;
revoke all on function public.court_interact(uuid, text, text, text, date, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.court_choose(uuid, text, uuid, text, date, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.court_assign(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.open_court_event_with_mode(uuid, date, text, text[], jsonb, integer, boolean) from public, anon, authenticated;
