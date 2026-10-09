-- Rozana — sync, membership/self-service RPCs, AI quota accounting (redesign pass D/E).
-- Builds on 20261009000001_init.sql; nothing there is weakened.
--
-- Journal aggregates (meals, sessions, plans, presets, …) sync as owner-scoped JSON documents.
-- Clients can READ their own documents through RLS but can only WRITE through public.sync_push,
-- which enforces membership, owner, size, idempotency (receipts) and version/conflict rules and
-- allocates a per-user change sequence transactionally (no client clocks in cursors).

begin;

-- ---------------------------------------------------------------------------
-- Synced documents
-- ---------------------------------------------------------------------------
create table public.journal_documents (
  user_id uuid not null references auth.users (id) on delete cascade,
  collection text not null check (collection in (
    'settings', 'foods', 'recipes', 'presets', 'programs', 'exercises',
    'meal_entries', 'workout_sessions', 'weight_entries', 'daily_health', 'daily_log_status')),
  doc_id text not null check (char_length(doc_id) between 1 and 80),
  version bigint not null check (version > 0),
  change_seq bigint not null,
  body jsonb not null check (jsonb_typeof(body) = 'object' and pg_column_size(body) <= 200000),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, collection, doc_id)
);
create index journal_documents_seq on public.journal_documents (user_id, change_seq);

revoke all on public.journal_documents from public, anon, authenticated;
grant select on public.journal_documents to authenticated;
alter table public.journal_documents enable row level security;
create policy journal_documents_select_own on public.journal_documents for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_active_member()));

create table private.sync_counters (
  user_id uuid primary key references auth.users (id) on delete cascade,
  last_seq bigint not null default 0
);

alter table private.sync_receipts alter column row_id drop not null;
alter table private.sync_receipts add column doc_key text;
alter table private.sync_receipts add column status text not null default 'applied' check (status in ('applied', 'deleted'));

