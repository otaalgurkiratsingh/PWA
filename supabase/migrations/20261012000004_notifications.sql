-- TrainLuma: reminders and motivation notifications (Web Push).
--
-- * push_subscriptions: one row per device that allowed notifications (endpoint + public keys only;
--   payloads are end-to-end encrypted to the device, so the push service cannot read them).
-- * notification_prefs: daily motivation time, gym reminder days/time/lead, lock-screen privacy.
-- * private.notification_log: at most one notification of each kind per person per local day.
-- * notify_* RPCs: used only by the `notify` Edge Function (service role), which pg_cron calls
--   every 5 minutes (scheduled by the owner, see supabase/admin/notifications.sql).
-- Revoking or deleting a member removes their devices and preferences at once.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) between 20 and 1000 and endpoint like 'https://%'),
  p256dh text not null check (char_length(p256dh) between 80 and 100),
  auth_secret text not null check (char_length(auth_secret) between 16 and 30),
  created_at timestamptz not null default now(),
  last_sent_at timestamptz
);
create index push_subscriptions_user on public.push_subscriptions (user_id);

revoke all on public.push_subscriptions from public, anon, authenticated;
grant select on public.push_subscriptions to authenticated;
alter table public.push_subscriptions enable row level security;
create policy push_subscriptions_select_own on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_active_member()));

-- Save this device (idempotent). A browser endpoint already registered to someone else (shared
-- phone, new person signed in) moves to the caller: one device notifies one person.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void
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
  if (select count(*) from public.push_subscriptions where user_id = uid and endpoint <> p_endpoint) >= 10 then
    raise exception 'too many devices' using errcode = '54000';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth_secret)
    values (uid, p_endpoint, p_p256dh, p_auth)
    on conflict (endpoint) do update set user_id = uid, p256dh = excluded.p256dh, auth_secret = excluded.auth_secret, created_at = now();
end;
$$;
revoke all on function public.save_push_subscription(text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;

create or replace function public.delete_push_subscription(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  delete from public.push_subscriptions where user_id = auth.uid() and (p_endpoint is null or endpoint = p_endpoint);
end;
$$;
revoke all on function public.delete_push_subscription(text) from public, anon;
grant execute on function public.delete_push_subscription(text) to authenticated;

create table public.notification_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  timezone text not null check (char_length(timezone) between 1 and 64),
  motivation_enabled boolean not null default false,
  motivation_time time not null default '08:00',
  gym_enabled boolean not null default false,
  gym_days smallint[] not null default '{}' check (gym_days <@ array[0,1,2,3,4,5,6]::smallint[] and cardinality(gym_days) <= 7),
  gym_time time not null default '18:00',
  lead_minutes smallint not null default 15 check (lead_minutes between 5 and 60),
  hide_details boolean not null default false,
  updated_at timestamptz not null default now()
);

revoke all on public.notification_prefs from public, anon, authenticated;
grant select, insert, update, delete on public.notification_prefs to authenticated;
alter table public.notification_prefs enable row level security;
create policy notification_prefs_own on public.notification_prefs for all to authenticated
  using (user_id = (select auth.uid()) and (select private.is_active_member()))
  with check (user_id = (select auth.uid()) and (select private.is_active_member()));

-- Owner and timestamp are server-controlled; the time zone must be a real IANA name.
create or replace function private.notification_prefs_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.user_id := auth.uid();
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'unknown time zone' using errcode = '22023';
  end if;
  new.gym_days := array(select distinct d from unnest(new.gym_days) d order by d);
  new.updated_at := now();
  return new;
end;
$$;
create trigger notification_prefs_guard before insert or update on public.notification_prefs
  for each row execute function private.notification_prefs_guard();

create table private.notification_log (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('motivation', 'gym')),
  local_date date not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, kind, local_date)
);

-- Stop notifications the moment access ends (revoked, deleting).
create or replace function private.member_notifications_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'active' then
    delete from public.push_subscriptions where user_id = new.user_id;
    delete from public.notification_prefs where user_id = new.user_id;
  end if;
  return new;
