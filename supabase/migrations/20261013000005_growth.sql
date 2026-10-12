-- TrainLuma Phase 3: retention + referral.
--
-- A) analytics_events + log_events(): first-party, insert-only product analytics (no client reads).
--    Owner views live in schema `private` (SQL Editor only, see supabase/admin/growth.sql).
-- B) food_request_votes + request_food(): "Ask for this food" with a distinct-requester count.
-- C) circles: private groups of 3-6 people. Members see each other's ACTIVE-DAY COUNTS (never food,
--    weights or body data) and short celebratory posts. Max 6 members and max 5 circles per person
--    are enforced by a trigger, so no code path can exceed them.
-- D) "Give a month, get a month": a credit ledger only (no billing system exists yet).
-- E) Notifications v2: three kinds only (routine, gym, insight), max 2 per local day, quiet hours
--    22:00-07:00, any kind dismissed 3 times stops for good. The old daily 'motivation' message is
--    retired: its columns stay for compatibility, but nothing ever claims or sends it.
--
-- Same model as before: clients read their own rows through RLS (owner + active membership) where
-- they read at all; every write goes through SECURITY DEFINER RPCs with an empty search_path;
-- service-only RPCs are granted to service_role alone. Product rules: warm, never guilt; no cash,
-- no inviter leaderboards, nothing sent on anyone's behalf.

begin;

-- ---------------------------------------------------------------------------
-- Small helpers
-- ---------------------------------------------------------------------------

