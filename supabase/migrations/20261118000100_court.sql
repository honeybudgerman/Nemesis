-- NEMESIS — Sprint 5: the royal court (ТЗ §5.14–5.16, §12).
--
-- Same rules as before: users only SELECT their own rows; every change goes
-- through SECURITY DEFINER functions callable by service_role only. Each
-- action locks the hero kingdom row, is idempotent by key, checks optimistic
-- versions of the characters it changes and writes game_events. The server
-- (game engine) computes the numbers; the AI only ever writes dialogue text.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.court_npcs (
  id                   uuid primary key default gen_random_uuid(),
  game_profile_id      uuid not null references public.game_profiles (id) on delete cascade,
  kingdom_id           uuid not null references public.kingdoms (id) on delete cascade,
  npc_code             text not null check (npc_code ~ '^[a-z_]{2,40}$'),
  name                 text not null check (char_length(name) between 1 and 60),
  age                  smallint not null check (age >= 18),
  role                 text not null check (role in ('companion', 'general', 'advisor', 'steward', 'courtier')),
  personality          jsonb not null default '{}'::jsonb,
  eligible_positions   text[] not null default '{}',
  loyalty              smallint not null check (loyalty between 0 and 100),
  affection            smallint not null check (affection between 0 and 100),
  trust                smallint not null check (trust between 0 and 100),
  ambition             smallint not null check (ambition between 0 and 100),
  jealousy             smallint not null check (jealousy between 0 and 100),
  influence            smallint not null check (influence between 0 and 100),
  relationship_status  text not null default 'STRANGERS'
                       check (relationship_status in ('STRANGERS', 'ACQUAINTED', 'FRIENDS', 'CLOSE', 'ROMANCE', 'PARTNER', 'BROKEN')),
  position             text check (position is null or position in ('commander', 'treasurer', 'chancellor', 'envoy')),
  recruited_at         timestamptz,
  last_interaction_day date,
  version              integer not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (game_profile_id, npc_code)
);
-- One holder per position.
create unique index court_npcs_position_uq on public.court_npcs (game_profile_id, position) where position is not null;

create table public.court_relationships (
  id                uuid primary key default gen_random_uuid(),
  game_profile_id   uuid not null references public.game_profiles (id) on delete cascade,
  npc_a_id          uuid not null references public.court_npcs (id) on delete cascade,
  npc_b_id          uuid not null references public.court_npcs (id) on delete cascade,
  relationship_type text not null default 'neutral' check (char_length(relationship_type) <= 30),
  affinity          smallint not null default 30 check (affinity between 0 and 100),
  rivalry           smallint not null default 10 check (rivalry between 0 and 100),
  trust             smallint not null default 30 check (trust between 0 and 100),
  updated_at        timestamptz not null default now(),
  check (npc_a_id <> npc_b_id),
  unique (game_profile_id, npc_a_id, npc_b_id)
);

create table public.court_events (
  id              uuid primary key default gen_random_uuid(),
  game_profile_id uuid not null references public.game_profiles (id) on delete cascade,
  event_code      text not null check (event_code ~ '^[a-z0-9_]{2,60}$'),
  event_day       date not null,
  participants    text[] not null default '{}',
  choices         jsonb not null default '[]'::jsonb,
  status          text not null default 'OPEN' check (status in ('OPEN', 'RESOLVED')),
  selected_choice text,
  outcome         jsonb,
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  resolved_day    date,
  unique (game_profile_id, event_code)
);
create index court_events_day_idx on public.court_events (game_profile_id, event_day);

create table public.court_messages (
  id              uuid primary key default gen_random_uuid(),
  game_profile_id uuid not null references public.game_profiles (id) on delete cascade,
  npc_id          uuid not null references public.court_npcs (id) on delete cascade,
  action          text not null check (action in ('talk', 'counsel', 'gift', 'walk')),
  content         text not null check (char_length(content) between 1 and 1200),
  source          text not null check (source in ('AI', 'FALLBACK')),
  created_at      timestamptz not null default now()
);
create index court_messages_npc_idx on public.court_messages (npc_id, created_at desc);

create table public.court_actions (
  id              uuid primary key default gen_random_uuid(),
  game_profile_id uuid not null references public.game_profiles (id) on delete cascade,
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9:_-]{8,100}$'),
  action_type     text not null check (action_type in ('INTERACT', 'CHOOSE', 'ASSIGN')),
  result          jsonb not null,
  created_at      timestamptz not null default now(),
  unique (game_profile_id, idempotency_key)
);

