-- NEMESIS — Sprint 2: independent rival (Kael Valkarion).
--
-- The simulation itself runs in the server game engine (TypeScript, deterministic,
-- seeded). This migration stores its results and applies them atomically:
--   * apply_rival_days locks the rival row and only accepts a batch that starts
--     exactly where the stored state ends (optimistic concurrency), so repeated or
--     concurrent sync requests can never apply the same day twice;
--   * (rival_id, simulation_day, action_index) is unique as a second guard;
--   * every batch writes a checkpoint so long absences are processed in chunks.

create table public.rival_profiles (
  id                  uuid primary key default gen_random_uuid(),
  game_profile_id     uuid not null unique references public.game_profiles (id) on delete cascade,
  name                text not null,
  personality_seed    bigint not null,
  discipline_factor   numeric(4, 3) not null check (discipline_factor between 0 and 1),
  learning_factor     numeric(4, 3) not null check (learning_factor between 0.1 and 3),
  risk_tolerance      numeric(4, 3) not null check (risk_tolerance between 0 and 1),
  daily_minutes       integer not null check (daily_minutes between 0 and 600),
  level               integer not null default 1 check (level >= 1),
  total_xp            bigint not null default 0 check (total_xp >= 0),
  fatigue             integer not null default 0 check (fatigue between 0 and 1000),
  last_simulated_day  date not null,
  last_simulated_at   timestamptz,
  simulation_version  integer not null,
  rng_seed            bigint not null,
  created_at          timestamptz not null default now()
);

create table public.rival_actions (
  id              uuid primary key default gen_random_uuid(),
  rival_id        uuid not null references public.rival_profiles (id) on delete cascade,
  action_type     text not null check (action_type in ('STUDY', 'REST')),
  category        text check (category is null or category ~ '^[a-z_]{2,40}$'),
  planned_minutes integer not null check (planned_minutes between 0 and 600),
  difficulty      smallint not null default 0 check (difficulty between 0 and 5),
  outcome         text not null check (outcome in ('SUCCESS', 'PARTIAL', 'FAIL', 'REST')),
  grade           public.quest_grade,
  xp_awarded      integer not null check (xp_awarded >= 0),
  gold_delta      integer not null default 0,
  narrative_text  text not null check (char_length(narrative_text) <= 500),
  simulated_at    timestamptz not null default now(),
  simulation_day  date not null,
  action_index    smallint not null check (action_index >= 0),
  unique (rival_id, simulation_day, action_index)
);
create index rival_actions_rival_day_idx on public.rival_actions (rival_id, simulation_day desc, action_index);

create table public.simulation_checkpoints (
  id              uuid primary key default gen_random_uuid(),
  rival_id        uuid not null references public.rival_profiles (id) on delete cascade,
  simulation_day  date not null,
  simulation_version integer not null,
  state           jsonb not null,
  created_at      timestamptz not null default now(),
  unique (rival_id, simulation_day)
);

-- ---------------------------------------------------------------------------
-- RLS: read-only for the owner
-- ---------------------------------------------------------------------------
create or replace function public.owns_rival(p_rival_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.rival_profiles r
    join public.game_profiles gp on gp.id = r.game_profile_id
    where r.id = p_rival_id and gp.user_id = auth.uid()
  );
$$;
revoke all on function public.owns_rival(uuid) from public;
grant execute on function public.owns_rival(uuid) to authenticated, service_role;

alter table public.rival_profiles         enable row level security;
alter table public.rival_actions          enable row level security;
alter table public.simulation_checkpoints enable row level security;

create policy rival_profiles_select_own on public.rival_profiles
  for select to authenticated using (public.owns_profile(game_profile_id));
create policy rival_actions_select_own on public.rival_actions
  for select to authenticated using (public.owns_rival(rival_id));
create policy simulation_checkpoints_select_own on public.simulation_checkpoints
  for select to authenticated using (public.owns_rival(rival_id));

revoke all on public.rival_profiles, public.rival_actions, public.simulation_checkpoints from anon;
revoke insert, update, delete, truncate on public.rival_profiles, public.rival_actions, public.simulation_checkpoints from authenticated;
grant select on public.rival_profiles, public.rival_actions, public.simulation_checkpoints to authenticated;

