-- NEMESIS — Sprint 6: story chapters, bosses, achievements, titles, items (ТЗ §13).
--
-- Same rules as before: users only SELECT their own rows; every change goes
-- through SECURITY DEFINER functions callable by service_role only. Each
-- action locks the hero kingdom row and is idempotent by key. Chapter
-- objectives and achievements are "metric >= target" and are re-checked here
-- against real game state (nemesis_story_metrics), so the server cannot
-- complete a chapter or unlock an achievement the player has not earned.
-- Story never gives XP: XP comes only from real-life quests.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.story_progress (
  id                    uuid primary key default gen_random_uuid(),
  game_profile_id       uuid not null references public.game_profiles (id) on delete cascade,
  chapter_code          text not null check (chapter_code ~ '^[a-z0-9_]{2,40}$'),
  status                text not null default 'ACTIVE' check (status in ('ACTIVE', 'COMPLETED')),
  intro_seen            boolean not null default false,
  outro_seen            boolean not null default false,
  decision              text check (decision is null or decision ~ '^[a-z0-9_]{2,40}$'),
  decision_day          date,
  boss_defeated         boolean not null default false,
  boss_attempts         integer not null default 0 check (boss_attempts >= 0),
  boss_last_attempt_day date,
  chronicle             text check (chronicle is null or char_length(chronicle) between 1 and 2000),
  chronicle_source      text check (chronicle_source is null or chronicle_source in ('AI', 'FALLBACK')),
  started_at            timestamptz not null default now(),
  completed_at          timestamptz,
  unique (game_profile_id, chapter_code)
);
-- At most one active chapter per profile.
create unique index story_progress_active_uq on public.story_progress (game_profile_id) where status = 'ACTIVE';

create table public.achievements (
  id               uuid primary key default gen_random_uuid(),
  game_profile_id  uuid not null references public.game_profiles (id) on delete cascade,
  achievement_code text not null check (achievement_code ~ '^[a-z0-9_]{2,40}$'),
  unlocked_at      timestamptz not null default now(),
  unique (game_profile_id, achievement_code)
);

create table public.unlocked_titles (
  id              uuid primary key default gen_random_uuid(),
  game_profile_id uuid not null references public.game_profiles (id) on delete cascade,
  title_code      text not null check (title_code ~ '^[a-z0-9_]{2,40}$'),
  source          text not null check (char_length(source) between 1 and 60),
  unlocked_at     timestamptz not null default now(),
  unique (game_profile_id, title_code)
);

alter table public.game_profiles add column active_title text check (active_title is null or active_title ~ '^[a-z0-9_]{2,40}$');

create table public.inventory_items (
  id              uuid primary key default gen_random_uuid(),
  game_profile_id uuid not null references public.game_profiles (id) on delete cascade,
  item_code       text not null check (item_code ~ '^[a-z0-9_]{2,40}$'),
  quantity        integer not null default 1 check (quantity >= 1),
  source          text not null check (char_length(source) between 1 and 60),
  acquired_at     timestamptz not null default now(),
  unique (game_profile_id, item_code)
);

create table public.story_actions (
  id              uuid primary key default gen_random_uuid(),
  game_profile_id uuid not null references public.game_profiles (id) on delete cascade,
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9:_-]{8,100}$'),
  action_type     text not null check (action_type in ('DECIDE', 'BOSS', 'COMPLETE')),
  result          jsonb not null,
  created_at      timestamptz not null default now(),
  unique (game_profile_id, idempotency_key)
);

-- The chronicle retelling goes through the same AI gateway and limits.
alter table public.ai_usage_logs drop constraint if exists ai_usage_logs_kind_check;
alter table public.ai_usage_logs add constraint ai_usage_logs_kind_check
  check (kind in ('MENTOR_CHAT', 'EVALUATE', 'GENERATE_QUESTS', 'COURT_DIALOGUE', 'STORY_CHRONICLE'));

-- ---------------------------------------------------------------------------
-- RLS: read own rows only.
-- ---------------------------------------------------------------------------
alter table public.story_progress enable row level security;
alter table public.achievements enable row level security;
alter table public.unlocked_titles enable row level security;
alter table public.inventory_items enable row level security;
alter table public.story_actions enable row level security;

