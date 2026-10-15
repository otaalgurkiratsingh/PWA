-- Phase 3 (AI interview onboarding upgrade): diet drafts and the diet_draft AI operation.
--
-- 1. AI accounting: the new `diet_draft` operation is allowed and counts under the EXISTING daily
--    chat allowance (question_per_day, 20 a day by default) together with coach_question. No new quota.
-- 2. plan_drafts gains `kind` ('training' | 'diet'). Diet drafts use the same store/decide RPCs, the
--    same owner-only RLS and the same approval rule: nothing is active until the person accepts.
--    Storing a new draft supersedes only open drafts of the SAME kind.
-- 3. Profile JSON (documentation only; no schema change needed). The profile lives in
--    journal_documents (collection 'settings', body.profile), validated by the app's zod schema and
--    bounded to 200 kB by sync_push. Phase 3 adds these optional fields, all personal data under the
--    same RLS + active-membership rules as every other journal document:
--      profile.training.location        adds 'truck' (truck cab / rest stop; no gym access)
--      profile.training.lifestyle       'standard' | 'trucker'
--      profile.training.pain_areas      subset of lower_back, knees, shoulders, neck, hips, wrists_ankles
--      profile.training.pain_note       free text, ≤ 300 chars ("anything hurting right now?")
--      profile.training.goal_direction  'lean' | 'athletic' | 'strong' | null (picked, never inferred)
--      profile.training.sleep_pattern   'regular' | 'irregular' | 'shift' | null
--      profile.food_prefs.cuisine       'unspecified' | 'punjabi_home' | 'mixed' | 'western' (asked, never inferred)
--      profile.body                     weight_kg, age_years, sex, goal_weight_kg, goal_weeks, no_timeline, timeline_checked
--      profile.profiling                week-1 question log: started_on, asked {key: date}, skipped [keys]
--      profile.diet_plan                the accepted food plan: dish ids + servings, targets, source, accepted_at
--      profile.adaptation               weekly proposal decisions: {week_start_date: accepted|edited|dismissed}
--    Weight, age, sex, sleep and pain areas are health-adjacent personal data. They are never sent
--    to the AI provider except the minimum each operation needs (see SECURITY_AND_DATA_FLOW.md).

-- ---------------------------------------------------------------------------
-- 1. The diet_draft operation
-- ---------------------------------------------------------------------------
alter table private.ai_requests drop constraint if exists ai_requests_operation_check;
alter table private.ai_requests add constraint ai_requests_operation_check
  check (operation in ('photo_suggest', 'weekly_review', 'coach_question', 'onboarding_plan', 'diet_draft'));

create or replace function public.ai_reserve(p_user uuid, p_operation_id uuid, p_operation text, p_reserve_usd numeric, p_timezone text default 'UTC')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing private.ai_requests;
  v_limits private.ai_limits;
  v_budget private.ai_budget;
  v_month date := date_trunc('month', now())::date;
  v_tz text := 'UTC';
  v_day_start timestamptz;
  v_used integer;
  v_limit integer;
  v_spent numeric;
  v_calls integer;
  v_id uuid;
  v_first_plan timestamptz;
begin
  if p_operation not in ('photo_suggest', 'weekly_review', 'coach_question', 'onboarding_plan', 'diet_draft') or p_reserve_usd is null or p_reserve_usd <= 0 then
    raise exception 'invalid reservation' using errcode = '22023';
  end if;
  -- Only real IANA zones; anything else falls back to UTC (the client never sets the window).
  if p_timezone is not null and exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_timezone) then
    v_tz := p_timezone;
  end if;
  v_day_start := (date_trunc('day', now() at time zone v_tz)) at time zone v_tz;

  -- Serialize per user and globally so concurrent requests cannot both pass a limit check.
  perform pg_advisory_xact_lock(hashtext('ai-global'));
  perform pg_advisory_xact_lock(hashtext('ai-user:' || p_user::text));

  if not exists (select 1 from private.approved_members m where m.user_id = p_user and m.status = 'active') then
    return jsonb_build_object('status', 'not_member');
  end if;

  select * into v_existing from private.ai_requests r where r.user_id = p_user and r.operation_id = p_operation_id;
  if found then
    return jsonb_build_object('status', case v_existing.status
      when 'succeeded' then 'done' when 'failed' then 'failed' when 'expired' then 'failed' else 'in_progress' end,
      'request_id', v_existing.id, 'result', v_existing.result);
  end if;

  update private.ai_requests set status = 'expired', finished_at = now()
    where status in ('reserved', 'in_progress') and created_at < now() - interval '10 minutes';

  -- One AI request in flight per person (any operation).
  if exists (select 1 from private.ai_requests r where r.user_id = p_user and r.status in ('reserved', 'in_progress')) then
    return jsonb_build_object('status', 'busy');
  end if;

  select * into v_limits from private.ai_limits where id;
  if p_operation = 'photo_suggest' then
    v_limit := v_limits.photo_per_day;
    select count(*) into v_used from private.ai_requests r
      where r.user_id = p_user and r.operation = p_operation and r.created_at >= v_day_start and r.status <> 'failed';
  elsif p_operation in ('coach_question', 'diet_draft') then
    -- Diet drafts share the daily chat allowance (no new quota).
    v_limit := v_limits.question_per_day;
    select count(*) into v_used from private.ai_requests r
      where r.user_id = p_user and r.operation in ('coach_question', 'diet_draft') and r.created_at >= v_day_start and r.status <> 'failed';
  elsif p_operation = 'onboarding_plan' then
    -- The first successful plan ever is free of the weekly regeneration limit.
    select min(r.created_at) into v_first_plan from private.ai_requests r
      where r.user_id = p_user and r.operation = p_operation and r.status = 'succeeded';
    v_limit := v_limits.plan_regen_per_week + case when v_first_plan is null then 1 else 0 end;
    select count(*) into v_used from private.ai_requests r
      where r.user_id = p_user and r.operation = p_operation and r.created_at >= now() - interval '7 days'
        and r.status <> 'failed' and r.created_at is distinct from v_first_plan;
    if v_first_plan is null then v_used := 0; end if;
  else
    v_limit := v_limits.review_per_week;
    select count(*) into v_used from private.ai_requests r
      where r.user_id = p_user and r.operation = p_operation and r.created_at >= now() - interval '7 days'
        and r.status <> 'failed';
  end if;
  if v_used >= v_limit then
    return jsonb_build_object('status', 'limit_user', 'used', v_used, 'limit', v_limit);
  end if;

  insert into private.ai_budget (month) values (v_month) on conflict (month) do nothing;
  select * into v_budget from private.ai_budget b where b.month = v_month;
  if v_budget.disabled then
    return jsonb_build_object('status', 'disabled');
  end if;
  select coalesce(sum(coalesce(r.actual_usd, r.reserved_usd)), 0), count(*) into v_spent, v_calls
    from private.ai_requests r where r.created_at >= v_month;
  if v_spent + p_reserve_usd > v_budget.limit_usd or v_calls >= v_budget.max_calls then
    return jsonb_build_object('status', 'limit_budget');
  end if;

  insert into private.ai_requests (user_id, operation_id, operation, status, reserved_usd)
    values (p_user, p_operation_id, p_operation, 'in_progress', p_reserve_usd)
    returning id into v_id;
  return jsonb_build_object('status', 'reserved', 'request_id', v_id);