-- ---------------------------------------------------------------------------
-- ensure_rival: create Kael (stats, skills, kingdom) for a profile. Idempotent.
-- ---------------------------------------------------------------------------
create or replace function public.ensure_rival(
  p_user_id      uuid,
  p_name         text,
  p_kingdom_name text,
  p_params       jsonb,
  p_rng_seed     bigint,
  p_version      integer,
  p_start_day    date,
  p_skill_codes  text[],
  p_stats        jsonb,
  p_resources    jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_rival_id uuid;
  v_kingdom_id uuid;
  v_code text;
  v_res public.resource_type;
begin
  select id into v_profile_id from public.game_profiles where user_id = p_user_id for update;
  if v_profile_id is null then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0001';
  end if;

  select id into v_rival_id from public.rival_profiles where game_profile_id = v_profile_id;
  if v_rival_id is not null then
    return jsonb_build_object('rival_id', v_rival_id, 'created', false);
  end if;

  insert into public.rival_profiles (
    game_profile_id, name, personality_seed, discipline_factor, learning_factor,
    risk_tolerance, daily_minutes, last_simulated_day, simulation_version, rng_seed
  ) values (
    v_profile_id, p_name, p_rng_seed,
    (p_params->>'discipline')::numeric, (p_params->>'learning')::numeric,
    (p_params->>'risk')::numeric, (p_params->>'dailyMinutes')::integer,
    p_start_day - 1, p_version, p_rng_seed
  ) returning id into v_rival_id;

  insert into public.character_stats (game_profile_id, character_type, wisdom, willpower, strategy, management, capital, compassion)
  values (
    v_profile_id, 'RIVAL',
    (p_stats->>'wisdom')::smallint, (p_stats->>'willpower')::smallint,
    (p_stats->>'strategy')::smallint, (p_stats->>'management')::smallint,
    (p_stats->>'capital')::smallint, (p_stats->>'compassion')::smallint
  ) on conflict (game_profile_id, character_type) do nothing;

  foreach v_code in array p_skill_codes loop
    insert into public.skills (game_profile_id, character_type, skill_code)
    values (v_profile_id, 'RIVAL', v_code)
    on conflict (game_profile_id, character_type, skill_code) do nothing;
  end loop;

  insert into public.kingdoms (game_profile_id, owner_type, name)
  values (v_profile_id, 'RIVAL', p_kingdom_name)
  on conflict (game_profile_id, owner_type) do nothing
  returning id into v_kingdom_id;

  if v_kingdom_id is not null then
    foreach v_res in array enum_range(null::public.resource_type) loop
      perform public.nemesis_apply_resource(
        v_profile_id, v_kingdom_id, v_res,
        coalesce((p_resources->>v_res::text)::bigint, 0),
        'RIVAL_START', 'rival_profile', v_rival_id
      );
    end loop;
  end if;

  insert into public.game_events (game_profile_id, event_type, payload)
  values (v_profile_id, 'RIVAL_APPEARED', jsonb_build_object('name', p_name, 'kingdom_name', p_kingdom_name));

  return jsonb_build_object('rival_id', v_rival_id, 'created', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- apply_rival_days: persist one simulated batch atomically.
-- p_payload = {
--   version, days: [{ day, gold_delta, actions: [{action_index, action_type, category,
--     planned_minutes, difficulty, outcome, grade, xp_awarded, gold_delta, narrative}] }],
--   final: { total_xp, fatigue, skill_xp: {code: xp} }, checkpoint: {...}
-- }
-- ---------------------------------------------------------------------------
create or replace function public.apply_rival_days(
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
  v_rival public.rival_profiles%rowtype;
  v_kingdom_id uuid;
  v_day jsonb;
  v_last_day date;
  v_count integer := 0;
  v_new_level integer;
  v_code text;
  v_xp bigint;
begin
  select id into v_profile_id from public.game_profiles where user_id = p_user_id;
  if v_profile_id is null then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0001';
  end if;

  select * into v_rival from public.rival_profiles where game_profile_id = v_profile_id for update;
  if not found then
    raise exception 'RIVAL_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Someone else already advanced the simulation: do nothing, caller reloads.
  if v_rival.last_simulated_day <> p_expected_last_day
     or v_rival.simulation_version <> (p_payload->>'version')::integer then
    return jsonb_build_object('status', 'stale', 'last_simulated_day', v_rival.last_simulated_day);
  end if;

  if jsonb_array_length(coalesce(p_payload->'days', '[]'::jsonb)) = 0 then
    return jsonb_build_object('status', 'noop', 'last_simulated_day', v_rival.last_simulated_day);
  end if;

  select id into v_kingdom_id from public.kingdoms where game_profile_id = v_profile_id and owner_type = 'RIVAL';
  v_last_day := v_rival.last_simulated_day;

  for v_day in select * from jsonb_array_elements(p_payload->'days') loop
    -- Days must be consecutive and strictly after the stored state.
    if (v_day->>'day')::date <> v_last_day + 1 then
      raise exception 'RIVAL_DAY_GAP' using errcode = 'P0001';
    end if;
    v_last_day := (v_day->>'day')::date;

    insert into public.rival_actions (
      rival_id, action_type, category, planned_minutes, difficulty, outcome, grade,
      xp_awarded, gold_delta, narrative_text, simulation_day, action_index
    )
    select
      v_rival.id, a.action_type, a.category, a.planned_minutes, a.difficulty, a.outcome, a.grade,
      a.xp_awarded, a.gold_delta, a.narrative, v_last_day, a.action_index
    from jsonb_to_recordset(v_day->'actions') as a(
      action_index smallint, action_type text, category text, planned_minutes integer,
      difficulty smallint, outcome text, grade public.quest_grade, xp_awarded integer,
      gold_delta integer, narrative text
    );
    v_count := v_count + 1;

    if v_kingdom_id is not null and coalesce((v_day->>'gold_delta')::bigint, 0) <> 0 then
      perform public.nemesis_apply_resource(
        v_profile_id, v_kingdom_id, 'gold', (v_day->>'gold_delta')::bigint,
        'RIVAL_DAY', 'rival_day', v_rival.id
      );
    end if;
  end loop;

  v_new_level := public.nemesis_level_for_xp((p_payload->'final'->>'total_xp')::bigint);

  update public.rival_profiles set
    total_xp = (p_payload->'final'->>'total_xp')::bigint,
    level = v_new_level,
    fatigue = (p_payload->'final'->>'fatigue')::integer,
    last_simulated_day = v_last_day,
    last_simulated_at = now()
  where id = v_rival.id;

  for v_code, v_xp in select key, value::bigint from jsonb_each_text(p_payload->'final'->'skill_xp') loop
    update public.skills
       set xp = v_xp, level = public.nemesis_level_for_xp(v_xp), updated_at = now()
     where game_profile_id = v_profile_id and character_type = 'RIVAL' and skill_code = v_code;
  end loop;

  insert into public.simulation_checkpoints (rival_id, simulation_day, simulation_version, state)
  values (v_rival.id, v_last_day, v_rival.simulation_version, coalesce(p_payload->'checkpoint', '{}'::jsonb))
  on conflict (rival_id, simulation_day) do update set state = excluded.state, created_at = now();

  if v_new_level > v_rival.level then
    insert into public.game_events (game_profile_id, event_type, payload)
    values (v_profile_id, 'RIVAL_LEVEL_UP', jsonb_build_object(
      'from', v_rival.level, 'to', v_new_level, 'day', v_last_day,
      'rank', public.nemesis_rank_for_level(v_new_level)
    ));
  end if;

  return jsonb_build_object('status', 'applied', 'days', v_count, 'last_simulated_day', v_last_day, 'level', v_new_level);
end;
$$;

revoke all on function public.ensure_rival(uuid, text, text, jsonb, bigint, integer, date, text[], jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.apply_rival_days(uuid, date, jsonb) from public, anon, authenticated;
grant execute on function public.ensure_rival(uuid, text, text, jsonb, bigint, integer, date, text[], jsonb, jsonb) to service_role;
grant execute on function public.apply_rival_days(uuid, date, jsonb) to service_role;