create policy story_progress_select_own on public.story_progress for select to authenticated using (public.owns_profile(game_profile_id));
create policy achievements_select_own on public.achievements for select to authenticated using (public.owns_profile(game_profile_id));
create policy unlocked_titles_select_own on public.unlocked_titles for select to authenticated using (public.owns_profile(game_profile_id));
create policy inventory_items_select_own on public.inventory_items for select to authenticated using (public.owns_profile(game_profile_id));
create policy story_actions_select_own on public.story_actions for select to authenticated using (public.owns_profile(game_profile_id));

revoke all on public.story_progress, public.achievements, public.unlocked_titles, public.inventory_items, public.story_actions from anon;
revoke insert, update, delete, truncate on public.story_progress, public.achievements, public.unlocked_titles, public.inventory_items, public.story_actions from authenticated;
grant select on public.story_progress, public.achievements, public.unlocked_titles, public.inventory_items, public.story_actions to authenticated;
grant all on public.story_progress, public.achievements, public.unlocked_titles, public.inventory_items, public.story_actions to service_role;

-- ---------------------------------------------------------------------------
-- Internal: progress metrics from real game state.
-- p_unit_power = {unit_type: power weight} (from the game data).
-- ---------------------------------------------------------------------------
create or replace function public.nemesis_story_metrics(p_profile_id uuid, p_kingdom_id uuid, p_unit_power jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'questsCompleted', (select count(*) from public.quests where game_profile_id = p_profile_id and status = 'COMPLETED'),
    'heroLevel', (select level from public.game_profiles where id = p_profile_id),
    'skillLevel', coalesce((select max(level) from public.skills where game_profile_id = p_profile_id and character_type = 'HERO'), 0),
    -- Every finished construction or upgrade, minus the starting castle.
    'buildings', greatest(0, coalesce((
      select sum(case when completed_at <= now() then level else level - 1 end) from public.buildings where kingdom_id = p_kingdom_id
    ), 0) - 1),
    'battlesWon', (select count(*) from public.battles where game_profile_id = p_profile_id and attacker_side = 'HERO' and result = 'ATTACKER_WON'),
    'territories', (select count(*) from public.territories where game_profile_id = p_profile_id and owner_type = 'HERO'),
    'armyPower', coalesce((
      select floor(sum(u.quantity * coalesce((p_unit_power->>u.unit_type)::numeric, 0)))
        from public.army_units u join public.armies a on a.id = u.army_id
       where a.kingdom_id = p_kingdom_id
    ), 0),
    'courtFriends', (select count(*) from public.court_npcs where game_profile_id = p_profile_id and recruited_at is not null
                       and relationship_status in ('FRIENDS', 'CLOSE', 'ROMANCE', 'PARTNER')),
    'courtEventsResolved', (select count(*) from public.court_events where game_profile_id = p_profile_id and status = 'RESOLVED'),
    'positionsFilled', (select count(*) from public.court_npcs where game_profile_id = p_profile_id and position is not null),
    'bossesDefeated', (select count(*) from public.story_progress where game_profile_id = p_profile_id and boss_defeated),
    'chaptersCompleted', (select count(*) from public.story_progress where game_profile_id = p_profile_id and status = 'COMPLETED')
  );
$$;