-- The army's commander is a court character (ТЗ §5.12).
alter table public.armies
  add constraint armies_commander_npc_fk foreign key (commander_npc_id) references public.court_npcs (id) on delete set null;

-- Court dialogues go through the same AI gateway and limits.
alter table public.ai_usage_logs drop constraint if exists ai_usage_logs_kind_check;
alter table public.ai_usage_logs add constraint ai_usage_logs_kind_check
  check (kind in ('MENTOR_CHAT', 'EVALUATE', 'GENERATE_QUESTS', 'COURT_DIALOGUE'));

-- ---------------------------------------------------------------------------
-- RLS: read own rows only.
-- ---------------------------------------------------------------------------
alter table public.court_npcs enable row level security;
alter table public.court_relationships enable row level security;
alter table public.court_events enable row level security;
alter table public.court_messages enable row level security;
alter table public.court_actions enable row level security;

create policy court_npcs_select_own on public.court_npcs for select to authenticated using (public.owns_profile(game_profile_id));
create policy court_relationships_select_own on public.court_relationships for select to authenticated using (public.owns_profile(game_profile_id));
create policy court_events_select_own on public.court_events for select to authenticated using (public.owns_profile(game_profile_id));
create policy court_messages_select_own on public.court_messages for select to authenticated using (public.owns_profile(game_profile_id));
create policy court_actions_select_own on public.court_actions for select to authenticated using (public.owns_profile(game_profile_id));

revoke all on public.court_npcs, public.court_relationships, public.court_events, public.court_messages, public.court_actions from anon;
revoke insert, update, delete, truncate on public.court_npcs, public.court_relationships, public.court_events, public.court_messages, public.court_actions from authenticated;
grant select on public.court_npcs, public.court_relationships, public.court_events, public.court_messages, public.court_actions to authenticated;
grant all on public.court_npcs, public.court_relationships, public.court_events, public.court_messages, public.court_actions to service_role;

-- ---------------------------------------------------------------------------
-- Internal: apply a change set computed by the engine.
-- p_changes = {
--   npcs: [{code, expected_version, stats:{loyalty,...}, status, position}],
--   relations: [{a, b, affinity, rivalry, trust}]   -- deltas
--   resources: {gold, food, knowledge, influence}   -- signed deltas
--   morale: int, territory: code|null }
-- Returns false (and changes nothing) when any character changed meanwhile.
-- ---------------------------------------------------------------------------
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
    update public.court_npcs set
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

