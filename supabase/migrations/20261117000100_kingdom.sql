-- NEMESIS — Sprint 4: kingdom map, buildings, army, battles (ТЗ §5.10–5.13, §10, §11).
--
-- Same rules as before: users only SELECT their own rows; every change goes
-- through SECURITY DEFINER functions callable by service_role only. Each
-- action locks the hero kingdom row, is idempotent by key, never lets a
-- resource go negative and writes resource_ledger + game_events.

alter table public.kingdoms add column if not exists last_economy_day date;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.territories (
  id                  uuid primary key default gen_random_uuid(),
  game_profile_id     uuid not null references public.game_profiles (id) on delete cascade,
  map_code            text not null,
  territory_code      text not null check (territory_code ~ '^[a-z_]{2,40}$'),
  name                text not null check (char_length(name) between 1 and 60),
  owner_type          text not null check (owner_type in ('HERO', 'RIVAL', 'NEUTRAL', 'FACTION')),
  owner_kingdom_id    uuid references public.kingdoms (id) on delete set null,
  faction_name        text check (faction_name is null or char_length(faction_name) <= 60),
  terrain_type        text not null check (terrain_type in ('plains', 'forest', 'hills', 'mountains', 'river', 'coast')),
  resource_type       text not null check (resource_type in ('gold', 'food', 'knowledge', 'influence')),
  fortification_level smallint not null default 0 check (fortification_level between 0 and 5),
  garrison_strength   integer not null default 0 check (garrison_strength >= 0),
  pos_x               smallint not null,
  pos_y               smallint not null,
  neighbors           text[] not null default '{}',
  updated_at          timestamptz not null default now(),
  unique (game_profile_id, territory_code)
);

create table public.buildings (
  id                  uuid primary key default gen_random_uuid(),
  kingdom_id          uuid not null references public.kingdoms (id) on delete cascade,
  territory_id        uuid not null references public.territories (id) on delete cascade,
  building_type       text not null check (building_type in ('castle', 'farm', 'market', 'barracks', 'academy', 'palace')),
  level               smallint not null check (level between 1 and 10),
  construction_status text not null check (construction_status in ('BUILDING', 'COMPLETED')),
  started_at          timestamptz not null default now(),
  completed_at        timestamptz not null,
  unique (territory_id, building_type)
);
create index buildings_kingdom_idx on public.buildings (kingdom_id);

create table public.armies (
  id               uuid primary key default gen_random_uuid(),
  kingdom_id       uuid not null unique references public.kingdoms (id) on delete cascade,
  territory_id     uuid references public.territories (id) on delete set null,
  commander_npc_id uuid,
  morale           smallint not null default 80 check (morale between 0 and 100),
  updated_at       timestamptz not null default now()
);

create table public.army_units (
  id        uuid primary key default gen_random_uuid(),
  army_id   uuid not null references public.armies (id) on delete cascade,
  unit_type text not null check (unit_type in ('infantry', 'archers', 'cavalry', 'mages', 'royal_guard')),
  quantity  integer not null default 0 check (quantity >= 0),
  tier      smallint not null default 1 check (tier between 1 and 3),
  unique (army_id, unit_type)
);

create table public.battles (
  id                  uuid primary key default gen_random_uuid(),
  game_profile_id     uuid not null references public.game_profiles (id) on delete cascade,
  attacker_kingdom_id uuid references public.kingdoms (id) on delete set null,
  defender_kingdom_id uuid references public.kingdoms (id) on delete set null,
  attacker_side       text not null check (attacker_side in ('HERO', 'RIVAL')),
  defender_side       text not null check (defender_side in ('HERO', 'RIVAL', 'NEUTRAL', 'FACTION')),
  territory_id        uuid references public.territories (id) on delete set null,
  territory_code      text not null,
  attacker_snapshot   jsonb not null default '{}'::jsonb,
  defender_snapshot   jsonb not null default '{}'::jsonb,
  battle_seed         bigint not null,
  tactic              text,
  result              text not null check (result in ('ATTACKER_WON', 'DEFENDER_WON')),
  casualties          jsonb not null default '{}'::jsonb,
  rewards             jsonb not null default '{}'::jsonb,
  simulation_day      date,
  resolved_at         timestamptz not null default now()
);
create index battles_profile_time_idx on public.battles (game_profile_id, resolved_at desc);