end;
$$;
revoke all on function public.ai_reserve(uuid, uuid, text, numeric, text) from public, anon, authenticated;
grant execute on function public.ai_reserve(uuid, uuid, text, numeric, text) to service_role;

-- "Messages left today" includes diet drafts, since they share the chat allowance.
create or replace function public.my_ai_usage(p_timezone text default 'UTC')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text := 'UTC';
  v_day_start timestamptz;
  uid uuid := auth.uid();
begin
  if uid is null or not private.is_active_member() then
    return null;
  end if;
  if p_timezone is not null and exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_timezone) then
    v_tz := p_timezone;
  end if;
  v_day_start := (date_trunc('day', now() at time zone v_tz)) at time zone v_tz;
  return jsonb_build_object(
    'photo_today', (select count(*) from private.ai_requests r where r.user_id = uid and r.operation = 'photo_suggest' and r.created_at >= v_day_start and r.status <> 'failed'),
    'questions_today', (select count(*) from private.ai_requests r where r.user_id = uid and r.operation in ('coach_question', 'diet_draft') and r.created_at >= v_day_start and r.status <> 'failed'),
    'reviews_week', (select count(*) from private.ai_requests r where r.user_id = uid and r.operation = 'weekly_review' and r.created_at >= now() - interval '7 days' and r.status <> 'failed'),
    'plans_week', (select count(*) from private.ai_requests r where r.user_id = uid and r.operation = 'onboarding_plan' and r.created_at >= now() - interval '7 days' and r.status <> 'failed'),
    'has_first_plan', exists (select 1 from private.ai_requests r where r.user_id = uid and r.operation = 'onboarding_plan' and r.status = 'succeeded'),
    'limits', (select jsonb_build_object('photo_per_day', l.photo_per_day, 'question_per_day', l.question_per_day, 'review_per_week', l.review_per_week, 'plan_regen_per_week', l.plan_regen_per_week) from private.ai_limits l where l.id)
  );
end;
$$;
revoke all on function public.my_ai_usage(text) from public, anon;
grant execute on function public.my_ai_usage(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Diet drafts share the plan-draft table and its approval flow
-- ---------------------------------------------------------------------------
alter table public.plan_drafts add column kind text not null default 'training' check (kind in ('training', 'diet'));

-- One function with a defaulted kind (an overload would make 7-argument calls ambiguous).
drop function public.store_plan_draft(uuid, integer, text, jsonb, jsonb, text, text);
create or replace function public.store_plan_draft(p_user uuid, p_profile_version integer, p_source text, p_plan jsonb, p_response jsonb, p_model_id text, p_prompt_version text, p_kind text default 'training')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.user_is_active(p_user) or not private.user_has_consent(p_user, 'ai_processing') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('training', 'diet') then
    raise exception 'invalid kind' using errcode = '22023';
  end if;
  -- A new draft replaces only the open draft of the same kind (a food plan never cancels a workout plan).
  update public.plan_drafts set status = 'superseded', decided_at = now() where user_id = p_user and status = 'draft' and kind = p_kind;
  insert into public.plan_drafts (user_id, profile_version, source, plan, response, model_id, prompt_version, kind)
    values (p_user, p_profile_version, p_source, p_plan, p_response, p_model_id, p_prompt_version, p_kind)
    returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.store_plan_draft(uuid, integer, text, jsonb, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.store_plan_draft(uuid, integer, text, jsonb, jsonb, text, text, text) to service_role;

-- decide_plan_draft is unchanged: it already checks owner, status and the profile version, and
-- returns the stored plan (a training plan or a food plan) only on acceptance.
comment on column public.plan_drafts.kind is 'training = workout plan draft; diet = food plan draft (dish ids + servings, totals recomputed in code).';
