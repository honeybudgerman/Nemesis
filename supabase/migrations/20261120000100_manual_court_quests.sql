alter table public.court_events
  add column if not exists opened_manually boolean not null default false;

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

  if p_manual then
    select id into v_id from public.court_events
    where game_profile_id = v_hero.game_profile_id and event_code = p_code;
    if found then
      return jsonb_build_object('status', 'exists', 'id', v_id);
    end if;
  elsif exists (
    select 1 from public.court_events
    where game_profile_id = v_hero.game_profile_id and event_day = p_day and not opened_manually
  ) then
    return jsonb_build_object('status', 'exists');
  end if;
  if (select count(*) from public.court_events where game_profile_id = v_hero.game_profile_id and status = 'OPEN') >= p_max_open then
    return jsonb_build_object('status', 'full');
  end if;
  insert into public.court_events (game_profile_id, event_code, event_day, participants, choices, opened_manually)
  values (v_hero.game_profile_id, p_code, p_day, p_participants, p_choices, p_manual)
  on conflict (game_profile_id, event_code) do nothing
  returning id into v_id;
  return jsonb_build_object('status', case when v_id is null then 'exists' else 'opened' end, 'id', v_id);
end;
$$;

-- Preserve the scheduled event endpoint for existing callers.
create or replace function public.open_court_event(
  p_user_id      uuid,
  p_day          date,
  p_code         text,
  p_participants text[],
  p_choices      jsonb,
  p_max_open     integer
) returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.open_court_event_with_mode(p_user_id, p_day, p_code, p_participants, p_choices, p_max_open, false);
$$;

revoke all on function public.open_court_event_with_mode(uuid, date, text, text[], jsonb, integer, boolean) from public, anon, authenticated;
grant execute on function public.open_court_event_with_mode(uuid, date, text, text[], jsonb, integer, boolean) to service_role;
