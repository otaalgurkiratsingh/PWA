-- TrainLuma (formerly Rozana) — V2: text AI Coach (threads/messages), onboarding plan drafts, optional private
-- progress photos, separate photo/AI-image permissions, per-person in-flight limit and
-- timezone-aware daily windows. Builds on 0001/0002; nothing there is weakened.
--
-- Ownership model (same as before): clients READ their own rows through RLS (owner + active
-- membership); every write of model output goes through service-role RPCs called by the `ai`
-- Edge Function AFTER validation. Clients can never insert assistant messages or plan drafts.

begin;

-- ---------------------------------------------------------------------------
-- Separate permissions for photos
-- ---------------------------------------------------------------------------
alter table public.consent_events drop constraint if exists consent_events_consent_type_check;
alter table public.consent_events add constraint consent_events_consent_type_check
  check (consent_type in ('cloud_backup', 'ai_processing', 'health_import', 'photo_storage', 'ai_images'));

-- Latest decision for one consent type, for the CURRENT user. Used by RLS and RPCs.
create or replace function private.has_consent(p_type text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select c.granted from public.consent_events c
    where c.user_id = (select auth.uid()) and c.consent_type = p_type and c.deleted_at is null
    order by c.created_at desc, c.id desc limit 1
  ), false);
$$;
revoke all on function private.has_consent(text) from public, anon;
grant execute on function private.has_consent(text) to authenticated;

-- Same check for a named user (service role only; the Edge Function rechecks before persisting).
create or replace function private.user_has_consent(p_user uuid, p_type text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select c.granted from public.consent_events c
    where c.user_id = p_user and c.consent_type = p_type and c.deleted_at is null
    order by c.created_at desc, c.id desc limit 1
  ), false);
$$;
revoke all on function private.user_has_consent(uuid, text) from public, anon, authenticated;

create or replace function private.user_is_active(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.approved_members m where m.user_id = p_user and m.status = 'active');
$$;
revoke all on function private.user_is_active(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Coach chat: threads and messages
-- ---------------------------------------------------------------------------
create table public.coach_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'Chat' check (char_length(title) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Retention: 90 days after the last message (sliding), or sooner on Delete chat.
  expires_at timestamptz not null default now() + interval '90 days',
  unique (id, user_id)
);
create index coach_threads_owner on public.coach_threads (user_id, updated_at desc);

create table public.coach_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 6000),
  -- The client's request id: replays/duplicate sends map to the same stored pair.
  client_op_id uuid not null,
  -- Validated response (assistant only): suggestions, questions, candidate memories, safety, etc.
  response jsonb check (response is null or (jsonb_typeof(response) = 'object' and pg_column_size(response) <= 60000)),
  schema_version text,
  model_id text,
  prompt_version text,
  created_at timestamptz not null default now(),
  -- A message can only point at a thread of the SAME owner.
  foreign key (thread_id, user_id) references public.coach_threads (id, user_id) on delete cascade,
  unique (user_id, client_op_id, role)
);
create index coach_messages_thread on public.coach_messages (thread_id, user_id, created_at);

revoke all on public.coach_threads, public.coach_messages from public, anon, authenticated;
grant select on public.coach_threads, public.coach_messages to authenticated;
alter table public.coach_threads enable row level security;
alter table public.coach_messages enable row level security;
-- Expired chats are invisible immediately, even before the cleanup job removes them.
create policy coach_threads_select_own on public.coach_threads for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_active_member()) and expires_at > now());
create policy coach_messages_select_own on public.coach_messages for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_active_member())
         and exists (select 1 from public.coach_threads t where t.id = thread_id and t.user_id = (select auth.uid()) and t.expires_at > now()));