end;
$$;
create trigger member_notifications_cleanup after update of status on private.approved_members
  for each row execute function private.member_notifications_cleanup();

-- Which notifications are due now: motivation in a 30-minute window after the chosen time;
-- gym reminders from (gym time - lead) until the gym time, on chosen weekdays, including a
-- session just after midnight. Only active members with at least one device.
create or replace function public.notify_due(p_now timestamptz default now())
returns table (user_id uuid, kind text, local_date date, hide_details boolean, lead_minutes smallint, timezone text)
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select p.*, (p_now at time zone p.timezone) as local_ts
    from public.notification_prefs p
    join private.approved_members m on m.user_id = p.user_id and m.status = 'active'
    where exists (select 1 from public.push_subscriptions s where s.user_id = p.user_id)
  )
  select b.user_id, 'motivation', b.local_ts::date, b.hide_details, b.lead_minutes, b.timezone
  from base b
  where b.motivation_enabled
    and b.local_ts >= b.local_ts::date + b.motivation_time
    and b.local_ts < b.local_ts::date + b.motivation_time + interval '30 minutes'
  union all
  select b.user_id, 'gym', g.day, b.hide_details, b.lead_minutes, b.timezone
  from base b
  cross join lateral (select (b.local_ts::date + o) as day from generate_series(0, 1) o) g
  where b.gym_enabled
    and extract(dow from g.day)::smallint = any (b.gym_days)
    and b.local_ts >= g.day + b.gym_time - make_interval(mins => b.lead_minutes)
    and b.local_ts < g.day + b.gym_time;
$$;

-- Claim one notification (returns false if it was already sent: cron overlaps never double-send).
create or replace function public.notify_claim(p_user uuid, p_kind text, p_date date)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  insert into private.notification_log (user_id, kind, local_date) values (p_user, p_kind, p_date)
    on conflict do nothing;
  get diagnostics n = row_count;
  return n = 1;
end;
$$;

-- What the message may say: the person's own backed-up workouts (last 90 days), the days they
-- logged meals (dates only), their current plan and weekly target. Nothing else.
create or replace function public.notify_context(p_user uuid, p_today date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'training', (select d.body -> 'profile' -> 'training' from public.journal_documents d
                 where d.user_id = p_user and d.collection = 'settings' and d.deleted_at is null
                 order by d.updated_at desc limit 1),
    'sessions', coalesce((select jsonb_agg(d.body) from (
                   select body from public.journal_documents
                   where user_id = p_user and collection = 'workout_sessions' and deleted_at is null
                     and body ->> 'status' = 'finished' and body ->> 'local_date' >= (p_today - 90)::text
                   order by body ->> 'local_date' desc limit 80) d), '[]'::jsonb),
    'meal_dates', coalesce((select jsonb_agg(distinct d.body ->> 'local_date') from public.journal_documents d
                   where d.user_id = p_user and d.collection = 'meal_entries' and d.deleted_at is null
                     and d.body ->> 'local_date' >= (p_today - 60)::text), '[]'::jsonb),
    'program', (select d.body from public.journal_documents d
                where d.user_id = p_user and d.collection = 'programs' and d.deleted_at is null
                order by d.updated_at desc limit 1)
  );
$$;

create or replace function public.notify_subscriptions(p_user uuid)
returns table (endpoint text, p256dh text, auth_secret text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.endpoint, s.p256dh, s.auth_secret from public.push_subscriptions s
  join private.approved_members m on m.user_id = s.user_id and m.status = 'active'
  where s.user_id = p_user;
$$;

-- Expired device (push service said 404/410) or a successful send.
create or replace function public.notify_result(p_endpoint text, p_gone boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and p_gone;
  update public.push_subscriptions set last_sent_at = now() where endpoint = p_endpoint and not p_gone;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.notify_due(timestamptz)', 'public.notify_claim(uuid, text, date)', 'public.notify_context(uuid, date)',
    'public.notify_subscriptions(uuid)', 'public.notify_result(text, boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