-- ---------------------------------------------------------------------------
-- ensure_court: seed the characters once per profile (idempotent).
-- p_npcs = [{code, name, age, role, personality, positions, stats{...}, recruited}]
-- p_relations = [{a, b, type, affinity, rivalry, trust}]
-- ---------------------------------------------------------------------------
create or replace function public.ensure_court(p_user_id uuid, p_npcs jsonb, p_relations jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hero public.kingdoms;
  v_n jsonb;
  v_r jsonb;
begin
  v_hero := public.nemesis_hero_kingdom(p_user_id);
  if exists (select 1 from public.court_npcs where game_profile_id = v_hero.game_profile_id) then
    return jsonb_build_object('created', false);
  end if;
  if jsonb_array_length(p_npcs) > 10 then
    raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
  end if;
  for v_n in select * from jsonb_array_elements(p_npcs) loop
    insert into public.court_npcs (
      game_profile_id, kingdom_id, npc_code, name, age, role, personality, eligible_positions,
      loyalty, affection, trust, ambition, jealousy, influence, recruited_at
    ) values (
      v_hero.game_profile_id, v_hero.id, v_n->>'code', v_n->>'name', (v_n->>'age')::smallint, v_n->>'role',
      coalesce(v_n->'personality', '{}'::jsonb),
      array(select jsonb_array_elements_text(coalesce(v_n->'positions', '[]'::jsonb))),
      (v_n->'stats'->>'loyalty')::smallint, (v_n->'stats'->>'affection')::smallint, (v_n->'stats'->>'trust')::smallint,
      (v_n->'stats'->>'ambition')::smallint, (v_n->'stats'->>'jealousy')::smallint, (v_n->'stats'->>'influence')::smallint,
      case when coalesce((v_n->>'recruited')::boolean, false) then now() end
    );
  end loop;
  for v_r in select * from jsonb_array_elements(p_relations) loop
    insert into public.court_relationships (game_profile_id, npc_a_id, npc_b_id, relationship_type, affinity, rivalry, trust)
    select v_hero.game_profile_id, a.id, b.id, v_r->>'type', (v_r->>'affinity')::smallint, (v_r->>'rivalry')::smallint, (v_r->>'trust')::smallint
      from public.court_npcs a, public.court_npcs b
     where a.game_profile_id = v_hero.game_profile_id and b.game_profile_id = v_hero.game_profile_id
       and a.npc_code = least(v_r->>'a', v_r->>'b') and b.npc_code = greatest(v_r->>'a', v_r->>'b');
  end loop;
  insert into public.game_events (game_profile_id, event_type, payload)
  values (v_hero.game_profile_id, 'COURT_FOUNDED', jsonb_build_object('npcs', jsonb_array_length(p_npcs)));
  return jsonb_build_object('created', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- court_recruit: secondary characters join when the engine says their
-- condition is met (idempotent: already recruited ones are untouched).
-- ---------------------------------------------------------------------------
create or replace function public.court_recruit(p_user_id uuid, p_codes text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hero public.kingdoms;
  v_joined text[];
begin
  v_hero := public.nemesis_hero_kingdom(p_user_id);
  with joined as (
    update public.court_npcs set recruited_at = now(), updated_at = now(), version = version + 1
     where game_profile_id = v_hero.game_profile_id and npc_code = any (p_codes) and recruited_at is null
    returning npc_code, name
  ), ev as (
    insert into public.game_events (game_profile_id, event_type, payload)
    select v_hero.game_profile_id, 'COURT_JOINED', jsonb_build_object('npc', npc_code, 'name', name) from joined
    returning 1
  )
  select coalesce(array_agg(npc_code), '{}') into v_joined from joined;
  return jsonb_build_object('joined', to_jsonb(v_joined));
end;
$$;

-- ---------------------------------------------------------------------------
-- court_interact: one interaction per character per local day.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- open_court_event: at most one new event per local day, at most p_max_open
-- waiting at once, and each event only once per profile.
-- ---------------------------------------------------------------------------
create or replace function public.open_court_event(
  p_user_id      uuid,
  p_day          date,
  p_code         text,
  p_participants text[],
  p_choices      jsonb,
  p_max_open     integer
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
  if exists (select 1 from public.court_events where game_profile_id = v_hero.game_profile_id and event_day = p_day) then
    return jsonb_build_object('status', 'exists');
  end if;
  if (select count(*) from public.court_events where game_profile_id = v_hero.game_profile_id and status = 'OPEN') >= p_max_open then
    return jsonb_build_object('status', 'full');
  end if;
  insert into public.court_events (game_profile_id, event_code, event_day, participants, choices)
  values (v_hero.game_profile_id, p_code, p_day, p_participants, p_choices)
  on conflict (game_profile_id, event_code) do nothing
  returning id into v_id;
  return jsonb_build_object('status', case when v_id is null then 'exists' else 'opened' end, 'id', v_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- court_choose: resolve a waiting event with one of its offered choices.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- court_assign: appoint (or remove) the holder of a position.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function public.nemesis_court_apply(uuid, public.kingdoms, jsonb, uuid) from public, anon, authenticated;

revoke all on function public.ensure_court(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.court_recruit(uuid, text[]) from public, anon, authenticated;
revoke all on function public.court_interact(uuid, text, text, text, date, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.open_court_event(uuid, date, text, text[], jsonb, integer) from public, anon, authenticated;
revoke all on function public.court_choose(uuid, text, uuid, text, date, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.court_assign(uuid, text, text, text, jsonb) from public, anon, authenticated;

grant execute on function public.ensure_court(uuid, jsonb, jsonb) to service_role;
grant execute on function public.court_recruit(uuid, text[]) to service_role;
grant execute on function public.court_interact(uuid, text, text, text, date, jsonb, jsonb) to service_role;
grant execute on function public.open_court_event(uuid, date, text, text[], jsonb, integer) to service_role;
grant execute on function public.court_choose(uuid, text, uuid, text, date, jsonb, jsonb) to service_role;
grant execute on function public.court_assign(uuid, text, text, text, jsonb) to service_role;
