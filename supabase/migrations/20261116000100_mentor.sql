-- NEMESIS — Sprint 3: mentor Orion (AI Gateway bookkeeping, chat, AI quests, evaluations).
--
-- AI never writes game state directly (ТЗ §3.4): the server validates every AI
-- answer, computes XP itself and calls these functions as service_role.
-- Users can only SELECT their own rows (RLS), like everywhere else.

-- A template quest that Orion replaced with his own for the day. Hidden from
-- the board, never completable, and keeps sync_quests from re-issuing it.
alter type public.quest_status add value if not exists 'REPLACED';

-- Per-user AI limits (ТЗ §9.4): requests per day and a monthly spend cap.
alter table public.users
  add column if not exists ai_daily_request_limit integer not null default 30
    check (ai_daily_request_limit between 0 and 200),
  add column if not exists ai_monthly_budget_cents integer not null default 300
    check (ai_monthly_budget_cents between 0 and 10000);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.ai_usage_logs (
  id                uuid primary key default gen_random_uuid(),
  game_profile_id   uuid not null references public.game_profiles (id) on delete cascade,
  kind              text not null check (kind in ('MENTOR_CHAT', 'EVALUATE', 'GENERATE_QUESTS')),
  status            text not null default 'PENDING' check (status in ('PENDING', 'OK', 'INVALID', 'FAILED')),
  model             text check (model is null or char_length(model) <= 120),
  prompt_tokens     integer not null default 0 check (prompt_tokens >= 0),
  completion_tokens integer not null default 0 check (completion_tokens >= 0),
  -- USD × 1 000 000, as reported by OpenRouter.
  cost_micros       bigint not null default 0 check (cost_micros >= 0),
  attempts          smallint not null default 0 check (attempts between 0 and 10),
  error             text check (error is null or char_length(error) <= 300),
  created_at        timestamptz not null default now(),
  finished_at       timestamptz
);
create index ai_usage_logs_profile_time_idx on public.ai_usage_logs (game_profile_id, created_at desc);

create table public.mentor_messages (
  id              uuid primary key default gen_random_uuid(),
  game_profile_id uuid not null references public.game_profiles (id) on delete cascade,
  role            text not null check (role in ('user', 'mentor')),
  content         text not null check (char_length(content) between 1 and 4000),
  source          text not null default 'AI' check (source in ('USER', 'AI', 'FALLBACK')),
  created_at      timestamptz not null default clock_timestamp()
);
create index mentor_messages_profile_time_idx on public.mentor_messages (game_profile_id, created_at desc);