-- True when every {metric, target} in p_objectives is met.
create or replace function public.nemesis_story_met(p_metrics jsonb, p_objectives jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(bool_and(coalesce((p_metrics->>(o->>'metric'))::numeric, 0) >= (o->>'target')::numeric), true)
    from jsonb_array_elements(coalesce(p_objectives, '[]'::jsonb)) o;
$$;

-- Internal: signed resource deltas through the ledger, never below zero.
create or replace function public.nemesis_story_resources(p_profile_id uuid, p_kingdom_id uuid, p_deltas jsonb, p_reason text, p_ref_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res public.resource_type;
  v_delta bigint;
  v_balance bigint;
begin
  foreach v_res in array array['gold', 'food', 'knowledge', 'influence']::public.resource_type[] loop
    v_delta := coalesce((p_deltas->>v_res::text)::bigint, 0);
    if v_delta = 0 then
      continue;
    end if;
    select case v_res when 'gold' then gold when 'food' then food when 'knowledge' then knowledge else influence end
      into v_balance from public.kingdoms where id = p_kingdom_id;
    if v_balance + v_delta < 0 then
      raise exception 'INSUFFICIENT_RESOURCES' using errcode = 'P0001';
    end if;
    perform public.nemesis_apply_resource(p_profile_id, p_kingdom_id, v_res, v_delta, p_reason, 'story', p_ref_id);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- ensure_story: the first chapter starts once per profile (idempotent).
-- ---------------------------------------------------------------------------
create or replace function public.ensure_story(p_user_id uuid, p_first_chapter text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hero public.kingdoms;
begin
  v_hero := public.nemesis_hero_kingdom(p_user_id);
  if exists (select 1 from public.story_progress where game_profile_id = v_hero.game_profile_id) then
    return jsonb_build_object('created', false);
  end if;
  insert into public.story_progress (game_profile_id, chapter_code) values (v_hero.game_profile_id, p_first_chapter);
  insert into public.game_events (game_profile_id, event_type, payload)
  values (v_hero.game_profile_id, 'CHAPTER_STARTED', jsonb_build_object('chapter', p_first_chapter));
  return jsonb_build_object('created', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- story_mark_seen: the player watched the intro or outro scene.
-- ---------------------------------------------------------------------------
create or replace function public.story_mark_seen(p_user_id uuid, p_chapter text, p_scene text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hero public.kingdoms;
begin
  v_hero := public.nemesis_hero_kingdom(p_user_id);
  if p_scene = 'intro' then
    update public.story_progress set intro_seen = true where game_profile_id = v_hero.game_profile_id and chapter_code = p_chapter;
  elsif p_scene = 'outro' then
    update public.story_progress set outro_seen = true
     where game_profile_id = v_hero.game_profile_id and chapter_code = p_chapter and status = 'COMPLETED';
  else
    raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
  end if;
  if not found then
    raise exception 'STORY_LOCKED' using errcode = 'P0001';
  end if;
  return jsonb_build_object('status', 'ok');
end;
$$;

-- ---------------------------------------------------------------------------
-- story_choose: the chapter's one decision.
-- p_allowed: codes of the offered choices; p_changes = {resources:{...}, morale}
-- ---------------------------------------------------------------------------
create or replace function public.story_choose(
  p_user_id uuid,
  p_key     text,
  p_chapter text,
  p_choice  text,
  p_allowed text[],
  p_day     date,
  p_changes jsonb,
  p_outcome jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hero public.kingdoms;
  v_profile_id uuid;
  v_prev jsonb;
  v_p public.story_progress%rowtype;
  v_morale integer;
  v_result jsonb;
begin
  v_hero := public.nemesis_hero_kingdom(p_user_id);
  v_profile_id := v_hero.game_profile_id;
  select result into v_prev from public.story_actions where game_profile_id = v_profile_id and idempotency_key = p_key;
  if v_prev is not null then
    return v_prev || jsonb_build_object('status', 'duplicate');
  end if;
  if not (p_choice = any (p_allowed)) then
    raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
  end if;

  select * into v_p from public.story_progress where game_profile_id = v_profile_id and chapter_code = p_chapter for update;
  if v_p.id is null or v_p.status <> 'ACTIVE' or not v_p.intro_seen or v_p.decision is not null then
    raise exception 'STORY_LOCKED' using errcode = 'P0001';
  end if;

  perform public.nemesis_story_resources(v_profile_id, v_hero.id, p_changes->'resources', 'STORY', v_p.id);
  v_morale := coalesce((p_changes->>'morale')::integer, 0);
  if v_morale <> 0 then
    update public.armies set morale = greatest(0, least(100, morale + v_morale)), updated_at = now() where kingdom_id = v_hero.id;
  end if;
  update public.story_progress set decision = p_choice, decision_day = p_day where id = v_p.id;

  v_result := jsonb_build_object('status', 'applied', 'chapter', p_chapter, 'choice', p_choice);
  insert into public.story_actions (game_profile_id, idempotency_key, action_type, result) values (v_profile_id, p_key, 'DECIDE', v_result);
  insert into public.game_events (game_profile_id, event_type, payload)
  values (v_profile_id, 'STORY_DECISION', jsonb_build_object('chapter', p_chapter, 'title', p_outcome->>'title', 'choice', p_outcome->>'choice'));
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- story_boss: one assault on the chapter boss. Costs 1 command point, at most
-- one attempt per local day, casualties like any battle. Objectives must be
-- met and the decision taken. Returns 'stale' if the army changed meanwhile.
-- p_battle = {win, casualties, morale_after, seed, tactic, defender_side,
--             attacker_snapshot, defender_snapshot}
-- ---------------------------------------------------------------------------
create or replace function public.story_boss(
  p_user_id       uuid,
  p_key           text,
  p_chapter       text,
  p_boss          text,
  p_day           date,
  p_objectives    jsonb,
  p_unit_power    jsonb,
  p_expected_army jsonb,
  p_battle        jsonb,
  p_rewards       jsonb,
  p_item          text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hero public.kingdoms;
  v_profile_id uuid;
  v_prev jsonb;
  v_p public.story_progress%rowtype;
  v_army public.armies%rowtype;
  v_win boolean := (p_battle->>'win')::boolean;
  v_unit text;
  v_battle_id uuid;
  v_result jsonb;
begin
  v_hero := public.nemesis_hero_kingdom(p_user_id);
  v_profile_id := v_hero.game_profile_id;
  select result into v_prev from public.story_actions where game_profile_id = v_profile_id and idempotency_key = p_key;
  if v_prev is not null then
    return v_prev || jsonb_build_object('status', 'duplicate');
  end if;

  select * into v_p from public.story_progress where game_profile_id = v_profile_id and chapter_code = p_chapter for update;
  if v_p.id is null or v_p.status <> 'ACTIVE' or not v_p.intro_seen or v_p.decision is null or v_p.boss_defeated then
    raise exception 'STORY_LOCKED' using errcode = 'P0001';
  end if;
  if not public.nemesis_story_met(public.nemesis_story_metrics(v_profile_id, v_hero.id, p_unit_power), p_objectives) then
    raise exception 'OBJECTIVES_INCOMPLETE' using errcode = 'P0001';
  end if;
  if v_p.boss_last_attempt_day is not distinct from p_day then
    raise exception 'BOSS_COOLDOWN' using errcode = 'P0001';
  end if;
  if v_hero.command_points < 1 then
    raise exception 'NO_COMMAND_POINTS' using errcode = 'P0001';
  end if;

  select * into v_army from public.armies where kingdom_id = v_hero.id;
  if v_army.id is null or public.nemesis_army_json(v_army.id) = '{}'::jsonb then
    raise exception 'NOT_ENOUGH_ARMY' using errcode = 'P0001';
  end if;
  if public.nemesis_army_json(v_army.id) <> p_expected_army then
    return jsonb_build_object('status', 'stale');
  end if;

  for v_unit in select * from jsonb_object_keys(coalesce(p_battle->'casualties', '{}'::jsonb)) loop
    update public.army_units set quantity = greatest(0, quantity - (p_battle->'casualties'->>v_unit)::integer)
     where army_id = v_army.id and unit_type = v_unit;
  end loop;
  update public.armies set morale = least(100, greatest(0, (p_battle->>'morale_after')::integer)), updated_at = now() where id = v_army.id;
  perform public.nemesis_apply_resource(v_profile_id, v_hero.id, 'command_points', -1, 'BOSS', 'story', v_p.id);

  insert into public.battles (
    game_profile_id, attacker_kingdom_id, attacker_side, defender_side, territory_code,
    attacker_snapshot, defender_snapshot, battle_seed, tactic, result, casualties, rewards
  ) values (
    v_profile_id, v_hero.id, 'HERO', p_battle->>'defender_side', 'boss:' || p_boss,
    coalesce(p_battle->'attacker_snapshot', '{}'::jsonb), coalesce(p_battle->'defender_snapshot', '{}'::jsonb),
    (p_battle->>'seed')::bigint, p_battle->>'tactic',
    case when v_win then 'ATTACKER_WON' else 'DEFENDER_WON' end,
    coalesce(p_battle->'casualties', '{}'::jsonb), case when v_win then coalesce(p_rewards, '{}'::jsonb) else '{}'::jsonb end
  ) returning id into v_battle_id;

  update public.story_progress set
    boss_attempts = boss_attempts + 1, boss_last_attempt_day = p_day, boss_defeated = v_win
   where id = v_p.id;

  if v_win then
    perform public.nemesis_story_resources(v_profile_id, v_hero.id, p_rewards, 'BOSS_REWARD', v_battle_id);
    if p_item is not null then
      insert into public.inventory_items (game_profile_id, item_code, source)
      values (v_profile_id, p_item, 'boss:' || p_boss)
      on conflict (game_profile_id, item_code) do nothing;
    end if;
  end if;

  v_result := jsonb_build_object('status', 'resolved', 'battle_id', v_battle_id, 'win', v_win, 'boss', p_boss);
  insert into public.story_actions (game_profile_id, idempotency_key, action_type, result) values (v_profile_id, p_key, 'BOSS', v_result);
  insert into public.game_events (game_profile_id, event_type, payload)
  values (v_profile_id, case when v_win then 'BOSS_DEFEATED' else 'BOSS_REPELLED' end,
          jsonb_build_object('boss', p_boss, 'name', p_battle->'defender_snapshot'->>'name', 'chapter', p_chapter));
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- story_complete_chapter: grant the chapter rewards and start the next one.
-- ---------------------------------------------------------------------------
create or replace function public.story_complete_chapter(
  p_user_id       uuid,
  p_key           text,
  p_chapter       text,
  p_objectives    jsonb,
  p_unit_power    jsonb,
  p_requires_boss boolean,
  p_resources     jsonb,
  p_items         text[],
  p_titles        text[],
  p_next          text,
  p_next_number   integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hero public.kingdoms;
  v_profile_id uuid;
  v_prev jsonb;
  v_p public.story_progress%rowtype;
  v_code text;
  v_result jsonb;
begin
  v_hero := public.nemesis_hero_kingdom(p_user_id);
  v_profile_id := v_hero.game_profile_id;
  select result into v_prev from public.story_actions where game_profile_id = v_profile_id and idempotency_key = p_key;
  if v_prev is not null then
    return v_prev || jsonb_build_object('status', 'duplicate');
  end if;

  select * into v_p from public.story_progress where game_profile_id = v_profile_id and chapter_code = p_chapter for update;
  if v_p.id is null or v_p.status <> 'ACTIVE' or not v_p.intro_seen or v_p.decision is null or (p_requires_boss and not v_p.boss_defeated) then
    raise exception 'STORY_LOCKED' using errcode = 'P0001';
  end if;
  if not public.nemesis_story_met(public.nemesis_story_metrics(v_profile_id, v_hero.id, p_unit_power), p_objectives) then
    raise exception 'OBJECTIVES_INCOMPLETE' using errcode = 'P0001';
  end if;

  update public.story_progress set status = 'COMPLETED', completed_at = now() where id = v_p.id;
  perform public.nemesis_story_resources(v_profile_id, v_hero.id, p_resources, 'STORY_REWARD', v_p.id);
  foreach v_code in array coalesce(p_items, '{}') loop
    insert into public.inventory_items (game_profile_id, item_code, source) values (v_profile_id, v_code, 'chapter:' || p_chapter)
    on conflict (game_profile_id, item_code) do nothing;
  end loop;
  foreach v_code in array coalesce(p_titles, '{}') loop
    insert into public.unlocked_titles (game_profile_id, title_code, source) values (v_profile_id, v_code, 'chapter:' || p_chapter)
    on conflict (game_profile_id, title_code) do nothing;
  end loop;
  if p_next is not null then
    insert into public.story_progress (game_profile_id, chapter_code) values (v_profile_id, p_next)
    on conflict (game_profile_id, chapter_code) do nothing;
    update public.game_profiles set current_chapter = greatest(current_chapter, p_next_number), updated_at = now() where id = v_profile_id;
  end if;

  v_result := jsonb_build_object('status', 'completed', 'chapter', p_chapter, 'next', p_next);
  insert into public.story_actions (game_profile_id, idempotency_key, action_type, result) values (v_profile_id, p_key, 'COMPLETE', v_result);
  insert into public.game_events (game_profile_id, event_type, payload)
  values (v_profile_id, 'CHAPTER_COMPLETED', jsonb_build_object('chapter', p_chapter));
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- grant_achievements: unlock every listed achievement whose metric is met.
-- p_list = [{code, name, metric, target, title}]. Idempotent.
-- ---------------------------------------------------------------------------
create or replace function public.grant_achievements(p_user_id uuid, p_list jsonb, p_unit_power jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hero public.kingdoms;
  v_profile_id uuid;
  v_metrics jsonb;
  v_a jsonb;
  v_id uuid;
  v_new text[] := '{}';
begin
  v_hero := public.nemesis_hero_kingdom(p_user_id);
  v_profile_id := v_hero.game_profile_id;
  v_metrics := public.nemesis_story_metrics(v_profile_id, v_hero.id, p_unit_power);
  for v_a in select * from jsonb_array_elements(coalesce(p_list, '[]'::jsonb)) loop
    if not public.nemesis_story_met(v_metrics, jsonb_build_array(v_a)) then
      continue;
    end if;
    v_id := null;
    insert into public.achievements (game_profile_id, achievement_code) values (v_profile_id, v_a->>'code')
    on conflict (game_profile_id, achievement_code) do nothing
    returning id into v_id;
    if v_id is null then
      continue;
    end if;
    v_new := v_new || (v_a->>'code');
    if nullif(v_a->>'title', '') is not null then
      insert into public.unlocked_titles (game_profile_id, title_code, source) values (v_profile_id, v_a->>'title', 'achievement:' || (v_a->>'code'))
      on conflict (game_profile_id, title_code) do nothing;
    end if;
    insert into public.game_events (game_profile_id, event_type, payload)
    values (v_profile_id, 'ACHIEVEMENT_UNLOCKED', jsonb_build_object('code', v_a->>'code', 'name', v_a->>'name'));
  end loop;
  return jsonb_build_object('unlocked', to_jsonb(v_new), 'metrics', v_metrics);
end;
$$;

-- ---------------------------------------------------------------------------
-- set_active_title: only an unlocked title (or none).
-- ---------------------------------------------------------------------------
create or replace function public.set_active_title(p_user_id uuid, p_title text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hero public.kingdoms;
begin
  v_hero := public.nemesis_hero_kingdom(p_user_id);
  if p_title is not null and not exists (
    select 1 from public.unlocked_titles where game_profile_id = v_hero.game_profile_id and title_code = p_title
  ) then
    raise exception 'TITLE_LOCKED' using errcode = 'P0001';
  end if;
  update public.game_profiles set active_title = p_title, updated_at = now() where id = v_hero.game_profile_id;
  return jsonb_build_object('status', 'ok', 'title', p_title);
end;
$$;

-- ---------------------------------------------------------------------------
-- story_save_chronicle: the retelling of a completed chapter, written once.
-- ---------------------------------------------------------------------------
create or replace function public.story_save_chronicle(p_user_id uuid, p_chapter text, p_text text, p_source text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hero public.kingdoms;
  v_text text;
begin
  v_hero := public.nemesis_hero_kingdom(p_user_id);
  if p_source not in ('AI', 'FALLBACK') then
    raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
  end if;
  update public.story_progress set chronicle = left(p_text, 2000), chronicle_source = p_source
   where game_profile_id = v_hero.game_profile_id and chapter_code = p_chapter and status = 'COMPLETED' and chronicle is null;
  select chronicle into v_text from public.story_progress where game_profile_id = v_hero.game_profile_id and chapter_code = p_chapter;
  if v_text is null then
    raise exception 'STORY_LOCKED' using errcode = 'P0001';
  end if;
  return jsonb_build_object('chronicle', v_text);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: internal helpers for nobody, actions for service_role only.
-- ---------------------------------------------------------------------------
revoke all on function public.nemesis_story_metrics(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.nemesis_story_met(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.nemesis_story_resources(uuid, uuid, jsonb, text, uuid) from public, anon, authenticated;
revoke all on function public.ensure_story(uuid, text) from public, anon, authenticated;
revoke all on function public.story_mark_seen(uuid, text, text) from public, anon, authenticated;
revoke all on function public.story_choose(uuid, text, text, text, text[], date, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.story_boss(uuid, text, text, text, date, jsonb, jsonb, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.story_complete_chapter(uuid, text, text, jsonb, jsonb, boolean, jsonb, text[], text[], text, integer) from public, anon, authenticated;
revoke all on function public.grant_achievements(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.set_active_title(uuid, text) from public, anon, authenticated;
revoke all on function public.story_save_chronicle(uuid, text, text, text) from public, anon, authenticated;

grant execute on function public.ensure_story(uuid, text) to service_role;
grant execute on function public.story_mark_seen(uuid, text, text) to service_role;
grant execute on function public.story_choose(uuid, text, text, text, text[], date, jsonb, jsonb) to service_role;
grant execute on function public.story_boss(uuid, text, text, text, date, jsonb, jsonb, jsonb, jsonb, jsonb, text) to service_role;
grant execute on function public.story_complete_chapter(uuid, text, text, jsonb, jsonb, boolean, jsonb, text[], text[], text, integer) to service_role;
grant execute on function public.grant_achievements(uuid, jsonb, jsonb) to service_role;
grant execute on function public.set_active_title(uuid, text) to service_role;
grant execute on function public.story_save_chronicle(uuid, text, text, text) to service_role;
