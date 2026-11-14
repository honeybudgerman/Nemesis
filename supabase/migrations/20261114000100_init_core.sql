-- NEMESIS — Sprint 1: core schema (users, profiles, stats, skills, quests,
-- completions, kingdoms, resource ledger, game events).
--
-- Security model:
--   * RLS is enabled on every table. Authenticated users may only SELECT rows
--     that belong to their own game profile.
--   * No INSERT/UPDATE/DELETE grants for anon/authenticated. Every mutation goes
--     through the SECURITY DEFINER functions below, which are executable only by
--     service_role, i.e. only from Next.js Route Handlers after the session has
--     been verified on the server.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.character_type as enum ('HERO', 'RIVAL');
create type public.quest_frequency as enum ('DAILY', 'WEEKLY', 'MONTHLY');
create type public.quest_status as enum ('PENDING', 'COMPLETED', 'SKIPPED', 'EXPIRED');
create type public.quest_source as enum ('TEMPLATE', 'AI', 'MANUAL');
create type public.evaluation_mode as enum ('SELF_REPORT', 'QUIZ', 'AI_REVIEW');
create type public.quest_grade as enum ('S', 'A', 'B', 'C', 'D', 'F');
create type public.resource_type as enum ('gold', 'food', 'knowledge', 'influence', 'command_points');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.users (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text not null check (char_length(display_name) between 1 and 40),
  timezone      text not null default 'UTC' check (char_length(timezone) between 1 and 64),
  daily_minutes integer not null default 55 check (daily_minutes between 30 and 240),
  created_at    timestamptz not null default now()
);

create table public.game_profiles (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null unique references public.users (id) on delete cascade,
  hero_name       text not null check (char_length(hero_name) between 2 and 24),
  kingdom_name    text not null check (char_length(kingdom_name) between 2 and 32),
  level           integer not null default 1 check (level >= 1),
  total_xp        bigint not null default 0 check (total_xp >= 0),
  rank            text not null default 'Наследник',
  current_chapter integer not null default 1 check (current_chapter >= 1),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.character_stats (
  id              uuid primary key default gen_random_uuid(),
  game_profile_id uuid not null references public.game_profiles (id) on delete cascade,
  character_type  public.character_type not null,
  wisdom          smallint not null default 10 check (wisdom between 0 and 100),
  willpower       smallint not null default 10 check (willpower between 0 and 100),
  strategy        smallint not null default 10 check (strategy between 0 and 100),
  management      smallint not null default 10 check (management between 0 and 100),
  capital         smallint not null default 10 check (capital between 0 and 100),
  compassion      smallint not null default 10 check (compassion between 0 and 100),
  updated_at      timestamptz not null default now(),
  unique (game_profile_id, character_type)
);

create table public.skills (
  id              uuid primary key default gen_random_uuid(),
  game_profile_id uuid not null references public.game_profiles (id) on delete cascade,
  character_type  public.character_type not null,
  skill_code      text not null check (skill_code ~ '^[a-z_]{2,40}$'),
  level           integer not null default 1 check (level >= 1),
  xp              bigint not null default 0 check (xp >= 0),
  updated_at      timestamptz not null default now(),
  unique (game_profile_id, character_type, skill_code)
);

create table public.quests (
  id                uuid primary key default gen_random_uuid(),
  game_profile_id   uuid not null references public.game_profiles (id) on delete cascade,
  template_code     text,
  title             text not null check (char_length(title) between 1 and 120),
  description       text not null default '' check (char_length(description) <= 2000),
  category          text not null check (category ~ '^[a-z_]{2,40}$'),
  frequency         public.quest_frequency not null,
  difficulty        smallint not null check (difficulty between 1 and 5),
  estimated_minutes integer not null check (estimated_minutes between 5 and 240),
  base_xp           integer not null check (base_xp between 0 and 1000),
  is_optional       boolean not null default false,
  success_criteria  jsonb not null default '[]'::jsonb check (jsonb_typeof(success_criteria) = 'array'),
  status            public.quest_status not null default 'PENDING',
  grade             public.quest_grade,
  scheduled_date    date not null,
  deadline_at       timestamptz not null,
  completed_at      timestamptz,
  source            public.quest_source not null,
  evaluation_mode   public.evaluation_mode not null default 'SELF_REPORT',
  created_at        timestamptz not null default now(),
  -- One instance of a template per period. NULL template_code (manual quests)
  -- never conflicts because NULLs are distinct.
  unique (game_profile_id, frequency, scheduled_date, template_code)
);
create index quests_profile_period_idx on public.quests (game_profile_id, frequency, scheduled_date);
create index quests_pending_deadline_idx on public.quests (game_profile_id, deadline_at) where status = 'PENDING';

create table public.quest_completions (
  id              uuid primary key default gen_random_uuid(),
  quest_id        uuid not null unique references public.quests (id) on delete cascade,
  game_profile_id uuid not null references public.game_profiles (id) on delete cascade,
  grade           public.quest_grade not null,
  awarded_xp      integer not null check (awarded_xp >= 0),
  completion_note text check (completion_note is null or char_length(completion_note) <= 1000),
  completed_at    timestamptz not null default now(),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 100),
  unique (game_profile_id, idempotency_key)
);
create index quest_completions_profile_time_idx on public.quest_completions (game_profile_id, completed_at desc);