create table public.quest_evaluations (
  id              uuid primary key default gen_random_uuid(),
  quest_id        uuid not null unique references public.quests (id) on delete cascade,
  game_profile_id uuid not null references public.game_profiles (id) on delete cascade,
  answer          text not null check (char_length(answer) between 1 and 4000),
  grade           public.quest_grade not null,
  reasoning       text not null default '' check (char_length(reasoning) <= 2000),
  mistakes        jsonb not null default '[]'::jsonb check (jsonb_typeof(mistakes) = 'array'),
  recommendations jsonb not null default '[]'::jsonb check (jsonb_typeof(recommendations) = 'array'),
  next_topic      text not null default '' check (char_length(next_topic) <= 200),
  created_at      timestamptz not null default now()
);
create index quest_evaluations_profile_time_idx on public.quest_evaluations (game_profile_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS: owner may read; nobody but service_role (through functions) may write.
-- ---------------------------------------------------------------------------
alter table public.ai_usage_logs enable row level security;
alter table public.mentor_messages enable row level security;
alter table public.quest_evaluations enable row level security;

create policy ai_usage_logs_select_own on public.ai_usage_logs
  for select to authenticated using (public.owns_profile(game_profile_id));
create policy mentor_messages_select_own on public.mentor_messages
  for select to authenticated using (public.owns_profile(game_profile_id));
create policy quest_evaluations_select_own on public.quest_evaluations
  for select to authenticated using (public.owns_profile(game_profile_id));

revoke insert, update, delete, truncate on public.ai_usage_logs, public.mentor_messages, public.quest_evaluations from anon, authenticated;
revoke all on public.ai_usage_logs, public.mentor_messages, public.quest_evaluations from anon;
grant select on public.ai_usage_logs, public.mentor_messages, public.quest_evaluations to authenticated;
grant all on public.ai_usage_logs, public.mentor_messages, public.quest_evaluations to service_role;

-- ---------------------------------------------------------------------------
-- reserve_ai_request: check the daily request limit and the monthly budget,
-- then book a PENDING log row. The user row lock serialises concurrent calls,
-- so parallel requests cannot slip past the limit.
-- ---------------------------------------------------------------------------
create or replace function public.reserve_ai_request(
  p_user_id     uuid,
  p_kind        text,
  p_day_start   timestamptz,
  p_month_start timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.users%rowtype;
  v_profile_id uuid;
  v_today integer;
  v_month_cost bigint;
  v_id uuid;
begin
  select * into v_user from public.users where id = p_user_id for update;
  select id into v_profile_id from public.game_profiles where user_id = p_user_id;
  if v_user.id is null or v_profile_id is null then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0001';
  end if;

  select count(*) into v_today
    from public.ai_usage_logs
   where game_profile_id = v_profile_id and created_at >= p_day_start;
  if v_today >= v_user.ai_daily_request_limit then
    return jsonb_build_object('status', 'limited', 'reason', 'daily', 'used', v_today, 'limit', v_user.ai_daily_request_limit);
  end if;

  select coalesce(sum(cost_micros), 0) into v_month_cost
    from public.ai_usage_logs
   where game_profile_id = v_profile_id and created_at >= p_month_start;
  if v_month_cost >= v_user.ai_monthly_budget_cents::bigint * 10000 then
    return jsonb_build_object('status', 'limited', 'reason', 'budget', 'cost_micros', v_month_cost);
  end if;

  insert into public.ai_usage_logs (game_profile_id, kind)
  values (v_profile_id, p_kind)
  returning id into v_id;

  return jsonb_build_object('status', 'ok', 'id', v_id);
end;
$$;

create or replace function public.finish_ai_request(
  p_user_id           uuid,
  p_id                uuid,
  p_status            text,
  p_model             text,
  p_prompt_tokens     integer,
  p_completion_tokens integer,
  p_cost_micros       bigint,
  p_attempts          integer,
  p_error             text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ai_usage_logs l
     set status = p_status,
         model = left(p_model, 120),
         prompt_tokens = greatest(coalesce(p_prompt_tokens, 0), 0),
         completion_tokens = greatest(coalesce(p_completion_tokens, 0), 0),
         cost_micros = greatest(coalesce(p_cost_micros, 0), 0),
         attempts = least(greatest(coalesce(p_attempts, 0), 0), 10),
         error = left(p_error, 300),
         finished_at = now()
    from public.game_profiles p
   where l.id = p_id
     and l.game_profile_id = p.id
     and p.user_id = p_user_id
     and l.status = 'PENDING';
end;
$$;

create or replace function public.update_ai_settings(
  p_user_id      uuid,
  p_daily_limit  integer,
  p_budget_cents integer
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.users
     set ai_daily_request_limit = p_daily_limit,
         ai_monthly_budget_cents = p_budget_cents
   where id = p_user_id;
  if not found then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0001';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- add_mentor_messages: append chat lines ([{role, content, source}]).
-- ---------------------------------------------------------------------------
create or replace function public.add_mentor_messages(
  p_user_id  uuid,
  p_messages jsonb
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_msg jsonb;
  v_count integer := 0;
begin
  select id into v_profile_id from public.game_profiles where user_id = p_user_id;
  if v_profile_id is null then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0001';
  end if;
  -- One row at a time so clock_timestamp() keeps the order of the lines.
  for v_msg in select * from jsonb_array_elements(coalesce(p_messages, '[]'::jsonb)) loop
    insert into public.mentor_messages (game_profile_id, role, content, source)
    values (v_profile_id, v_msg->>'role', v_msg->>'content', coalesce(v_msg->>'source', 'AI'));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- apply_ai_daily_quests: Orion's plan for today replaces the template plan.
-- Only once per day, and only while none of today's daily quests is closed,
-- so it can never be used to re-roll rewards. XP comes from the server engine.
-- ---------------------------------------------------------------------------
create or replace function public.apply_ai_daily_quests(
  p_user_id uuid,
  p_today   date,
  p_quests  jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_replaced integer;
  v_inserted integer;
begin
  select id into v_profile_id from public.game_profiles where user_id = p_user_id for update;
  if v_profile_id is null then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.quests
     where game_profile_id = v_profile_id and frequency = 'DAILY'
       and scheduled_date = p_today and source = 'AI'
  ) then
    return jsonb_build_object('status', 'exists');
  end if;

  if exists (
    select 1 from public.quests
     where game_profile_id = v_profile_id and frequency = 'DAILY'
       and scheduled_date = p_today and source = 'TEMPLATE'
       and status in ('COMPLETED', 'SKIPPED')
  ) then
    return jsonb_build_object('status', 'too_late');
  end if;

  update public.quests
     set status = 'REPLACED'
   where game_profile_id = v_profile_id and frequency = 'DAILY'
     and scheduled_date = p_today and source = 'TEMPLATE' and status = 'PENDING';
  get diagnostics v_replaced = row_count;

  insert into public.quests (
    game_profile_id, template_code, title, description, category, frequency,
    difficulty, estimated_minutes, base_xp, is_optional, success_criteria,
    scheduled_date, deadline_at, source, evaluation_mode
  )
  select
    v_profile_id, q.template_code, q.title, q.description, q.category, 'DAILY',
    q.difficulty, q.estimated_minutes, q.base_xp, q.is_optional, q.success_criteria,
    p_today, q.deadline_at, 'AI', q.evaluation_mode
  from jsonb_to_recordset(coalesce(p_quests, '[]'::jsonb)) as q(
    template_code text, title text, description text, category text,
    difficulty smallint, estimated_minutes integer, base_xp integer,
    is_optional boolean, success_criteria jsonb, deadline_at timestamptz,
    evaluation_mode public.evaluation_mode
  );
  get diagnostics v_inserted = row_count;

  insert into public.game_events (game_profile_id, event_type, payload)
  values (v_profile_id, 'MENTOR_PLAN', jsonb_build_object('day', p_today, 'quests', v_inserted));

  return jsonb_build_object('status', 'applied', 'replaced', v_replaced, 'inserted', v_inserted);
end;
$$;

-- ---------------------------------------------------------------------------
-- save_quest_evaluation: store Orion's verdict for a pending quest. The first
-- verdict wins: a retried request reuses it instead of asking the AI again.
-- ---------------------------------------------------------------------------
create or replace function public.save_quest_evaluation(
  p_user_id  uuid,
  p_quest_id uuid,
  p_answer   text,
  p_eval     jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_status public.quest_status;
  v_row public.quest_evaluations%rowtype;
begin
  select id into v_profile_id from public.game_profiles where user_id = p_user_id;
  if v_profile_id is null then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0001';
  end if;

  select status into v_status from public.quests
   where id = p_quest_id and game_profile_id = v_profile_id
   for update;
  if v_status is null then
    raise exception 'QUEST_NOT_FOUND' using errcode = 'P0001';
  end if;

  select * into v_row from public.quest_evaluations where quest_id = p_quest_id;
  if v_row.id is null then
    if v_status <> 'PENDING' then
      raise exception 'QUEST_NOT_PENDING' using errcode = 'P0001';
    end if;
    insert into public.quest_evaluations (
      quest_id, game_profile_id, answer, grade, reasoning, mistakes, recommendations, next_topic
    ) values (
      p_quest_id, v_profile_id, p_answer,
      (p_eval->>'grade')::public.quest_grade,
      coalesce(p_eval->>'reasoning', ''),
      coalesce(p_eval->'mistakes', '[]'::jsonb),
      coalesce(p_eval->'recommendations', '[]'::jsonb),
      coalesce(p_eval->>'next_topic', '')
    ) returning * into v_row;
  end if;

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.reserve_ai_request(uuid, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.finish_ai_request(uuid, uuid, text, text, integer, integer, bigint, integer, text) from public, anon, authenticated;
revoke all on function public.update_ai_settings(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.add_mentor_messages(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.apply_ai_daily_quests(uuid, date, jsonb) from public, anon, authenticated;
revoke all on function public.save_quest_evaluation(uuid, uuid, text, jsonb) from public, anon, authenticated;

grant execute on function public.reserve_ai_request(uuid, text, timestamptz, timestamptz) to service_role;
grant execute on function public.finish_ai_request(uuid, uuid, text, text, integer, integer, bigint, integer, text) to service_role;
grant execute on function public.update_ai_settings(uuid, integer, integer) to service_role;
grant execute on function public.add_mentor_messages(uuid, jsonb) to service_role;
grant execute on function public.apply_ai_daily_quests(uuid, date, jsonb) to service_role;
grant execute on function public.save_quest_evaluation(uuid, uuid, text, jsonb) to service_role;