-- Delete one chat (or all chats) of the caller. Confirmed memories are a separate store and stay.
create or replace function public.delete_coach_thread(p_thread_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if auth.uid() is null or not private.is_active_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  delete from public.coach_threads t
   where t.user_id = auth.uid() and (p_thread_id is null or t.id = p_thread_id);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.delete_coach_thread(uuid) from public, anon;
grant execute on function public.delete_coach_thread(uuid) to authenticated;

-- Retention job: remove expired chats. Scheduled with pg_cron when available (Supabase has it).
create or replace function private.coach_expire()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  delete from public.coach_threads where expires_at <= now();
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function private.coach_expire() from public, anon, authenticated;

-- Store one validated exchange (user message + assistant reply) atomically.
-- Rechecks membership and AI permission at persistence time; idempotent per client_op_id.
create or replace function public.coach_store_exchange(
  p_user uuid, p_thread_id uuid, p_client_op_id uuid, p_user_text text, p_assistant_text text,
  p_response jsonb, p_schema_version text, p_model_id text, p_prompt_version text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_thread uuid := p_thread_id;
  v_existing public.coach_messages;
begin
  if not private.user_is_active(p_user) or not private.user_has_consent(p_user, 'ai_processing') then
    return jsonb_build_object('status', 'not_allowed');
  end if;
  select * into v_existing from public.coach_messages m
    where m.user_id = p_user and m.client_op_id = p_client_op_id and m.role = 'assistant';
  if found then
    return jsonb_build_object('status', 'duplicate', 'thread_id', v_existing.thread_id, 'assistant_message_id', v_existing.id);
  end if;
  if v_thread is null then
    insert into public.coach_threads (user_id, title) values (p_user, left(coalesce(nullif(trim(p_user_text), ''), 'Chat'), 60))
      returning id into v_thread;
  elsif not exists (select 1 from public.coach_threads t where t.id = v_thread and t.user_id = p_user and t.expires_at > now()) then
    return jsonb_build_object('status', 'thread_not_found');
  end if;
  insert into public.coach_messages (thread_id, user_id, role, content, client_op_id)
    values (v_thread, p_user, 'user', p_user_text, p_client_op_id);
  insert into public.coach_messages (thread_id, user_id, role, content, client_op_id, response, schema_version, model_id, prompt_version)
    values (v_thread, p_user, 'assistant', p_assistant_text, p_client_op_id, p_response, p_schema_version, p_model_id, p_prompt_version)
    returning * into v_existing;
  update public.coach_threads set updated_at = now(), expires_at = now() + interval '90 days' where id = v_thread;
  return jsonb_build_object('status', 'stored', 'thread_id', v_thread, 'assistant_message_id', v_existing.id);
end;
$$;
revoke all on function public.coach_store_exchange(uuid, uuid, uuid, text, text, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.coach_store_exchange(uuid, uuid, uuid, text, text, jsonb, text, text, text) to service_role;
grant select on public.coach_threads, public.coach_messages to service_role;

-- ---------------------------------------------------------------------------
-- Plan drafts (validated AI drafts; activation happens only on the person's approval)
-- ---------------------------------------------------------------------------
create table public.plan_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  status text not null default 'draft' check (status in ('draft', 'accepted', 'rejected', 'superseded')),
  decided_at timestamptz,
  profile_version integer not null check (profile_version >= 0),
  source text not null check (source in ('onboarding', 'chat')),
  plan jsonb not null check (jsonb_typeof(plan) = 'object' and pg_column_size(plan) <= 60000),
  response jsonb not null check (jsonb_typeof(response) = 'object' and pg_column_size(response) <= 60000),
  model_id text not null,
  prompt_version text not null,
  unique (id, user_id)
);
create index plan_drafts_owner on public.plan_drafts (user_id, created_at desc);
revoke all on public.plan_drafts from public, anon, authenticated;
grant select on public.plan_drafts to authenticated;
grant select on public.plan_drafts to service_role;
alter table public.plan_drafts enable row level security;
create policy plan_drafts_select_own on public.plan_drafts for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_active_member()));

create or replace function public.store_plan_draft(p_user uuid, p_profile_version integer, p_source text, p_plan jsonb, p_response jsonb, p_model_id text, p_prompt_version text)
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
  update public.plan_drafts set status = 'superseded', decided_at = now() where user_id = p_user and status = 'draft';
  insert into public.plan_drafts (user_id, profile_version, source, plan, response, model_id, prompt_version)
    values (p_user, p_profile_version, p_source, p_plan, p_response, p_model_id, p_prompt_version)
    returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.store_plan_draft(uuid, integer, text, jsonb, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.store_plan_draft(uuid, integer, text, jsonb, jsonb, text, text) to service_role;

-- The person accepts or rejects a draft. Acceptance requires the profile version the draft was
-- generated for; a stale draft must be regenerated. Returns the validated plan to activate.
create or replace function public.decide_plan_draft(p_draft_id uuid, p_decision text, p_profile_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.plan_drafts;
begin
  if auth.uid() is null or not private.is_active_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_decision not in ('accepted', 'rejected') then
    raise exception 'invalid decision' using errcode = '22023';
  end if;
  select * into v from public.plan_drafts d where d.id = p_draft_id and d.user_id = auth.uid() for update;
  if not found or v.status <> 'draft' then
    return jsonb_build_object('status', 'not_found');
  end if;
  if p_decision = 'accepted' and v.profile_version <> p_profile_version then
    return jsonb_build_object('status', 'stale');
  end if;
  update public.plan_drafts set status = p_decision, decided_at = now() where id = v.id;
  return jsonb_build_object('status', p_decision, 'plan', case when p_decision = 'accepted' then v.plan end);
end;
$$;
revoke all on function public.decide_plan_draft(uuid, text, integer) from public, anon;
grant execute on function public.decide_plan_draft(uuid, text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Optional private progress photos (separate bucket from any food artwork)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('progress-photos', 'progress-photos', false, 1572864, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Objects live at "<owner uuid>/<photo uuid>.jpg". No names, no slot words, no dates in paths.
create policy progress_photos_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'progress-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'
    and (select private.is_active_member())
    and (select private.has_consent('photo_storage')));
create policy progress_photos_select_own on storage.objects for select to authenticated
  using (bucket_id = 'progress-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select private.is_active_member()));
-- Deleting your own photo never needs a permission (withdrawing consent must not trap data).
create policy progress_photos_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'progress-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select private.is_active_member()));

create table public.progress_photos (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  slot text not null check (slot in ('front', 'back', 'left', 'right', 'inspiration')),
  object_path text not null unique check (object_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'),
  width integer not null check (width between 64 and 1600),
  height integer not null check (height between 64 and 1600),
  bytes integer not null check (bytes between 1 and 1572864),
  created_at timestamptz not null default now(),
  check (split_part(object_path, '/', 1) = user_id::text and split_part(object_path, '/', 2) = id::text || '.jpg'),
  unique (id, user_id)
);
create index progress_photos_owner on public.progress_photos (user_id, created_at desc);
revoke all on public.progress_photos from public, anon, authenticated;
grant select, insert, delete on public.progress_photos to authenticated;
grant select on public.progress_photos to service_role;
alter table public.progress_photos enable row level security;
create policy progress_photos_meta_select on public.progress_photos for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_active_member()));
create policy progress_photos_meta_insert on public.progress_photos for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.is_active_member()) and (select private.has_consent('photo_storage')));
create policy progress_photos_meta_delete on public.progress_photos for delete to authenticated
  using (user_id = (select auth.uid()) and (select private.is_active_member()));

-- ---------------------------------------------------------------------------
-- AI accounting v2: new operations, one in-flight request per person, timezone-aware days,
-- separate onboarding-plan quota. Called by the Edge Function with the service role only.
-- ---------------------------------------------------------------------------
alter table private.ai_requests drop constraint if exists ai_requests_operation_check;
alter table private.ai_requests add constraint ai_requests_operation_check
  check (operation in ('photo_suggest', 'weekly_review', 'coach_question', 'onboarding_plan'));

alter table private.ai_limits add column plan_regen_per_week integer not null default 2 check (plan_regen_per_week >= 0);
-- Ordinary chat: 20 messages per person per day (was 5 short questions).
alter table private.ai_limits alter column question_per_day set default 20;
update private.ai_limits set question_per_day = 20 where question_per_day = 5;

drop function public.ai_reserve(uuid, uuid, text, numeric);

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
  if p_operation not in ('photo_suggest', 'weekly_review', 'coach_question', 'onboarding_plan') or p_reserve_usd is null or p_reserve_usd <= 0 then
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
  elsif p_operation = 'coach_question' then
    v_limit := v_limits.question_per_day;
    select count(*) into v_used from private.ai_requests r
      where r.user_id = p_user and r.operation = p_operation and r.created_at >= v_day_start and r.status <> 'failed';
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

-- Counts only; includes the onboarding plan allowance. Timezone for "today" comes from the caller.
drop function public.my_ai_usage();
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
    'questions_today', (select count(*) from private.ai_requests r where r.user_id = uid and r.operation = 'coach_question' and r.created_at >= v_day_start and r.status <> 'failed'),
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
-- Account deletion covers the new personal data too
-- ---------------------------------------------------------------------------
create or replace function public.request_account_deletion()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_paths text[];
begin
  if uid is null or not private.is_active_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  -- Stop access first: every policy requires an active membership, so existing tokens stop working.
  update private.approved_members set status = 'deleting', updated_at = now() where user_id = uid;
  update private.ai_requests set status = 'expired', finished_at = now() where user_id = uid and status in ('reserved', 'in_progress');
  select coalesce(array_agg(p.object_path), '{}') into v_paths from public.progress_photos p where p.user_id = uid;
  delete from public.progress_photos where user_id = uid;
  delete from public.coach_threads where user_id = uid;
  delete from public.plan_drafts where user_id = uid;
  delete from public.journal_documents where user_id = uid;
  delete from public.change_proposals where user_id = uid;
  delete from public.coach_reviews where user_id = uid;
  delete from public.user_confirmed_memory where user_id = uid;
  delete from public.consent_events where user_id = uid;
  delete from private.sync_receipts where user_id = uid;
  delete from private.sync_counters where user_id = uid;
  -- Stored photo files are removed by the app through the Storage API before this call; any left
  -- (e.g. the phone went offline) are listed here for the owner to purge. They are unreadable now.
  insert into private.privacy_jobs (user_id, kind, status) values (uid, 'delete_account', 'queued');
  if array_length(v_paths, 1) is not null then
    insert into private.deletion_ledger (user_id, backup_expiry_note)
      values (uid, 'Re-apply after any restore. Purge any remaining progress-photos objects under ' || uid::text || '/')
      on conflict (user_id) do update set deleted_at = now(), backup_expiry_note = excluded.backup_expiry_note;
  else
    insert into private.deletion_ledger (user_id, backup_expiry_note)
      values (uid, 'Re-apply after any restore from a backup taken before this date.')
      on conflict (user_id) do update set deleted_at = now();
  end if;
  return 'deleting';
end;
$$;
revoke all on function public.request_account_deletion() from public, anon;
grant execute on function public.request_account_deletion() to authenticated;

-- Retention schedule (Supabase provides pg_cron; the local test database may not).
do $$
begin
  if exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('trainluma-coach-expire', '17 3 * * *', 'select private.coach_expire()');
  end if;
exception when others then
  raise notice 'pg_cron not scheduled (%); expired chats stay hidden by RLS and are removed by coach_expire()', sqlerrm;
end;
$$;

commit;