-- A client-supplied calendar date, or null when malformed or implausible (older than ~13 months
-- or more than 2 days ahead). Never raises.
create or replace function private.try_date(p text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;
  return p::date;
exception when others then
  return null;
end;
$$;
revoke all on function private.try_date(text) from public, anon, authenticated;

create or replace function private.try_timestamptz(p text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v timestamptz;
begin
  if p is null or char_length(p) > 40 then
    return null;
  end if;
  v := p::timestamptz;
  if v < now() - interval '400 days' or v > now() + interval '2 days' then
    return null;
  end if;
  return v;
exception when others then
  return null;
end;
$$;
revoke all on function private.try_timestamptz(text) from public, anon, authenticated;

-- Start of the current UTC day (daily limits are per UTC day).
create or replace function private.utc_day_start()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select date_trunc('day', now() at time zone 'utc') at time zone 'utc';
$$;
revoke all on function private.utc_day_start() from public, anon, authenticated;

-- Random index source from the CSPRNG behind gen_random_uuid() (bytes 0-5 and 9-15 are random).
create or replace function private.random_bytes16()
returns bytea
language sql
volatile
set search_path = ''
as $$
  select uuid_send(gen_random_uuid());
$$;
revoke all on function private.random_bytes16() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- A) Analytics (first-party, insert-only)
-- ---------------------------------------------------------------------------
create table public.analytics_events (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  event text not null check (event ~ '^[a-z][a-z0-9_]{2,39}$'),
  props jsonb not null default '{}'::jsonb check (jsonb_typeof(props) = 'object' and octet_length(props::text) <= 2000),
  client_ts timestamptz,
  local_date date,
  created_at timestamptz not null default now()
);
create index analytics_events_user_created on public.analytics_events (user_id, created_at);
create index analytics_events_user_day on public.analytics_events (user_id, local_date) where event in ('food_logged', 'workout_finished', 'app_open');
create index analytics_events_event_day on public.analytics_events (event, local_date);

revoke all on public.analytics_events from public, anon, authenticated;
revoke all on sequence public.analytics_events_id_seq from public, anon, authenticated;
alter table public.analytics_events enable row level security;
-- No policies: clients can neither read nor write the table; log_events() is the only way in.

-- Insert up to 100 events per call. Every event is validated (a bad one rejects the whole batch,
-- nothing is stored); events past 3000 per person per UTC day are dropped silently.
-- Returns the number of rows stored.
create or replace function public.log_events(p_events jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  e jsonb;
  v_props jsonb;
  v_used integer;
  v_room integer;
  v_n integer;
begin
  if uid is null or not private.is_active_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_events is null or jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 100 then
    raise exception 'events must be an array of at most 100 events' using errcode = '22023';
  end if;
  for e in select * from jsonb_array_elements(p_events) loop
    if jsonb_typeof(e) <> 'object' or jsonb_typeof(e -> 'event') is distinct from 'string'
       or (e ->> 'event') !~ '^[a-z][a-z0-9_]{2,39}$' then
      raise exception 'invalid event name' using errcode = '22023';
    end if;
    v_props := coalesce(nullif(e -> 'props', 'null'::jsonb), '{}'::jsonb);
    if jsonb_typeof(v_props) <> 'object' or octet_length(v_props::text) > 2000 then
      raise exception 'props must be an object of at most 2000 bytes' using errcode = '22023';
    end if;
  end loop;
  if jsonb_array_length(p_events) = 0 then
    return 0;
  end if;

  -- One batch at a time per person, so the daily cap holds under concurrent calls.
  perform pg_advisory_xact_lock(hashtextextended('log_events:' || uid::text, 0));
  select count(*) into v_used from public.analytics_events a
   where a.user_id = uid and a.created_at >= private.utc_day_start();
  v_room := greatest(0, 3000 - v_used);
  if v_room = 0 then
    return 0;
  end if;

  insert into public.analytics_events (user_id, event, props, client_ts, local_date)
  select uid, x.e ->> 'event', coalesce(nullif(x.e -> 'props', 'null'::jsonb), '{}'::jsonb),
         private.try_timestamptz(x.e ->> 'client_ts'),
         (select d from private.try_date(x.e ->> 'local_date') d where d between current_date - 400 and current_date + 2)
    from jsonb_array_elements(p_events) with ordinality as x (e, i)
   order by x.i
   limit v_room;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.log_events(jsonb) from public, anon;
grant execute on function public.log_events(jsonb) to authenticated;

-- Retention for raw events (owner may schedule it; see supabase/admin/growth.sql).
create or replace function private.analytics_expire()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  delete from public.analytics_events where created_at < now() - interval '400 days';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function private.analytics_expire() from public, anon, authenticated;

-- Days on which a person logged food or finished a workout, from either source:
-- analytics events ('food_logged', 'workout_finished') and backed-up journal documents
-- (meal entries; finished workout sessions). Used by circle boards, referral activation and the
-- notify function. p_strict (referral activation): only records written within a few days of the
-- date they claim (created between local_date - 1 and local_date + 3), so a burst of back-dated
-- entries cannot fake a week of logging.
create or replace function private.logged_dates(p_user uuid, p_from date, p_to date, p_strict boolean default false)
returns setof date
language sql
stable
security definer
set search_path = ''
as $$
  select a.local_date
    from public.analytics_events a
   where a.user_id = p_user
     and a.event in ('food_logged', 'workout_finished')
     and a.local_date between p_from and p_to
     and (not p_strict or (a.created_at at time zone 'utc')::date between a.local_date - 1 and a.local_date + 3)
  union
  select x.d
    from (
      select private.try_date(j.body ->> 'local_date') as d, j.created_at
        from public.journal_documents j
       where j.user_id = p_user
         and j.deleted_at is null
         and (j.body ->> 'deleted_at') is null
         and (j.collection = 'meal_entries' or (j.collection = 'workout_sessions' and j.body ->> 'status' = 'finished'))
         and j.body ->> 'local_date' between p_from::text and p_to::text
    ) x
   where x.d between p_from and p_to
     and (not p_strict or (x.created_at at time zone 'utc')::date between x.d - 1 and x.d + 3);
$$;
revoke all on function private.logged_dates(uuid, date, date, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- B) Food requests
-- ---------------------------------------------------------------------------
create table public.food_request_votes (
  user_id uuid not null references auth.users (id) on delete cascade,
  norm_text text not null check (char_length(norm_text) between 2 and 80),
  raw_text text not null check (char_length(raw_text) between 1 and 120),
  created_at timestamptz not null default now(),
  unique (user_id, norm_text)
);
create index food_request_votes_text on public.food_request_votes (norm_text);
revoke all on public.food_request_votes from public, anon, authenticated;
alter table public.food_request_votes enable row level security;

-- Lower-case, trimmed, inner whitespace collapsed. 2-80 characters or an error.
create or replace function private.norm_food_text(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g')));
$$;
revoke all on function private.norm_food_text(text) from public, anon, authenticated;

-- Record the caller's request (idempotent per person and text) and return how many different
-- people asked for the same thing. At most 50 new requests per person per UTC day.
create or replace function public.request_food(p_text text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_norm text := private.norm_food_text(p_text);
begin
  if uid is null or not private.is_active_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if char_length(v_norm) not between 2 and 80 then
    raise exception 'food text must be 2 to 80 characters' using errcode = '22023';
  end if;
  if not exists (select 1 from public.food_request_votes v where v.user_id = uid and v.norm_text = v_norm)
     and (select count(*) from public.food_request_votes v where v.user_id = uid and v.created_at >= private.utc_day_start()) >= 50 then
    raise exception 'too many requests today' using errcode = '54000';
  end if;
  insert into public.food_request_votes (user_id, norm_text, raw_text)
    values (uid, v_norm, left(btrim(regexp_replace(p_text, '\s+', ' ', 'g')), 120))
    on conflict (user_id, norm_text) do nothing;
  return jsonb_build_object('count', (select count(*) from public.food_request_votes v where v.norm_text = v_norm));
end;
$$;
revoke all on function public.request_food(text) from public, anon;
grant execute on function public.request_food(text) to authenticated;

-- ---------------------------------------------------------------------------
-- C) Circles
-- ---------------------------------------------------------------------------
create table public.circles (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  -- 6 characters from an unambiguous alphabet (no I, O, 0, 1).
  join_code text not null unique check (join_code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.circle_members (
  circle_id uuid not null references public.circles (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 24),
  avatar text not null check (avatar in ('orb', 'bloom', 'buddy', 'spark', 'panda', 'kitty', 'bear', 'sher', 'bot', 'sprout')),
  share_prs boolean not null default true,
  joined_at timestamptz not null default now(),
  primary key (circle_id, user_id)
);
create index circle_members_user on public.circle_members (user_id);

create table public.circle_posts (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null,
  user_id uuid not null,
  kind text not null check (kind in ('pr', 'milestone', 'streak')),
  text text not null check (char_length(text) between 1 and 140),
  created_at timestamptz not null default now(),
  -- Leaving a circle takes your posts with you.
  foreign key (circle_id, user_id) references public.circle_members (circle_id, user_id) on delete cascade
);
create index circle_posts_circle on public.circle_posts (circle_id, created_at desc);
create index circle_posts_user on public.circle_posts (user_id, created_at);

-- Membership check for policies (SECURITY DEFINER avoids recursive RLS on circle_members).
create or replace function private.is_circle_member(p_circle uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.circle_members m where m.circle_id = p_circle and m.user_id = (select auth.uid()));
$$;
revoke all on function private.is_circle_member(uuid) from public, anon;
grant execute on function private.is_circle_member(uuid) to authenticated;

revoke all on public.circles, public.circle_members, public.circle_posts from public, anon, authenticated;
grant select on public.circles, public.circle_members to authenticated;
grant select, delete on public.circle_posts to authenticated;
alter table public.circles enable row level security;
alter table public.circle_members enable row level security;
alter table public.circle_posts enable row level security;
create policy circles_select_member on public.circles for select to authenticated
  using ((select private.is_active_member()) and private.is_circle_member(id));
create policy circle_members_select_member on public.circle_members for select to authenticated
  using ((select private.is_active_member()) and private.is_circle_member(circle_id));
create policy circle_posts_select_member on public.circle_posts for select to authenticated
  using ((select private.is_active_member()) and private.is_circle_member(circle_id) and created_at > now() - interval '30 days');
create policy circle_posts_delete_own on public.circle_posts for delete to authenticated
  using (user_id = (select auth.uid()) and (select private.is_active_member()));

-- Hard caps for every insert path: 6 members per circle, 5 circles per person.
create or replace function private.circle_members_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.circles c where c.id = new.circle_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if (select count(*) from public.circle_members m where m.circle_id = new.circle_id) >= 6 then
    raise exception 'circle_full' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('circles:' || new.user_id::text, 0));
  if (select count(*) from public.circle_members m where m.user_id = new.user_id) >= 5 then
    raise exception 'circle_limit' using errcode = 'P0001';
  end if;
  new.joined_at := now();
  return new;
end;
$$;
create trigger circle_members_guard before insert on public.circle_members
  for each row execute function private.circle_members_guard();

create or replace function private.circle_profile_check(p_display_name text, p_avatar text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := btrim(regexp_replace(coalesce(p_display_name, ''), '\s+', ' ', 'g'));
begin
  if char_length(v) not between 1 and 24 then
    raise exception 'display name must be 1 to 24 characters' using errcode = '22023';
  end if;
  if p_avatar is null or p_avatar not in ('orb', 'bloom', 'buddy', 'spark', 'panda', 'kitty', 'bear', 'sher', 'bot', 'sprout') then
    raise exception 'unknown avatar' using errcode = '22023';
  end if;
  return v;
end;
$$;
revoke all on function private.circle_profile_check(text, text) from public, anon, authenticated;

create or replace function private.require_member()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_active_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;
revoke all on function private.require_member() from public, anon, authenticated;

create or replace function public.create_circle(p_name text, p_display_name text, p_avatar text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_member();
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_display text := private.circle_profile_check(p_display_name, p_avatar);
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_bytes bytea;
  v_id uuid;
begin
  if char_length(v_name) not between 1 and 40 then
    raise exception 'circle name must be 1 to 40 characters' using errcode = '22023';
  end if;
  if (select count(*) from public.circle_members m where m.user_id = uid) >= 5 then
    raise exception 'circle_limit' using errcode = 'P0001';
  end if;
  for attempt in 1..20 loop
    v_bytes := private.random_bytes16();
    v_code := '';
    for i in 0..5 loop
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
    end loop;
    begin
      insert into public.circles (name, join_code, created_by) values (v_name, v_code, uid) returning id into v_id;
      exit;
    exception when unique_violation then
      v_id := null;
    end;
  end loop;
  if v_id is null then
    raise exception 'could not create a join code, try again' using errcode = '55000';
  end if;
  insert into public.circle_members (circle_id, user_id, display_name, avatar) values (v_id, uid, v_display, p_avatar);
  return jsonb_build_object('id', v_id, 'join_code', v_code);
end;
$$;
revoke all on function public.create_circle(text, text, text) from public, anon;
grant execute on function public.create_circle(text, text, text) to authenticated;

-- Join by code (case-insensitive; spaces and dashes ignored). Idempotent for an existing member.
-- Errors: 'not_found', 'circle_full' (6 members), 'circle_limit' (already in 5 circles).
create or replace function public.join_circle(p_code text, p_display_name text, p_avatar text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_member();
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g'));
  v_id uuid;
  v_display text;
begin
  select c.id into v_id from public.circles c where c.join_code = v_code for update;
  if v_id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.circle_members m where m.circle_id = v_id and m.user_id = uid) then
    return v_id;
  end if;
  v_display := private.circle_profile_check(p_display_name, p_avatar);
  insert into public.circle_members (circle_id, user_id, display_name, avatar) values (v_id, uid, v_display, p_avatar);
  return v_id;
end;
$$;
revoke all on function public.join_circle(text, text, text) from public, anon;
grant execute on function public.join_circle(text, text, text) to authenticated;

-- Leave (your posts go with you). The circle is deleted when its last member leaves.
create or replace function public.leave_circle(p_circle uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_member();
begin
  perform 1 from public.circles c where c.id = p_circle for update;
  delete from public.circle_members m where m.circle_id = p_circle and m.user_id = uid;
  if found and not exists (select 1 from public.circle_members m where m.circle_id = p_circle) then
    delete from public.circles c where c.id = p_circle;
  end if;
end;
$$;
revoke all on function public.leave_circle(uuid) from public, anon;
grant execute on function public.leave_circle(uuid) to authenticated;

-- Active days in the 7 days ending p_today, for every member of a circle the caller belongs to.
-- Only counts (never what was eaten or lifted). p_today must be within a day of the server date
-- (time zones), so the board cannot be used to browse anyone's history.
create or replace function public.circle_board(p_circle uuid, p_today date)
returns table (user_id uuid, display_name text, avatar text, active_days_7 integer, is_me boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := private.require_member();
begin
  if not exists (select 1 from public.circle_members m where m.circle_id = p_circle and m.user_id = uid) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_today is null or p_today not between current_date - 1 and current_date + 1 then
    raise exception 'invalid date' using errcode = '22023';
  end if;
  return query
    select m.user_id, m.display_name, m.avatar,
           (select count(*)::integer from private.logged_dates(m.user_id, p_today - 6, p_today) d),
           m.user_id = uid
      from public.circle_members m
     where m.circle_id = p_circle
     order by 4 desc, m.display_name, m.user_id;
end;
$$;
revoke all on function public.circle_board(uuid, date) from public, anon;
grant execute on function public.circle_board(uuid, date) to authenticated;

-- A short celebratory post (the app writes the text, e.g. "New best: Back squat 85 kg 🎉").
-- Members only; at most 10 posts per person per UTC day across all circles.
create or replace function public.post_to_circle(p_circle uuid, p_kind text, p_text text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_member();
  v_text text := btrim(coalesce(p_text, ''));
  v_id uuid;
begin
  if not exists (select 1 from public.circle_members m where m.circle_id = p_circle and m.user_id = uid) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('pr', 'milestone', 'streak') then
    raise exception 'unknown post kind' using errcode = '22023';
  end if;
  if char_length(v_text) not between 1 and 140 then
    raise exception 'post must be 1 to 140 characters' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('circle_posts:' || uid::text, 0));
  if (select count(*) from public.circle_posts p where p.user_id = uid and p.created_at >= private.utc_day_start()) >= 10 then
    raise exception 'post_limit' using errcode = '54000';
  end if;
  insert into public.circle_posts (circle_id, user_id, kind, text) values (p_circle, uid, p_kind, v_text) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.post_to_circle(uuid, text, text) from public, anon;
grant execute on function public.post_to_circle(uuid, text, text) to authenticated;

create or replace function public.set_circle_sharing(p_circle uuid, p_share_prs boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_member();
begin
  update public.circle_members m set share_prs = coalesce(p_share_prs, true)
   where m.circle_id = p_circle and m.user_id = uid;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.set_circle_sharing(uuid, boolean) from public, anon;
grant execute on function public.set_circle_sharing(uuid, boolean) to authenticated;

-- Posts are visible for 30 days; this removes them afterwards (owner schedules it).
create or replace function private.circle_posts_expire()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  delete from public.circle_posts where created_at < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function private.circle_posts_expire() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- D) Referral: "Give a month, get a month" (credit ledger only, no billing yet)
-- ---------------------------------------------------------------------------
create table public.referral_codes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  code text not null unique check (code ~ '^[A-Z]{2}-[0-9]{4}$'),
  created_at timestamptz not null default now()
);

-- Kept when an account is deleted (people set to null) so a device cannot redeem twice.
create table public.referral_redemptions (
  id uuid primary key default gen_random_uuid(),
  code_owner uuid references auth.users (id) on delete set null,
  invitee uuid unique references auth.users (id) on delete set null,
  device_hash text not null unique check (device_hash ~ '^[a-f0-9]{64}$'),
  redeemed_at timestamptz not null default now(),
  activated_at timestamptz
);
create index referral_redemptions_owner on public.referral_redemptions (code_owner);

create table public.plus_credits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  months integer not null check (months > 0),
  reason text not null check (reason in ('invitee_bonus', 'inviter_reward')),
  -- queued: banked, applies after the standard 30-day trial / current period (invitee bonus);
  -- pending: waiting for the invitee to log on 7 days within 30 (inviter reward);
  -- released: earned and banked.
  status text not null check (status in ('queued', 'pending', 'released')),
  redemption_id uuid references public.referral_redemptions (id) on delete set null,
  created_at timestamptz not null default now(),
  released_at timestamptz,
  unique (redemption_id, reason)
);
create index plus_credits_user on public.plus_credits (user_id);

revoke all on public.referral_codes, public.referral_redemptions, public.plus_credits from public, anon, authenticated;
alter table public.referral_codes enable row level security;
alter table public.referral_redemptions enable row level security;
alter table public.plus_credits enable row level security;
-- No client policies: everything goes through my_referral / redeem_referral / my_plus.

-- The caller's code (created on first call: prefix + 4 random digits) and their own totals.
-- months_banked = released + queued months; months_pending = inviter rewards still waiting.
create or replace function public.my_referral(p_prefix text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_member();
  v_prefix text := upper(btrim(coalesce(p_prefix, '')));
  v_try text;
  v_bytes bytea;
  v_code text;
begin
  if v_prefix !~ '^[A-Z]{2}$' then
    v_prefix := 'TL';
  end if;
  select r.code into v_code from public.referral_codes r where r.user_id = uid;
  if v_code is null then
    for attempt in 1..40 loop
      v_bytes := private.random_bytes16();
      -- After 30 collisions (a crowded prefix), fall back to two random letters.
      v_try := case when attempt <= 30 then v_prefix
                    else chr(65 + get_byte(v_bytes, 4) % 26) || chr(65 + get_byte(v_bytes, 5) % 26) end
               || '-' || lpad(((get_byte(v_bytes, 0) * 256 + get_byte(v_bytes, 1)) % 10000)::text, 4, '0');
      begin
        insert into public.referral_codes (user_id, code) values (uid, v_try) on conflict (user_id) do nothing;
        exit;
      exception when unique_violation then
        null;
      end;
    end loop;
    select r.code into v_code from public.referral_codes r where r.user_id = uid;
    if v_code is null then
      raise exception 'could not create a code, try again' using errcode = '55000';
    end if;
  end if;
  return jsonb_build_object(
    'code', v_code,
    'redeemed', (select count(*) from public.referral_redemptions r where r.code_owner = uid),
    'activated', (select count(*) from public.referral_redemptions r where r.code_owner = uid and r.activated_at is not null),
    'months_banked', (select coalesce(sum(c.months), 0) from public.plus_credits c where c.user_id = uid and c.status in ('released', 'queued')),
    'months_pending', (select coalesce(sum(c.months), 0) from public.plus_credits c where c.user_id = uid and c.status = 'pending' and c.reason = 'inviter_reward')
  );
end;
$$;
revoke all on function public.my_referral(text) from public, anon;
grant execute on function public.my_referral(text) to authenticated;

-- Redeem a friend's code once per person and once per device. On 'ok' the invitee banks 1 month
-- (queued, applies after the standard 30-day trial) and the inviter gets 1 month pending until
-- the invitee logs on 7 days within 30 (see referral_check_activation).
create or replace function public.redeem_referral(p_code text, p_device_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_member();
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  v_owner uuid;
  v_id uuid;
begin
  if p_device_hash is null or p_device_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid device hash' using errcode = '22023';
  end if;
  if v_code ~ '^[A-Z]{2}[0-9]{4}$' then
    v_code := left(v_code, 2) || '-' || right(v_code, 4);
  end if;
  select r.user_id into v_owner from public.referral_codes r
    join private.approved_members m on m.user_id = r.user_id and m.status = 'active'
   where r.code = v_code;
  if v_owner is null then
    return jsonb_build_object('status', 'invalid_code');
  end if;
  if v_owner = uid then
    return jsonb_build_object('status', 'self_referral');
  end if;
  if exists (select 1 from public.referral_redemptions r where r.invitee = uid) then
    return jsonb_build_object('status', 'already_redeemed');
  end if;
  if exists (select 1 from public.referral_redemptions r where r.device_hash = p_device_hash) then
    return jsonb_build_object('status', 'device_used');
  end if;
  insert into public.referral_redemptions (code_owner, invitee, device_hash) values (v_owner, uid, p_device_hash)
    on conflict do nothing
    returning id into v_id;
  if v_id is null then
    -- Lost a race with a concurrent redemption.
    return jsonb_build_object('status',
      case when exists (select 1 from public.referral_redemptions r where r.invitee = uid) then 'already_redeemed' else 'device_used' end);
  end if;
  insert into public.plus_credits (user_id, months, reason, status, redemption_id) values
    (uid, 1, 'invitee_bonus', 'queued', v_id),
    (v_owner, 1, 'inviter_reward', 'pending', v_id);
  return jsonb_build_object('status', 'ok');
end;
$$;
revoke all on function public.redeem_referral(text, text) from public, anon;
grant execute on function public.redeem_referral(text, text) to authenticated;

-- Called by the invitee's app. Counts distinct logged days (food or finished workout) from the
-- redemption date through 30 days later. At 7 days the redemption is activated and the inviter's
-- pending month is released, exactly once. Days outside the window never count: after 30 days
-- without 7 logged days nothing is released and the inviter's month simply stays pending (no
-- billing exists yet, so nothing is clawed back or expired here).
create or replace function public.referral_check_activation()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_member();
  v public.referral_redemptions;
  v_days integer;
begin
  select * into v from public.referral_redemptions r where r.invitee = uid for update;
  if not found then
    return jsonb_build_object('logged_days', 0, 'activated', false);
  end if;
  select count(*) into v_days
    from private.logged_dates(uid, (v.redeemed_at at time zone 'utc')::date, (v.redeemed_at at time zone 'utc')::date + 30, true);
  if v.activated_at is null and v_days >= 7 then
    update public.referral_redemptions r set activated_at = now() where r.id = v.id and r.activated_at is null;
    if found then
      update public.plus_credits c set status = 'released', released_at = now()
       where c.redemption_id = v.id and c.reason = 'inviter_reward' and c.status = 'pending';
    end if;
    v.activated_at := now();
  end if;
  return jsonb_build_object('logged_days', v_days, 'activated', v.activated_at is not null);
end;
$$;
revoke all on function public.referral_check_activation() from public, anon;
grant execute on function public.referral_check_activation() to authenticated;

create or replace function public.my_plus()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_member();
begin
  return (
    select jsonb_build_object(
      'queued', coalesce(sum(c.months) filter (where c.status = 'queued'), 0),
      'pending', coalesce(sum(c.months) filter (where c.status = 'pending'), 0),
      'released', coalesce(sum(c.months) filter (where c.status = 'released'), 0))
    from public.plus_credits c
    where c.user_id = uid);
end;
$$;
revoke all on function public.my_plus() from public, anon;
grant execute on function public.my_plus() to authenticated;

-- ---------------------------------------------------------------------------
-- E) Notifications v2
-- ---------------------------------------------------------------------------
alter table public.notification_prefs
  add column routine_enabled boolean not null default true,
  add column insight_enabled boolean not null default true,
  add column gym_mode text not null default 'learned' check (gym_mode in ('learned', 'fixed'));
comment on column public.notification_prefs.motivation_enabled is 'Retired (v1 daily motivation). Kept for compatibility; never sent.';
comment on column public.notification_prefs.motivation_time is 'Retired (v1 daily motivation). Kept for compatibility; never sent.';

alter table private.notification_log drop constraint if exists notification_log_kind_check;
alter table private.notification_log add constraint notification_log_kind_check
  check (kind in ('motivation', 'gym', 'routine', 'insight'));

create table public.notification_dismissals (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('routine', 'gym', 'insight')),
  count integer not null default 0 check (count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, kind)
);
revoke all on public.notification_dismissals from public, anon, authenticated;
grant select on public.notification_dismissals to authenticated;
alter table public.notification_dismissals enable row level security;
create policy notification_dismissals_select_own on public.notification_dismissals for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_active_member()));

-- The service worker reports a dismissal (notification closed without a tap). Returns the new
-- cumulative count; at 3 that kind stops for good (the person can still change settings).
create or replace function public.notification_dismissed(p_kind text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_member();
  v integer;
begin
  if p_kind is null or p_kind not in ('routine', 'gym', 'insight') then
    raise exception 'unknown notification kind' using errcode = '22023';
  end if;
  insert into public.notification_dismissals (user_id, kind, count) values (uid, p_kind, 1)
    on conflict (user_id, kind) do update set count = public.notification_dismissals.count + 1, updated_at = now()
    returning count into v;
  return v;
end;
$$;
revoke all on function public.notification_dismissed(text) from public, anon;
grant execute on function public.notification_dismissed(text) to authenticated;

-- Stop notifications the moment access ends (revoked, deleting): devices, preferences, dismissals.
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
    delete from public.notification_dismissals where user_id = new.user_id;
  end if;
  return new;
end;
$$;

-- Leaving the community the moment access ends: circle memberships (and their posts) go at once,
-- empty circles are removed. On account deletion also analytics, food requests, the referral code
-- and credits; redemptions keep only the device hash (people set to null) so it cannot be reused.
create or replace function private.member_growth_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_circles uuid[];
begin
  if new.status <> 'active' then
    with gone as (
      delete from public.circle_members where user_id = new.user_id returning circle_id
    )
    select array_agg(circle_id) into v_circles from gone;
    delete from public.circles c
     where c.id = any (coalesce(v_circles, '{}'))
       and not exists (select 1 from public.circle_members m where m.circle_id = c.id);
  end if;
  if new.status = 'deleting' then
    delete from public.analytics_events where user_id = new.user_id;
    delete from public.food_request_votes where user_id = new.user_id;
    delete from public.referral_codes where user_id = new.user_id;
    delete from public.plus_credits where user_id = new.user_id;
    update public.referral_redemptions set invitee = null where invitee = new.user_id;
    update public.referral_redemptions set code_owner = null where code_owner = new.user_id;
  end if;
  return new;
end;
$$;
create trigger member_growth_cleanup after update of status on private.approved_members
  for each row execute function private.member_growth_cleanup();

-- v1's single-kind due list is replaced by candidates + decisions in the function.
drop function if exists public.notify_due(timestamptz);

-- Who may get a notification right now: active members with at least one device and at least one
-- kind switched on, outside quiet hours (22:00-07:00 in their own time zone), and fewer than 2
-- notifications sent on their local day. Which kind (if any) is decided by the notify function.
create or replace function public.notify_candidates(p_now timestamptz default now())
returns table (
  user_id uuid, timezone text, local_ts timestamp, routine_enabled boolean, insight_enabled boolean,
  gym_enabled boolean, gym_mode text, gym_days smallint[], gym_time time, lead_minutes smallint,
  hide_details boolean, sent_today integer, stopped_kinds text[])
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select p.user_id as uid, p.timezone as tz, (p_now at time zone p.timezone) as lts, p.routine_enabled as r_on,
           p.insight_enabled as i_on, p.gym_enabled as g_on, p.gym_mode as g_mode, p.gym_days as g_days,
           p.gym_time as g_time, p.lead_minutes as lead, p.hide_details as hide
      from public.notification_prefs p
      join private.approved_members m on m.user_id = p.user_id and m.status = 'active'
     where exists (select 1 from public.push_subscriptions s where s.user_id = p.user_id)
       and (p.routine_enabled or p.insight_enabled or p.gym_enabled)
  ), awake as (
    select b.*,
           (select count(*)::integer from private.notification_log l
             where l.user_id = b.uid and (l.sent_at at time zone b.tz)::date = b.lts::date) as sent,
           array(select d.kind from public.notification_dismissals d
                  where d.user_id = b.uid and d.count >= 3 order by d.kind) as stopped
      from base b
     where b.lts::time >= time '07:00' and b.lts::time < time '22:00'
  )
  select a.uid, a.tz, a.lts, a.r_on, a.i_on, a.g_on, a.g_mode, a.g_days, a.g_time, a.lead, a.hide, a.sent, a.stopped
    from awake a
   where a.sent < 2;
$$;

-- Claim one notification before sending (false = do not send). Once per kind per claim date
-- (local date; the weekly insight uses that week's Monday), never more than 2 sent per local day,
-- never a kind the person dismissed 3 times, never the retired 'motivation'. Serialized per person
-- so overlapping cron ticks cannot exceed the daily cap.
create or replace function public.notify_claim(p_user uuid, p_kind text, p_date date)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
  v_tz text;
begin
  if p_kind is null or p_kind not in ('routine', 'gym', 'insight') then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('notify:' || p_user::text, 0));
  select p.timezone into v_tz from public.notification_prefs p where p.user_id = p_user;
  if v_tz is null then
    return false;
  end if;
  if exists (select 1 from public.notification_dismissals d where d.user_id = p_user and d.kind = p_kind and d.count >= 3) then
    return false;
  end if;
  if (select count(*) from private.notification_log l
       where l.user_id = p_user and (l.sent_at at time zone v_tz)::date = (now() at time zone v_tz)::date) >= 2 then
    return false;
  end if;
  insert into private.notification_log (user_id, kind, local_date) values (p_user, p_kind, p_date)
    on conflict do nothing;
  get diagnostics n = row_count;
  return n = 1;
end;
$$;

-- What the decisions may read: the person's own plan and weekly target, finished workouts (dates,
-- plan day and start time only; last 90 days), meals of the last 21 days (date, preset, name,
-- slot, time), and the dates they logged anything (last 120 days). Nothing else.
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
    'sessions', coalesce((select jsonb_agg(s.slim order by s.local_date desc) from (
                   select jsonb_build_object('status', body -> 'status', 'local_date', body -> 'local_date', 'day_id', body -> 'day_id',
                            'day_name', left(body ->> 'day_name', 60), 'started_at', body -> 'started_at', 'timezone', body -> 'timezone') as slim,
                          body ->> 'local_date' as local_date
                   from public.journal_documents
                   where user_id = p_user and collection = 'workout_sessions' and deleted_at is null
                     and body ->> 'status' = 'finished' and body ->> 'local_date' >= (p_today - 90)::text
                     and body ->> 'local_date' <= p_today::text
                   order by body ->> 'local_date' desc limit 80) s), '[]'::jsonb),
    'meals', coalesce((select jsonb_agg(m.slim order by m.local_date, m.logged_at) from (
                   select jsonb_build_object('local_date', body -> 'local_date', 'preset_id', body -> 'preset_id', 'name', left(body ->> 'name', 60),
                            'slot', body -> 'slot', 'logged_at', body -> 'logged_at', 'timezone', body -> 'timezone') as slim,
                          body ->> 'local_date' as local_date, body ->> 'logged_at' as logged_at
                   from public.journal_documents
                   where user_id = p_user and collection = 'meal_entries' and deleted_at is null and (body ->> 'deleted_at') is null
                     and body ->> 'local_date' >= (p_today - 21)::text and body ->> 'local_date' <= p_today::text
                   order by body ->> 'local_date' desc limit 300) m), '[]'::jsonb),
    'meal_dates', coalesce((select jsonb_agg(distinct d.body ->> 'local_date') from public.journal_documents d
                   where d.user_id = p_user and d.collection = 'meal_entries' and d.deleted_at is null
                     and d.body ->> 'local_date' >= (p_today - 60)::text), '[]'::jsonb),
    'logged_dates', coalesce((select jsonb_agg(x.d order by x.d) from (
                   select distinct d from private.logged_dates(p_user, p_today - 120, p_today) d) x), '[]'::jsonb),
    'program', (select d.body from public.journal_documents d
                where d.user_id = p_user and d.collection = 'programs' and d.deleted_at is null
                order by d.updated_at desc limit 1)
  );
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.notify_candidates(timestamptz)', 'public.notify_claim(uuid, text, date)', 'public.notify_context(uuid, date)',
    'public.notify_subscriptions(uuid)', 'public.notify_result(text, boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Owner views (schema private; no client access). Example queries: supabase/admin/growth.sql
-- ---------------------------------------------------------------------------
create view private.v_events_daily as
  select a.event,
         coalesce(a.local_date, (a.created_at at time zone 'utc')::date) as day,
         count(distinct a.user_id)::integer as users,
         count(*)::integer as events
    from public.analytics_events a
   group by 1, 2;

create view private.v_zero_typing_daily as
  with f as (
    select a.local_date, a.props ->> 'method' as method, (a.props ->> 'zero_typing') = 'true' as zero
      from public.analytics_events a
     where a.event = 'food_logged' and a.local_date is not null
  ), by_method as (
    select local_date, jsonb_object_agg(coalesce(method, 'unknown'), n) as methods
      from (select local_date, method, count(*) as n from f group by 1, 2) x
     group by 1
  )
  select f.local_date,
         count(*)::integer as food_logged,
         count(*) filter (where f.zero)::integer as zero_typing,
         round(count(*) filter (where f.zero)::numeric / count(*), 3) as zero_typing_share,
         m.methods as by_method
    from f join by_method m using (local_date)
   group by f.local_date, m.methods;

create view private.v_retention as
  with opens as (
    select distinct a.user_id, a.local_date from public.analytics_events a
     where a.event = 'app_open' and a.local_date is not null
  ), cohort as (
    select user_id, min(local_date) as cohort_date from opens group by 1
  )
  select c.cohort_date,
         count(*)::integer as users,
         count(*) filter (where exists (select 1 from opens o where o.user_id = c.user_id and o.local_date = c.cohort_date + 1))::integer as d1,
         count(*) filter (where exists (select 1 from opens o where o.user_id = c.user_id and o.local_date = c.cohort_date + 7))::integer as d7,
         count(*) filter (where exists (select 1 from opens o where o.user_id = c.user_id and o.local_date = c.cohort_date + 30))::integer as d30
    from cohort c
   group by c.cohort_date;

create view private.v_food_requests as
  select v.norm_text,
         count(distinct v.user_id)::integer as requesters,
         max(v.created_at) as last_requested,
         (array_agg(v.raw_text order by v.created_at desc))[1] as latest_raw_text
    from public.food_request_votes v
   group by v.norm_text;

create view private.v_funnel_referral as
  with days as (
    select coalesce(a.local_date, (a.created_at at time zone 'utc')::date) as day, 'invite_sent' as step
      from public.analytics_events a where a.event = 'invite_sent'
    union all
    select (r.redeemed_at at time zone 'utc')::date, 'invite_code_redeemed' from public.referral_redemptions r
    union all
    select (r.activated_at at time zone 'utc')::date, 'referral_activated' from public.referral_redemptions r where r.activated_at is not null
  )
  select day,
         count(*) filter (where step = 'invite_sent')::integer as invite_sent,
         count(*) filter (where step = 'invite_code_redeemed')::integer as invite_code_redeemed,
         count(*) filter (where step = 'referral_activated')::integer as referral_activated
    from days
   group by day;

revoke all on private.v_events_daily, private.v_zero_typing_daily, private.v_retention, private.v_food_requests,
  private.v_funnel_referral from public, anon, authenticated;

commit;