create or replace function public.sync_push(p_ops jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  op jsonb;
  results jsonb := '[]'::jsonb;
  v_op_id uuid;
  v_collection text;
  v_doc text;
  v_kind text;
  v_base bigint;
  v_body jsonb;
  v_existing public.journal_documents;
  v_receipt private.sync_receipts;
  v_seq bigint;
  v_version bigint;
  v_own_prior boolean;
begin
  if uid is null or not private.is_active_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(p_ops) <> 'array' or jsonb_array_length(p_ops) > 100 then
    raise exception 'ops must be an array of at most 100 operations' using errcode = '22023';
  end if;

  insert into private.sync_counters (user_id) values (uid) on conflict (user_id) do nothing;

  for op in select * from jsonb_array_elements(p_ops) loop
    v_op_id := (op ->> 'op_id')::uuid;
    v_collection := op ->> 'collection';
    v_doc := op ->> 'doc_id';
    v_kind := op ->> 'kind';
    v_base := coalesce((op ->> 'base_version')::bigint, 0);
    v_body := op -> 'body';

    if v_kind not in ('upsert', 'delete') or v_body is null or jsonb_typeof(v_body) <> 'object' then
      raise exception 'invalid operation' using errcode = '22023';
    end if;
    -- The document must claim the caller as owner; a forged owner is rejected, not rewritten.
    if (v_body ->> 'owner_id') is distinct from uid::text then
      raise exception 'document owner does not match caller' using errcode = '42501';
    end if;

    select * into v_receipt from private.sync_receipts r where r.user_id = uid and r.op_id = v_op_id;
    if found then
      results := results || jsonb_build_object('op_id', v_op_id, 'status', 'duplicate', 'server_version', v_receipt.result_version);
      continue;
    end if;

    select * into v_existing from public.journal_documents d
      where d.user_id = uid and d.collection = v_collection and d.doc_id = v_doc
      for update;

    -- A version produced by one of this device's own earlier ops for the same document
    -- (applied, but the acknowledgement was lost) is not a conflict.
    v_own_prior := false;
    if found and v_existing.version <> v_base and jsonb_typeof(op -> 'prior_op_ids') = 'array' then
      select exists (
        select 1 from private.sync_receipts r
        where r.user_id = uid and r.doc_key = v_doc and r.table_name = v_collection
          and r.result_version = v_existing.version
          and r.op_id::text in (select jsonb_array_elements_text(op -> 'prior_op_ids'))
      ) into v_own_prior;
    end if;

    if found and v_existing.version <> v_base and not v_own_prior then
      results := results || jsonb_build_object(
        'op_id', v_op_id, 'status', 'conflict', 'server_version', v_existing.version,
        'server_body', v_existing.body, 'server_deleted', v_existing.deleted_at is not null);
      continue;
    end if;

    update private.sync_counters c set last_seq = c.last_seq + 1 where c.user_id = uid returning c.last_seq into v_seq;
    v_version := coalesce(v_existing.version, 0) + 1;

    insert into public.journal_documents as d (user_id, collection, doc_id, version, change_seq, body, deleted_at)
    values (uid, v_collection, v_doc, v_version, v_seq, v_body, case when v_kind = 'delete' then now() end)
    on conflict (user_id, collection, doc_id) do update
      set version = excluded.version, change_seq = excluded.change_seq, body = excluded.body,
          deleted_at = case when v_kind = 'delete' then now() else d.deleted_at end, updated_at = now();

    insert into private.sync_receipts (user_id, op_id, table_name, row_id, doc_key, result_version, status)
    values (uid, v_op_id, v_collection, null, v_doc, v_version, case when v_kind = 'delete' then 'deleted' else 'applied' end);

    results := results || jsonb_build_object('op_id', v_op_id, 'status', 'applied', 'server_version', v_version);
  end loop;
  return results;
end;
$$;
revoke all on function public.sync_push(jsonb) from public, anon;
grant execute on function public.sync_push(jsonb) to authenticated;

-- Pull runs as the caller, so RLS (owner + active membership) applies.
create or replace function public.sync_pull(p_since bigint, p_limit integer default 200)
returns table (collection text, doc_id text, version bigint, change_seq bigint, body jsonb, deleted boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  select d.collection, d.doc_id, d.version, d.change_seq, d.body, d.deleted_at is not null
  from public.journal_documents d
  where d.user_id = (select auth.uid()) and d.change_seq > p_since
  order by d.change_seq
  limit least(greatest(p_limit, 1), 500);
$$;
revoke all on function public.sync_pull(bigint, integer) from public, anon;
grant execute on function public.sync_pull(bigint, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Self-service membership status and account deletion
-- ---------------------------------------------------------------------------
create or replace function public.my_membership()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select m.status from private.approved_members m where m.user_id = (select auth.uid())), 'none');
$$;
revoke all on function public.my_membership() from public, anon;
grant execute on function public.my_membership() to authenticated;

create or replace function public.request_account_deletion()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not private.is_active_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  -- Stop access first: every policy requires an active membership, so existing tokens stop working.
  update private.approved_members set status = 'deleting', updated_at = now() where user_id = uid;
  update private.ai_requests set status = 'expired', finished_at = now() where user_id = uid and status in ('reserved', 'in_progress');
  delete from public.journal_documents where user_id = uid;
  delete from public.change_proposals where user_id = uid;
  delete from public.coach_reviews where user_id = uid;
  delete from public.user_confirmed_memory where user_id = uid;
  delete from public.consent_events where user_id = uid;
  delete from private.sync_receipts where user_id = uid;
  delete from private.sync_counters where user_id = uid;
  insert into private.privacy_jobs (user_id, kind, status) values (uid, 'delete_account', 'queued');
  insert into private.deletion_ledger (user_id, backup_expiry_note)
    values (uid, 'Re-apply after any restore from a backup taken before this date.')
    on conflict (user_id) do update set deleted_at = now();
  return 'deleting';
end;
$$;
revoke all on function public.request_account_deletion() from public, anon;
grant execute on function public.request_account_deletion() to authenticated;

-- ---------------------------------------------------------------------------
-- AI quota / budget accounting (called by the Edge Function with the service role only)
-- ---------------------------------------------------------------------------
alter table private.ai_requests add column result jsonb;
alter table private.ai_requests add column usage jsonb;
alter table private.ai_requests add column error text;

create table private.ai_limits (
  id boolean primary key default true check (id),
  photo_per_day integer not null default 3 check (photo_per_day >= 0),
  question_per_day integer not null default 5 check (question_per_day >= 0),
  review_per_week integer not null default 1 check (review_per_week >= 0)
);
insert into private.ai_limits default values;

create or replace function public.ai_reserve(p_user uuid, p_operation_id uuid, p_operation text, p_reserve_usd numeric)
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
  v_used integer;
  v_limit integer;
  v_spent numeric;
  v_calls integer;
  v_id uuid;
begin
  if p_operation not in ('photo_suggest', 'weekly_review', 'coach_question') or p_reserve_usd is null or p_reserve_usd <= 0 then
    raise exception 'invalid reservation' using errcode = '22023';
  end if;
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

  select * into v_limits from private.ai_limits where id;
  if p_operation = 'photo_suggest' then
    v_limit := v_limits.photo_per_day;
    select count(*) into v_used from private.ai_requests r
      where r.user_id = p_user and r.operation = p_operation and r.created_at >= date_trunc('day', now());
  elsif p_operation = 'coach_question' then
    v_limit := v_limits.question_per_day;
    select count(*) into v_used from private.ai_requests r
      where r.user_id = p_user and r.operation = p_operation and r.created_at >= date_trunc('day', now());
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

create or replace function public.ai_finish(p_request_id uuid, p_user uuid, p_status text, p_actual_usd numeric, p_result jsonb, p_usage jsonb, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('succeeded', 'failed') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  update private.ai_requests r
     set status = p_status,
         -- Never record less than the reservation when actual usage is unknown.
         actual_usd = coalesce(p_actual_usd, r.reserved_usd),
         result = p_result, usage = p_usage, error = left(p_error, 300), finished_at = now()
   where r.id = p_request_id and r.user_id = p_user and r.status = 'in_progress';
  if not found then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.ai_reserve(uuid, uuid, text, numeric) from public, anon, authenticated;
revoke all on function public.ai_finish(uuid, uuid, text, numeric, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.ai_reserve(uuid, uuid, text, numeric) to service_role;
grant execute on function public.ai_finish(uuid, uuid, text, numeric, jsonb, jsonb, text) to service_role;

-- What a member may see about their own AI usage (counts only; no global spend figures).
create or replace function public.my_ai_usage()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'photo_today', (select count(*) from private.ai_requests r where r.user_id = (select auth.uid()) and r.operation = 'photo_suggest' and r.created_at >= date_trunc('day', now())),
    'questions_today', (select count(*) from private.ai_requests r where r.user_id = (select auth.uid()) and r.operation = 'coach_question' and r.created_at >= date_trunc('day', now())),
    'reviews_week', (select count(*) from private.ai_requests r where r.user_id = (select auth.uid()) and r.operation = 'weekly_review' and r.created_at >= now() - interval '7 days' and r.status <> 'failed'),
    'limits', (select jsonb_build_object('photo_per_day', l.photo_per_day, 'question_per_day', l.question_per_day, 'review_per_week', l.review_per_week) from private.ai_limits l where l.id)
  )
  where (select private.is_active_member());
$$;
revoke all on function public.my_ai_usage() from public, anon;
grant execute on function public.my_ai_usage() to authenticated;

-- The service role (Edge Function) writes reviews and proposals after validation.
grant select, insert on public.coach_reviews, public.change_proposals to service_role;
grant select on public.journal_documents, public.consent_events to service_role;

commit;