-- Idempotency for kingdom actions: a repeated request returns the first result.
create table public.kingdom_actions (
  id              uuid primary key default gen_random_uuid(),
  game_profile_id uuid not null references public.game_profiles (id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 100),
  action_type     text not null check (action_type in ('BUILD', 'RECRUIT', 'ATTACK')),
  result          jsonb not null,
  created_at      timestamptz not null default now(),
  unique (game_profile_id, idempotency_key)
);

-- ---------------------------------------------------------------------------
-- RLS: read own rows only.
-- ---------------------------------------------------------------------------
create or replace function public.owns_kingdom(p_kingdom_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.kingdoms k
      join public.game_profiles gp on gp.id = k.game_profile_id
     where k.id = p_kingdom_id and gp.user_id = auth.uid()
  );
$$;
revoke all on function public.owns_kingdom(uuid) from public;
grant execute on function public.owns_kingdom(uuid) to authenticated, service_role;

create or replace function public.owns_army(p_army_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.armies a where a.id = p_army_id and public.owns_kingdom(a.kingdom_id));
$$;
revoke all on function public.owns_army(uuid) from public;
grant execute on function public.owns_army(uuid) to authenticated, service_role;

alter table public.territories enable row level security;
alter table public.buildings enable row level security;
alter table public.armies enable row level security;
alter table public.army_units enable row level security;
alter table public.battles enable row level security;
alter table public.kingdom_actions enable row level security;

create policy territories_select_own on public.territories for select to authenticated using (public.owns_profile(game_profile_id));
create policy buildings_select_own on public.buildings for select to authenticated using (public.owns_kingdom(kingdom_id));
create policy armies_select_own on public.armies for select to authenticated using (public.owns_kingdom(kingdom_id));
create policy army_units_select_own on public.army_units for select to authenticated using (public.owns_army(army_id));
create policy battles_select_own on public.battles for select to authenticated using (public.owns_profile(game_profile_id));
create policy kingdom_actions_select_own on public.kingdom_actions for select to authenticated using (public.owns_profile(game_profile_id));

revoke all on public.territories, public.buildings, public.armies, public.army_units, public.battles, public.kingdom_actions from anon;
revoke insert, update, delete, truncate on public.territories, public.buildings, public.armies, public.army_units, public.battles, public.kingdom_actions from authenticated;
grant select on public.territories, public.buildings, public.armies, public.army_units, public.battles, public.kingdom_actions to authenticated;
grant all on public.territories, public.buildings, public.armies, public.army_units, public.battles, public.kingdom_actions to service_role;

-- ---------------------------------------------------------------------------
-- Helpers (internal)
-- ---------------------------------------------------------------------------
create or replace function public.nemesis_hero_kingdom(p_user_id uuid)
returns public.kingdoms
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_kingdom public.kingdoms;
begin
  select id into v_profile_id from public.game_profiles where user_id = p_user_id;
  if v_profile_id is null then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0001';
  end if;
  -- The hero kingdom row is the lock that serialises all kingdom actions.
  select * into v_kingdom from public.kingdoms where game_profile_id = v_profile_id and owner_type = 'HERO' for update;
  if v_kingdom.id is null then
    raise exception 'KINGDOM_NOT_FOUND' using errcode = 'P0001';
  end if;
  return v_kingdom;
end;
$$;