create table public.kingdoms (
  id              uuid primary key default gen_random_uuid(),
  game_profile_id uuid not null references public.game_profiles (id) on delete cascade,
  owner_type      public.character_type not null,
  name            text not null check (char_length(name) between 2 and 32),
  gold            bigint not null default 0 check (gold >= 0),
  food            bigint not null default 0 check (food >= 0),
  knowledge       bigint not null default 0 check (knowledge >= 0),
  influence       bigint not null default 0 check (influence >= 0),
  command_points  integer not null default 0 check (command_points >= 0),
  created_at      timestamptz not null default now(),
  unique (game_profile_id, owner_type)
);

create table public.resource_ledger (
  id              uuid primary key default gen_random_uuid(),
  game_profile_id uuid not null references public.game_profiles (id) on delete cascade,
  kingdom_id      uuid not null references public.kingdoms (id) on delete cascade,
  resource        public.resource_type not null,
  delta           bigint not null,
  balance_after   bigint not null check (balance_after >= 0),
  reason          text not null,
  ref_type        text,
  ref_id          uuid,
  created_at      timestamptz not null default now()
);
create index resource_ledger_kingdom_time_idx on public.resource_ledger (kingdom_id, created_at desc);

create table public.game_events (
  id              uuid primary key default gen_random_uuid(),
  game_profile_id uuid not null references public.game_profiles (id) on delete cascade,
  event_type      text not null,
  payload         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index game_events_profile_time_idx on public.game_events (game_profile_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security: read-only access to one's own data
-- ---------------------------------------------------------------------------
create or replace function public.owns_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.game_profiles gp
    where gp.id = p_profile_id and gp.user_id = auth.uid()
  );
$$;
revoke all on function public.owns_profile(uuid) from public;
grant execute on function public.owns_profile(uuid) to authenticated, service_role;

alter table public.users             enable row level security;
alter table public.game_profiles     enable row level security;
alter table public.character_stats   enable row level security;
alter table public.skills            enable row level security;
alter table public.quests            enable row level security;
alter table public.quest_completions enable row level security;
alter table public.kingdoms          enable row level security;
alter table public.resource_ledger   enable row level security;
alter table public.game_events       enable row level security;

create policy users_select_own on public.users
  for select to authenticated using (id = auth.uid());
create policy game_profiles_select_own on public.game_profiles
  for select to authenticated using (user_id = auth.uid());
create policy character_stats_select_own on public.character_stats
  for select to authenticated using (public.owns_profile(game_profile_id));
create policy skills_select_own on public.skills
  for select to authenticated using (public.owns_profile(game_profile_id));
create policy quests_select_own on public.quests
  for select to authenticated using (public.owns_profile(game_profile_id));
create policy quest_completions_select_own on public.quest_completions
  for select to authenticated using (public.owns_profile(game_profile_id));
create policy kingdoms_select_own on public.kingdoms
  for select to authenticated using (public.owns_profile(game_profile_id));
create policy resource_ledger_select_own on public.resource_ledger
  for select to authenticated using (public.owns_profile(game_profile_id));
create policy game_events_select_own on public.game_events
  for select to authenticated using (public.owns_profile(game_profile_id));

revoke insert, update, delete, truncate on
  public.users, public.game_profiles, public.character_stats, public.skills,
  public.quests, public.quest_completions, public.kingdoms,
  public.resource_ledger, public.game_events
from anon, authenticated;
revoke all on
  public.users, public.game_profiles, public.character_stats, public.skills,
  public.quests, public.quest_completions, public.kingdoms,
  public.resource_ledger, public.game_events
from anon;
grant select on
  public.users, public.game_profiles, public.character_stats, public.skills,
  public.quests, public.quest_completions, public.kingdoms,
  public.resource_ledger, public.game_events
to authenticated;

-- ---------------------------------------------------------------------------
-- Progression math (mirrors src/engine/progression/xp.ts)
-- ---------------------------------------------------------------------------
create or replace function public.nemesis_xp_required(p_level integer)
returns integer
language sql
immutable
strict
as $$
  select round(100 * power(p_level::double precision, 1.5))::integer;
$$;

create or replace function public.nemesis_level_for_xp(p_total_xp bigint)
returns integer
language plpgsql
immutable
strict
as $$
declare
  v_level integer := 1;
  v_remaining bigint := greatest(p_total_xp, 0);
  v_cost integer;
begin
  loop
    v_cost := public.nemesis_xp_required(v_level);
    exit when v_level >= 1000 or v_remaining < v_cost;
    v_remaining := v_remaining - v_cost;
    v_level := v_level + 1;
  end loop;
  return v_level;
end;
$$;

create or replace function public.nemesis_rank_for_level(p_level integer)
returns text
language sql
immutable
strict
as $$
  select case
    when p_level >= 50 then 'Верховный король'
    when p_level >= 30 then 'Король'
    when p_level >= 20 then 'Герцог'
    when p_level >= 15 then 'Граф'
    when p_level >= 10 then 'Барон'
    when p_level >= 5  then 'Рыцарь'
    else 'Наследник'
  end;
$$;

-- ---------------------------------------------------------------------------
-- Internal: atomic resource change + ledger entry
-- ---------------------------------------------------------------------------
create or replace function public.nemesis_apply_resource(
  p_profile_id uuid,
  p_kingdom_id uuid,
  p_resource   public.resource_type,
  p_delta      bigint,
  p_reason     text,
  p_ref_type   text,
  p_ref_id     uuid
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance bigint;
begin
  if p_delta = 0 then
    return null;
  end if;

  update public.kingdoms k set
    gold           = case when p_resource = 'gold'           then k.gold + p_delta           else k.gold end,
    food           = case when p_resource = 'food'           then k.food + p_delta           else k.food end,
    knowledge      = case when p_resource = 'knowledge'      then k.knowledge + p_delta      else k.knowledge end,
    influence      = case when p_resource = 'influence'      then k.influence + p_delta      else k.influence end,
    command_points = case when p_resource = 'command_points' then k.command_points + p_delta else k.command_points end
  where k.id = p_kingdom_id and k.game_profile_id = p_profile_id
  returning case p_resource
    when 'gold' then k.gold
    when 'food' then k.food
    when 'knowledge' then k.knowledge
    when 'influence' then k.influence
    else k.command_points
  end into v_balance;

  if not found then
    raise exception 'KINGDOM_NOT_FOUND' using errcode = 'P0001';
  end if;

  insert into public.resource_ledger (game_profile_id, kingdom_id, resource, delta, balance_after, reason, ref_type, ref_id)
  values (p_profile_id, p_kingdom_id, p_resource, p_delta, v_balance, p_reason, p_ref_type, p_ref_id);

  return v_balance;
exception
  when check_violation then
    raise exception 'INSUFFICIENT_RESOURCES' using errcode = 'P0001';
end;
$$;

-- ---------------------------------------------------------------------------
-- start_game: create hero, kingdom and starting state. Idempotent per user.
-- ---------------------------------------------------------------------------
create or replace function public.start_game(
  p_user_id       uuid,
  p_display_name  text,
  p_timezone      text,
  p_daily_minutes integer,
  p_hero_name     text,
  p_kingdom_name  text,
  p_skill_codes   text[],
  p_resources     jsonb,
  p_stats         jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_kingdom_id uuid;
  v_code text;
  v_res public.resource_type;
begin
  -- Serialize concurrent "start" requests for the same user.
  perform pg_advisory_xact_lock(hashtextextended('nemesis:start:' || p_user_id::text, 0));

  select id into v_profile_id from public.game_profiles where user_id = p_user_id;
  if v_profile_id is not null then
    return jsonb_build_object('profile_id', v_profile_id, 'created', false);
  end if;

  insert into public.users (id, display_name, timezone, daily_minutes)
  values (p_user_id, p_display_name, p_timezone, p_daily_minutes)
  on conflict (id) do update
    set display_name = excluded.display_name,
        timezone = excluded.timezone,
        daily_minutes = excluded.daily_minutes;

  insert into public.game_profiles (user_id, hero_name, kingdom_name)
  values (p_user_id, p_hero_name, p_kingdom_name)
  returning id into v_profile_id;

  insert into public.character_stats (game_profile_id, character_type, wisdom, willpower, strategy, management, capital, compassion)
  values (
    v_profile_id, 'HERO',
    (p_stats->>'wisdom')::smallint, (p_stats->>'willpower')::smallint,
    (p_stats->>'strategy')::smallint, (p_stats->>'management')::smallint,
    (p_stats->>'capital')::smallint, (p_stats->>'compassion')::smallint
  );

  foreach v_code in array p_skill_codes loop
    insert into public.skills (game_profile_id, character_type, skill_code)
    values (v_profile_id, 'HERO', v_code);
  end loop;

  insert into public.kingdoms (game_profile_id, owner_type, name)
  values (v_profile_id, 'HERO', p_kingdom_name)
  returning id into v_kingdom_id;

  foreach v_res in array enum_range(null::public.resource_type) loop
    perform public.nemesis_apply_resource(
      v_profile_id, v_kingdom_id, v_res,
      coalesce((p_resources->>v_res::text)::bigint, 0),
      'START', 'game_profile', v_profile_id
    );
  end loop;

  insert into public.game_events (game_profile_id, event_type, payload)
  values (v_profile_id, 'GAME_STARTED',
          jsonb_build_object('hero_name', p_hero_name, 'kingdom_name', p_kingdom_name));

  return jsonb_build_object('profile_id', v_profile_id, 'created', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- sync_quests: expire overdue quests and insert missing planned instances.
-- p_quests is a JSON array produced by the server-side quest planner.
-- ---------------------------------------------------------------------------
create or replace function public.sync_quests(
  p_user_id uuid,
  p_quests  jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_expired integer;
  v_inserted integer;
begin
  select id into v_profile_id from public.game_profiles where user_id = p_user_id;
  if v_profile_id is null then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Missed quests expire; earned XP is never taken away (ТЗ §6.3).
  update public.quests
     set status = 'EXPIRED'
   where game_profile_id = v_profile_id
     and status = 'PENDING'
     and deadline_at <= now();
  get diagnostics v_expired = row_count;

  insert into public.quests (
    game_profile_id, template_code, title, description, category, frequency,
    difficulty, estimated_minutes, base_xp, is_optional, success_criteria,
    scheduled_date, deadline_at, source, evaluation_mode
  )
  select
    v_profile_id, q.template_code, q.title, q.description, q.category, q.frequency,
    q.difficulty, q.estimated_minutes, q.base_xp, q.is_optional, q.success_criteria,
    q.scheduled_date, q.deadline_at, 'TEMPLATE', q.evaluation_mode
  from jsonb_to_recordset(coalesce(p_quests, '[]'::jsonb)) as q(
    template_code text, title text, description text, category text,
    frequency public.quest_frequency, difficulty smallint, estimated_minutes integer,
    base_xp integer, is_optional boolean, success_criteria jsonb,
    scheduled_date date, deadline_at timestamptz, evaluation_mode public.evaluation_mode
  )
  where q.deadline_at > now()
  on conflict (game_profile_id, frequency, scheduled_date, template_code) do nothing;
  get diagnostics v_inserted = row_count;

  return jsonb_build_object('expired', v_expired, 'inserted', v_inserted);
end;
$$;

-- ---------------------------------------------------------------------------
-- create_manual_quest: user-defined daily quest with server-computed XP.
-- ---------------------------------------------------------------------------
create or replace function public.create_manual_quest(
  p_user_id     uuid,
  p_quest       jsonb,
  p_day_start   timestamptz,
  p_max_per_day integer
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_count integer;
  v_id uuid;
begin
  select id into v_profile_id from public.game_profiles where user_id = p_user_id for update;
  if v_profile_id is null then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0001';
  end if;

  select count(*) into v_count
    from public.quests
   where game_profile_id = v_profile_id and source = 'MANUAL' and created_at >= p_day_start;
  if v_count >= p_max_per_day then
    raise exception 'MANUAL_QUEST_LIMIT' using errcode = 'P0001';
  end if;

  insert into public.quests (
    game_profile_id, template_code, title, description, category, frequency,
    difficulty, estimated_minutes, base_xp, is_optional, success_criteria,
    scheduled_date, deadline_at, source, evaluation_mode
  ) values (
    v_profile_id, null, p_quest->>'title', coalesce(p_quest->>'description', ''), p_quest->>'category',
    'DAILY', (p_quest->>'difficulty')::smallint, (p_quest->>'estimated_minutes')::integer,
    (p_quest->>'base_xp')::integer, true, coalesce(p_quest->'success_criteria', '[]'::jsonb),
    (p_quest->>'scheduled_date')::date, (p_quest->>'deadline_at')::timestamptz, 'MANUAL', 'SELF_REPORT'
  ) returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- complete_quest: the only way XP is awarded. Atomic and idempotent.
--   * profile row is locked FOR UPDATE → completions are serialized per user;
--   * the same idempotency key returns the original result instead of paying twice;
--   * a quest can be completed exactly once (unique quest_id in quest_completions);
--   * MANUAL quests share a daily XP cap.
-- Reward values are computed by the server game engine (TypeScript) and passed in.
-- ---------------------------------------------------------------------------
create or replace function public.complete_quest(
  p_user_id         uuid,
  p_quest_id        uuid,
  p_idempotency_key text,
  p_grade           public.quest_grade,
  p_xp              integer,
  p_gold            integer,
  p_knowledge       integer,
  p_note            text,
  p_manual_xp_cap   integer,
  p_day_start       timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.game_profiles%rowtype;
  v_quest public.quests%rowtype;
  v_existing public.quest_completions%rowtype;
  v_kingdom_id uuid;
  v_xp integer := greatest(p_xp, 0);
  v_gold integer := greatest(p_gold, 0);
  v_knowledge integer := greatest(p_knowledge, 0);
  v_manual_today bigint;
  v_allowed integer;
  v_new_total bigint;
  v_new_level integer;
  v_skill_level integer;
  v_skill_xp bigint;
  v_completion_id uuid;
begin
  select * into v_profile from public.game_profiles where user_id = p_user_id for update;
  if not found then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Replay of the same request → return the original outcome, award nothing.
  select * into v_existing from public.quest_completions
   where game_profile_id = v_profile.id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.quest_id <> p_quest_id then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = 'P0001';
    end if;
    return jsonb_build_object(
      'status', 'duplicate',
      'awarded_xp', v_existing.awarded_xp,
      'total_xp', v_profile.total_xp,
      'level', v_profile.level,
      'leveled_up', false
    );
  end if;

  select * into v_quest from public.quests
   where id = p_quest_id and game_profile_id = v_profile.id
   for update;
  if not found then
    raise exception 'QUEST_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_quest.status = 'COMPLETED' then
    raise exception 'QUEST_ALREADY_COMPLETED' using errcode = 'P0001';
  elsif v_quest.status <> 'PENDING' then
    raise exception 'QUEST_NOT_PENDING' using errcode = 'P0001';
  end if;

  if v_quest.deadline_at <= now() then
    update public.quests set status = 'EXPIRED' where id = v_quest.id;
    return jsonb_build_object('status', 'expired');
  end if;

  if v_quest.source = 'MANUAL' then
    select coalesce(sum(c.awarded_xp), 0) into v_manual_today
      from public.quest_completions c
      join public.quests q on q.id = c.quest_id
     where c.game_profile_id = v_profile.id
       and q.source = 'MANUAL'
       and c.completed_at >= p_day_start;
    v_allowed := greatest(0, p_manual_xp_cap - v_manual_today)::integer;
    if v_xp > v_allowed then
      if v_xp > 0 then
        v_gold := (v_gold::bigint * v_allowed / v_xp)::integer;
        v_knowledge := (v_knowledge::bigint * v_allowed / v_xp)::integer;
      end if;
      v_xp := v_allowed;
    end if;
  end if;

  insert into public.quest_completions (quest_id, game_profile_id, grade, awarded_xp, completion_note, idempotency_key)
  values (v_quest.id, v_profile.id, p_grade, v_xp, nullif(btrim(p_note), ''), p_idempotency_key)
  returning id into v_completion_id;

  update public.quests
     set status = 'COMPLETED', grade = p_grade, completed_at = now()
   where id = v_quest.id;

  v_new_total := v_profile.total_xp + v_xp;
  v_new_level := public.nemesis_level_for_xp(v_new_total);

  update public.game_profiles
     set total_xp = v_new_total,
         level = v_new_level,
         rank = public.nemesis_rank_for_level(v_new_level),
         updated_at = now()
   where id = v_profile.id;

  update public.skills
     set xp = xp + v_xp,
         level = public.nemesis_level_for_xp(xp + v_xp),
         updated_at = now()
   where game_profile_id = v_profile.id
     and character_type = 'HERO'
     and skill_code = v_quest.category
  returning level, xp into v_skill_level, v_skill_xp;

  select id into v_kingdom_id from public.kingdoms
   where game_profile_id = v_profile.id and owner_type = 'HERO';
  if v_kingdom_id is not null then
    perform public.nemesis_apply_resource(v_profile.id, v_kingdom_id, 'gold', v_gold, 'QUEST_REWARD', 'quest', v_quest.id);
    perform public.nemesis_apply_resource(v_profile.id, v_kingdom_id, 'knowledge', v_knowledge, 'QUEST_REWARD', 'quest', v_quest.id);
  end if;

  insert into public.game_events (game_profile_id, event_type, payload)
  values (v_profile.id, 'QUEST_COMPLETED', jsonb_build_object(
    'quest_id', v_quest.id, 'title', v_quest.title, 'category', v_quest.category,
    'grade', p_grade, 'xp', v_xp, 'gold', v_gold, 'knowledge', v_knowledge
  ));

  if v_new_level > v_profile.level then
    insert into public.game_events (game_profile_id, event_type, payload)
    values (v_profile.id, 'LEVEL_UP', jsonb_build_object(
      'from', v_profile.level, 'to', v_new_level,
      'rank', public.nemesis_rank_for_level(v_new_level)
    ));
  end if;

  return jsonb_build_object(
    'status', 'completed',
    'completion_id', v_completion_id,
    'awarded_xp', v_xp,
    'gold', v_gold,
    'knowledge', v_knowledge,
    'total_xp', v_new_total,
    'level', v_new_level,
    'leveled_up', v_new_level > v_profile.level,
    'skill_code', v_quest.category,
    'skill_level', v_skill_level,
    'skill_xp', v_skill_xp
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- skip_quest: no XP, no penalty. Idempotent.
-- ---------------------------------------------------------------------------
create or replace function public.skip_quest(
  p_user_id  uuid,
  p_quest_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_status public.quest_status;
begin
  select id into v_profile_id from public.game_profiles where user_id = p_user_id for update;
  if v_profile_id is null then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0001';
  end if;

  select status into v_status from public.quests
   where id = p_quest_id and game_profile_id = v_profile_id
   for update;
  if not found then
    raise exception 'QUEST_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_status = 'SKIPPED' then
    return jsonb_build_object('status', 'duplicate');
  elsif v_status <> 'PENDING' then
    raise exception 'QUEST_NOT_PENDING' using errcode = 'P0001';
  end if;

  update public.quests set status = 'SKIPPED' where id = p_quest_id;
  return jsonb_build_object('status', 'skipped');
end;
$$;

-- ---------------------------------------------------------------------------
-- delete_game: remove the profile and all related game data (ТЗ §17).
-- ---------------------------------------------------------------------------
create or replace function public.delete_game(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.users where id = p_user_id; -- cascades to all game tables
  return jsonb_build_object('status', 'deleted');
end;
$$;

-- Only the server (service_role) may call mutating functions.
revoke all on function public.nemesis_apply_resource(uuid, uuid, public.resource_type, bigint, text, text, uuid) from public, anon, authenticated;
revoke all on function public.start_game(uuid, text, text, integer, text, text, text[], jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.sync_quests(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.create_manual_quest(uuid, jsonb, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.complete_quest(uuid, uuid, text, public.quest_grade, integer, integer, integer, text, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.skip_quest(uuid, uuid) from public, anon, authenticated;
revoke all on function public.delete_game(uuid) from public, anon, authenticated;

grant execute on function public.start_game(uuid, text, text, integer, text, text, text[], jsonb, jsonb) to service_role;
grant execute on function public.sync_quests(uuid, jsonb) to service_role;
grant execute on function public.create_manual_quest(uuid, jsonb, timestamptz, integer) to service_role;
grant execute on function public.complete_quest(uuid, uuid, text, public.quest_grade, integer, integer, integer, text, integer, timestamptz) to service_role;
grant execute on function public.skip_quest(uuid, uuid) to service_role;
grant execute on function public.delete_game(uuid) to service_role;