-- Finished constructions become COMPLETED (lazy, on every kingdom action).
create or replace function public.nemesis_settle_buildings(p_kingdom_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.buildings set construction_status = 'COMPLETED'
   where kingdom_id = p_kingdom_id and construction_status = 'BUILDING' and completed_at <= now();
$$;

-- Spend resources atomically or fail with INSUFFICIENT_RESOURCES (never negative).
create or replace function public.nemesis_spend(p_profile_id uuid, p_kingdom public.kingdoms, p_cost jsonb, p_reason text, p_ref_type text, p_ref_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res public.resource_type;
  v_amount bigint;
begin
  if coalesce((p_cost->>'gold')::bigint, 0) > p_kingdom.gold
     or coalesce((p_cost->>'food')::bigint, 0) > p_kingdom.food
     or coalesce((p_cost->>'knowledge')::bigint, 0) > p_kingdom.knowledge
     or coalesce((p_cost->>'influence')::bigint, 0) > p_kingdom.influence then
    raise exception 'INSUFFICIENT_RESOURCES' using errcode = 'P0001';
  end if;
  foreach v_res in array array['gold', 'food', 'knowledge', 'influence']::public.resource_type[] loop
    v_amount := coalesce((p_cost->>v_res::text)::bigint, 0);
    if v_amount < 0 then
      raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
    end if;
    if v_amount > 0 then
      perform public.nemesis_apply_resource(p_profile_id, p_kingdom.id, v_res, -v_amount, p_reason, p_ref_type, p_ref_id);
    end if;
  end loop;
end;
$$;

-- Highest COMPLETED level of a building type across the hero's lands.
create or replace function public.nemesis_building_level(p_kingdom_id uuid, p_type text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(max(b.level), 0)::integer
    from public.buildings b
    join public.territories t on t.id = b.territory_id
   where b.kingdom_id = p_kingdom_id and b.building_type = p_type
     and b.construction_status = 'COMPLETED' and t.owner_type = 'HERO';
$$;

create or replace function public.nemesis_army_json(p_army_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(unit_type, quantity) filter (where quantity > 0), '{}'::jsonb)
    from public.army_units where army_id = p_army_id;
$$;

-- ---------------------------------------------------------------------------
-- ensure_realm: create the player's map copy, castle and starting army (§10.1).
-- Idempotent; also backfills profiles created before Sprint 4.
-- ---------------------------------------------------------------------------
create or replace function public.ensure_realm(
  p_user_id   uuid,
  p_map_code  text,
  p_map       jsonb,
  p_start_day date,
  p_army      jsonb,
  p_morale    integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_hero public.kingdoms;
  v_rival_kingdom uuid;
  v_capital uuid;
  v_army uuid;
  v_t jsonb;
  v_unit text;
begin
  v_hero := public.nemesis_hero_kingdom(p_user_id);
  v_profile_id := v_hero.game_profile_id;

  if exists (select 1 from public.territories where game_profile_id = v_profile_id) then
    return jsonb_build_object('created', false);
  end if;

  select id into v_rival_kingdom from public.kingdoms where game_profile_id = v_profile_id and owner_type = 'RIVAL';

  for v_t in select * from jsonb_array_elements(p_map) loop
    insert into public.territories (
      game_profile_id, map_code, territory_code, name, owner_type, owner_kingdom_id, faction_name,
      terrain_type, resource_type, fortification_level, garrison_strength, pos_x, pos_y, neighbors
    ) values (
      v_profile_id, p_map_code, v_t->>'code', v_t->>'name', v_t->>'owner',
      case v_t->>'owner' when 'HERO' then v_hero.id when 'RIVAL' then v_rival_kingdom else null end,
      v_t->>'faction', v_t->>'terrain', v_t->>'resource',
      (v_t->>'fortification')::smallint, (v_t->>'garrison')::integer,
      (v_t->>'x')::smallint, (v_t->>'y')::smallint,
      array(select jsonb_array_elements_text(v_t->'neighbors'))
    );
  end loop;

  select id into v_capital from public.territories
   where game_profile_id = v_profile_id and owner_type = 'HERO' order by territory_code limit 1;

  insert into public.buildings (kingdom_id, territory_id, building_type, level, construction_status, completed_at)
  values (v_hero.id, v_capital, 'castle', 1, 'COMPLETED', now());

  insert into public.armies (kingdom_id, territory_id, morale)
  values (v_hero.id, v_capital, p_morale)
  on conflict (kingdom_id) do nothing
  returning id into v_army;

  if v_army is not null then
    for v_unit in select * from jsonb_object_keys(p_army) loop
      insert into public.army_units (army_id, unit_type, quantity, tier)
      values (v_army, v_unit, (p_army->>v_unit)::integer, 1);
    end loop;
  end if;

  update public.kingdoms set last_economy_day = p_start_day - 1 where id = v_hero.id;

  insert into public.game_events (game_profile_id, event_type, payload)
  values (v_profile_id, 'REALM_FOUNDED', jsonb_build_object('territories', jsonb_array_length(p_map)));

  return jsonb_build_object('created', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- apply_world_days: persist one batch of economy days + Kael's campaigns.
-- p_payload = { last_day, totals:{gold,food,knowledge,influence,command_points},
--   morale, territories:[{code, owner, garrison, fortification}],
--   campaigns:[{day, target, previous_owner, win, kael_power, defender_power, garrison_after}] }
-- ---------------------------------------------------------------------------
create or replace function public.apply_world_days(
  p_user_id           uuid,
  p_expected_last_day date,
  p_payload           jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_hero public.kingdoms;
  v_rival_kingdom uuid;
  v_res public.resource_type;
  v_delta bigint;
  v_current bigint;
  v_t jsonb;
  v_c jsonb;
  v_last date := (p_payload->>'last_day')::date;
  v_territory public.territories%rowtype;
begin
  v_hero := public.nemesis_hero_kingdom(p_user_id);
  v_profile_id := v_hero.game_profile_id;

  if v_hero.last_economy_day is distinct from p_expected_last_day then
    return jsonb_build_object('status', 'stale');
  end if;
  if v_last is null or v_last <= p_expected_last_day then
    return jsonb_build_object('status', 'noop');
  end if;

  perform public.nemesis_settle_buildings(v_hero.id);

  -- Totals; a concurrent spend may have lowered a balance, so clamp at zero.
  foreach v_res in array enum_range(null::public.resource_type) loop
    v_delta := coalesce((p_payload->'totals'->>v_res::text)::bigint, 0);
    select case v_res when 'gold' then gold when 'food' then food when 'knowledge' then knowledge
                      when 'influence' then influence else command_points end
      into v_current from public.kingdoms where id = v_hero.id;
    v_delta := greatest(v_delta, -v_current);
    if v_delta <> 0 then
      perform public.nemesis_apply_resource(v_profile_id, v_hero.id, v_res, v_delta, 'WORLD_DAYS', 'world_day', null);
    end if;
  end loop;

  update public.armies set morale = least(100, greatest(0, (p_payload->>'morale')::integer)), updated_at = now()
   where kingdom_id = v_hero.id and p_payload ? 'morale';

  select id into v_rival_kingdom from public.kingdoms where game_profile_id = v_profile_id and owner_type = 'RIVAL';

  -- Only non-hero lands can change in the world tick.
  for v_t in select * from jsonb_array_elements(coalesce(p_payload->'territories', '[]'::jsonb)) loop
    update public.territories
       set owner_type = v_t->>'owner',
           owner_kingdom_id = case when v_t->>'owner' = 'RIVAL' then v_rival_kingdom else owner_kingdom_id end,
           garrison_strength = (v_t->>'garrison')::integer,
           fortification_level = (v_t->>'fortification')::smallint,
           updated_at = now()
     where game_profile_id = v_profile_id
       and territory_code = v_t->>'code'
       and owner_type <> 'HERO'
       and v_t->>'owner' in ('RIVAL', 'NEUTRAL', 'FACTION');
  end loop;

  for v_c in select * from jsonb_array_elements(coalesce(p_payload->'campaigns', '[]'::jsonb)) loop
    select * into v_territory from public.territories where game_profile_id = v_profile_id and territory_code = v_c->>'target';
    insert into public.battles (
      game_profile_id, attacker_kingdom_id, defender_kingdom_id, attacker_side, defender_side,
      territory_id, territory_code, attacker_snapshot, defender_snapshot, battle_seed, result, simulation_day
    ) values (
      v_profile_id, v_rival_kingdom, null, 'RIVAL', v_c->>'previous_owner',
      v_territory.id, v_c->>'target',
      jsonb_build_object('power', v_c->'kael_power'), jsonb_build_object('power', v_c->'defender_power'),
      0, case when (v_c->>'win')::boolean then 'ATTACKER_WON' else 'DEFENDER_WON' end, (v_c->>'day')::date
    );
    if (v_c->>'win')::boolean then
      insert into public.game_events (game_profile_id, event_type, payload)
      values (v_profile_id, 'KAEL_CONQUEST', jsonb_build_object('territory', v_territory.name, 'day', v_c->>'day'));
    end if;
  end loop;

  update public.kingdoms set last_economy_day = v_last where id = v_hero.id;
  return jsonb_build_object('status', 'applied', 'last_day', v_last);
end;
$$;

-- ---------------------------------------------------------------------------
-- start_building: build or upgrade one building (one construction at a time).
-- ---------------------------------------------------------------------------
create or replace function public.start_building(
  p_user_id        uuid,
  p_key            text,
  p_territory_code text,
  p_type           text,
  p_level          integer,
  p_max_level      integer,
  p_capital_only   boolean,
  p_cost           jsonb,
  p_minutes        integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_hero public.kingdoms;
  v_prev jsonb;
  v_territory public.territories%rowtype;
  v_current integer;
  v_building_id uuid;
  v_result jsonb;
begin
  v_hero := public.nemesis_hero_kingdom(p_user_id);
  v_profile_id := v_hero.game_profile_id;

  select result into v_prev from public.kingdom_actions where game_profile_id = v_profile_id and idempotency_key = p_key;
  if v_prev is not null then
    return v_prev || jsonb_build_object('status', 'duplicate');
  end if;

  perform public.nemesis_settle_buildings(v_hero.id);
  if exists (select 1 from public.buildings where kingdom_id = v_hero.id and construction_status = 'BUILDING') then
    raise exception 'CONSTRUCTION_BUSY' using errcode = 'P0001';
  end if;

  select * into v_territory from public.territories
   where game_profile_id = v_profile_id and territory_code = p_territory_code;
  if v_territory.id is null or v_territory.owner_type <> 'HERO' then
    raise exception 'TERRITORY_NOT_OWNED' using errcode = 'P0001';
  end if;
  if p_capital_only and not exists (
    select 1 from public.buildings where territory_id = v_territory.id and building_type = 'castle'
  ) and p_type <> 'castle' then
    raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
  end if;
  if p_type = 'castle' and not exists (
    select 1 from public.buildings where territory_id = v_territory.id and building_type = 'castle'
  ) then
    raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
  end if;

  select level into v_current from public.buildings where territory_id = v_territory.id and building_type = p_type;
  if coalesce(v_current, 0) <> p_level - 1 then
    raise exception 'BUILD_LEVEL_MISMATCH' using errcode = 'P0001';
  end if;
  if p_level > p_max_level then
    raise exception 'BUILD_MAX_LEVEL' using errcode = 'P0001';
  end if;

  insert into public.buildings (kingdom_id, territory_id, building_type, level, construction_status, started_at, completed_at)
  values (v_hero.id, v_territory.id, p_type, p_level, 'BUILDING', now(), now() + make_interval(mins => p_minutes))
  on conflict (territory_id, building_type) do update
    set level = excluded.level, construction_status = 'BUILDING', started_at = excluded.started_at, completed_at = excluded.completed_at
  returning id into v_building_id;

  perform public.nemesis_spend(v_profile_id, v_hero, p_cost, 'BUILD', 'building', v_building_id);

  v_result := jsonb_build_object(
    'status', 'started', 'building_id', v_building_id, 'type', p_type, 'level', p_level,
    'territory', p_territory_code, 'completes_at', now() + make_interval(mins => p_minutes), 'cost', p_cost
  );
  insert into public.kingdom_actions (game_profile_id, idempotency_key, action_type, result)
  values (v_profile_id, p_key, 'BUILD', v_result);
  insert into public.game_events (game_profile_id, event_type, payload)
  values (v_profile_id, 'BUILDING_STARTED', jsonb_build_object('type', p_type, 'level', p_level, 'territory', v_territory.name));
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- recruit_units: hire troops (requirements, army cap, atomic cost).
-- ---------------------------------------------------------------------------
create or replace function public.recruit_units(
  p_user_id   uuid,
  p_key       text,
  p_unit_type text,
  p_tier      integer,
  p_quantity  integer,
  p_cost      jsonb,
  p_requires  jsonb,
  p_max_army  integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_hero public.kingdoms;
  v_prev jsonb;
  v_army public.armies%rowtype;
  v_size integer;
  v_result jsonb;
begin
  v_hero := public.nemesis_hero_kingdom(p_user_id);
  v_profile_id := v_hero.game_profile_id;

  select result into v_prev from public.kingdom_actions where game_profile_id = v_profile_id and idempotency_key = p_key;
  if v_prev is not null then
    return v_prev || jsonb_build_object('status', 'duplicate');
  end if;
  if p_quantity < 1 or p_quantity > 100 then
    raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
  end if;

  perform public.nemesis_settle_buildings(v_hero.id);
  if public.nemesis_building_level(v_hero.id, 'barracks') < coalesce((p_requires->>'barracks')::integer, 1)
     or public.nemesis_building_level(v_hero.id, 'academy') < coalesce((p_requires->>'academy')::integer, 0)
     or public.nemesis_building_level(v_hero.id, 'castle') < coalesce((p_requires->>'castle')::integer, 0) then
    raise exception 'REQUIREMENTS_NOT_MET' using errcode = 'P0001';
  end if;

  select * into v_army from public.armies where kingdom_id = v_hero.id;
  if v_army.id is null then
    raise exception 'KINGDOM_NOT_FOUND' using errcode = 'P0001';
  end if;
  select coalesce(sum(quantity), 0) into v_size from public.army_units where army_id = v_army.id;
  if v_size + p_quantity > p_max_army then
    raise exception 'ARMY_FULL' using errcode = 'P0001';
  end if;

  perform public.nemesis_spend(v_profile_id, v_hero, p_cost, 'RECRUIT', 'army', v_army.id);

  insert into public.army_units (army_id, unit_type, quantity, tier)
  values (v_army.id, p_unit_type, p_quantity, p_tier)
  on conflict (army_id, unit_type) do update set quantity = public.army_units.quantity + excluded.quantity;
  update public.armies set updated_at = now() where id = v_army.id;

  v_result := jsonb_build_object('status', 'recruited', 'unit_type', p_unit_type, 'quantity', p_quantity, 'cost', p_cost);
  insert into public.kingdom_actions (game_profile_id, idempotency_key, action_type, result)
  values (v_profile_id, p_key, 'RECRUIT', v_result);
  insert into public.game_events (game_profile_id, event_type, payload)
  values (v_profile_id, 'UNITS_RECRUITED', jsonb_build_object('unit_type', p_unit_type, 'quantity', p_quantity));
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- resolve_battle: apply a battle the server computed from the state it read.
-- If the army or the target changed in between, returns 'stale' and nothing
-- is applied (the server recomputes). Costs 1 command point.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_battle(
  p_user_id          uuid,
  p_key              text,
  p_territory_code   text,
  p_expected_army    jsonb,
  p_expected_garrison integer,
  p_battle           jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_hero public.kingdoms;
  v_prev jsonb;
  v_territory public.territories%rowtype;
  v_army public.armies%rowtype;
  v_win boolean := (p_battle->>'win')::boolean;
  v_unit text;
  v_lost integer;
  v_battle_id uuid;
  v_result jsonb;
  v_rewards jsonb := coalesce(p_battle->'rewards', '{}'::jsonb);
begin
  v_hero := public.nemesis_hero_kingdom(p_user_id);
  v_profile_id := v_hero.game_profile_id;

  select result into v_prev from public.kingdom_actions where game_profile_id = v_profile_id and idempotency_key = p_key;
  if v_prev is not null then
    return v_prev || jsonb_build_object('status', 'duplicate');
  end if;

  if v_hero.command_points < 1 then
    raise exception 'NO_COMMAND_POINTS' using errcode = 'P0001';
  end if;

  select * into v_territory from public.territories
   where game_profile_id = v_profile_id and territory_code = p_territory_code for update;
  if v_territory.id is null then
    raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
  end if;
  if v_territory.owner_type = 'HERO' or not exists (
    select 1 from public.territories h
     where h.game_profile_id = v_profile_id and h.owner_type = 'HERO'
       and h.territory_code = any (v_territory.neighbors)
  ) then
    raise exception 'TERRITORY_NOT_ADJACENT' using errcode = 'P0001';
  end if;

  select * into v_army from public.armies where kingdom_id = v_hero.id;
  if v_army.id is null or public.nemesis_army_json(v_army.id) = '{}'::jsonb then
    raise exception 'NOT_ENOUGH_ARMY' using errcode = 'P0001';
  end if;
  if public.nemesis_army_json(v_army.id) <> p_expected_army or v_territory.garrison_strength <> p_expected_garrison then
    return jsonb_build_object('status', 'stale');
  end if;

  -- Casualties (never below zero).
  for v_unit in select * from jsonb_object_keys(coalesce(p_battle->'casualties', '{}'::jsonb)) loop
    v_lost := (p_battle->'casualties'->>v_unit)::integer;
    update public.army_units set quantity = greatest(0, quantity - v_lost)
     where army_id = v_army.id and unit_type = v_unit;
  end loop;
  update public.armies set morale = least(100, greatest(0, (p_battle->>'morale_after')::integer)), updated_at = now()
   where id = v_army.id;

  perform public.nemesis_apply_resource(v_profile_id, v_hero.id, 'command_points', -1, 'ATTACK', 'territory', v_territory.id);

  insert into public.battles (
    game_profile_id, attacker_kingdom_id, defender_kingdom_id, attacker_side, defender_side, territory_id, territory_code,
    attacker_snapshot, defender_snapshot, battle_seed, tactic, result, casualties, rewards
  ) values (
    v_profile_id, v_hero.id, v_territory.owner_kingdom_id, 'HERO', v_territory.owner_type, v_territory.id, p_territory_code,
    coalesce(p_battle->'attacker_snapshot', '{}'::jsonb), coalesce(p_battle->'defender_snapshot', '{}'::jsonb),
    (p_battle->>'seed')::bigint, p_battle->>'tactic',
    case when v_win then 'ATTACKER_WON' else 'DEFENDER_WON' end,
    coalesce(p_battle->'casualties', '{}'::jsonb), v_rewards
  ) returning id into v_battle_id;

  if v_win then
    update public.territories
       set owner_type = 'HERO', owner_kingdom_id = v_hero.id, faction_name = null,
           garrison_strength = (p_battle->>'garrison_after')::integer,
           fortification_level = (p_battle->>'fortification_after')::smallint, updated_at = now()
     where id = v_territory.id;
    perform public.nemesis_apply_resource(v_profile_id, v_hero.id, 'gold', coalesce((v_rewards->>'gold')::bigint, 0), 'BATTLE_REWARD', 'battle', v_battle_id);
    perform public.nemesis_apply_resource(v_profile_id, v_hero.id, 'food', coalesce((v_rewards->>'food')::bigint, 0), 'BATTLE_REWARD', 'battle', v_battle_id);
    perform public.nemesis_apply_resource(v_profile_id, v_hero.id, 'influence', coalesce((v_rewards->>'influence')::bigint, 0), 'BATTLE_REWARD', 'battle', v_battle_id);
  else
    update public.territories set garrison_strength = (p_battle->>'garrison_after')::integer, updated_at = now()
     where id = v_territory.id;
  end if;

  v_result := jsonb_build_object('status', 'resolved', 'battle_id', v_battle_id, 'win', v_win, 'territory', p_territory_code);
  insert into public.kingdom_actions (game_profile_id, idempotency_key, action_type, result)
  values (v_profile_id, p_key, 'ATTACK', v_result);
  insert into public.game_events (game_profile_id, event_type, payload)
  values (v_profile_id, case when v_win then 'BATTLE_WON' else 'BATTLE_LOST' end,
          jsonb_build_object('territory', v_territory.name, 'rewards', v_rewards));
  return v_result;
end;
$$;

-- Internal helpers: not callable by API roles at all.
revoke all on function public.nemesis_hero_kingdom(uuid) from public, anon, authenticated;
revoke all on function public.nemesis_settle_buildings(uuid) from public, anon, authenticated;
revoke all on function public.nemesis_spend(uuid, public.kingdoms, jsonb, text, text, uuid) from public, anon, authenticated;
revoke all on function public.nemesis_building_level(uuid, text) from public, anon, authenticated;
revoke all on function public.nemesis_army_json(uuid) from public, anon, authenticated;

revoke all on function public.ensure_realm(uuid, text, jsonb, date, jsonb, integer) from public, anon, authenticated;
revoke all on function public.apply_world_days(uuid, date, jsonb) from public, anon, authenticated;
revoke all on function public.start_building(uuid, text, text, text, integer, integer, boolean, jsonb, integer) from public, anon, authenticated;
revoke all on function public.recruit_units(uuid, text, text, integer, integer, jsonb, jsonb, integer) from public, anon, authenticated;
revoke all on function public.resolve_battle(uuid, text, text, jsonb, integer, jsonb) from public, anon, authenticated;

grant execute on function public.ensure_realm(uuid, text, jsonb, date, jsonb, integer) to service_role;
grant execute on function public.apply_world_days(uuid, date, jsonb) to service_role;
grant execute on function public.start_building(uuid, text, text, text, integer, integer, boolean, jsonb, integer) to service_role;
grant execute on function public.recruit_units(uuid, text, text, integer, integer, jsonb, jsonb, integer) to service_role;
grant execute on function public.resolve_battle(uuid, text, text, jsonb, integer, jsonb) to service_role;
