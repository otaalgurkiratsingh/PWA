-- AapnaFit Private — initial schema (Phase 0).
-- Personal tables live in `public` (reachable through the Supabase Data API) and are protected by:
--   1. explicit, minimal table grants to `authenticated` only (nothing for `anon`);
--   2. RLS requiring auth.uid() ownership AND active approved membership;
--   3. composite (id, user_id) foreign keys so a child can never point at another owner's parent;
--   4. triggers that make id/owner/version/timestamps server-controlled and revisions immutable.
-- Operational tables live in `private`, which the client roles cannot read or write.
-- NOTE: Not applied to any real Supabase project yet. Review before `supabase db push`.

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Private operational schema
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
-- Clients may resolve (not read) private objects so RLS policies can call the membership check.
grant usage on schema private to authenticated;

create table private.approved_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  status text not null check (status in ('active', 'revoked', 'deleting')),
  is_owner_admin boolean not null default false,
  approved_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.ai_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  operation_id uuid not null,
  operation text not null check (operation in ('photo_suggest', 'weekly_review', 'coach_question')),
  status text not null check (status in ('reserved', 'in_progress', 'succeeded', 'failed', 'expired')),
  reserved_usd numeric(10, 6) not null check (reserved_usd >= 0),
  actual_usd numeric(10, 6) check (actual_usd >= 0),
  model_id text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (user_id, operation_id)
);
create index ai_requests_user_day on private.ai_requests (user_id, operation, created_at);

create table private.ai_budget (
  month date primary key,
  limit_usd numeric(10, 2) not null default 10.00 check (limit_usd >= 0),
  max_calls integer not null default 600 check (max_calls >= 0),
  disabled boolean not null default false
);

create table private.sync_receipts (
  user_id uuid not null references auth.users (id) on delete cascade,
  op_id uuid not null,
  table_name text not null,
  row_id uuid not null,
  result_version bigint not null,
  received_at timestamptz not null default now(),
  primary key (user_id, op_id)
);

create table private.privacy_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  kind text not null check (kind in ('export', 'delete_account', 'withdraw_ai')),
  status text not null check (status in ('queued', 'running', 'done', 'failed')),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

-- Minimal ledger so deletions can be re-applied after a backup restore. No health data.
create table private.deletion_ledger (
  user_id uuid primary key,
  deleted_at timestamptz not null default now(),
  backup_expiry_note text
);

-- Membership check used by every policy. SECURITY DEFINER with an empty search_path.
create or replace function private.is_active_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.approved_members m
    where m.user_id = (select auth.uid()) and m.status = 'active'
  );
$$;
revoke all on function private.is_active_member() from public;
grant execute on function private.is_active_member() to authenticated;

-- Server-controlled row metadata: version, timestamps, immutable owner.
create or replace function private.row_meta()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1;
    new.created_at := now();
    new.updated_at := now();
  else
    if new.user_id is distinct from old.user_id then
      raise exception 'owner cannot be changed' using errcode = '42501';
    end if;
    if new.id is distinct from old.id then
      raise exception 'id cannot be changed' using errcode = '42501';
    end if;
    new.version := old.version + 1;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

-- Revisions are immutable once sealed; the only permitted update is sealing.
create or replace function private.seal_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.sealed_at is not null then
    raise exception '% is sealed and immutable; create a new revision', tg_table_name using errcode = '42501';
  end if;
  if new.sealed_at is null
     or (to_jsonb(new) - 'sealed_at' - 'version' - 'updated_at') is distinct from (to_jsonb(old) - 'sealed_at' - 'version' - 'updated_at') then
    raise exception 'only sealing is allowed on %', tg_table_name using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Shared read-only library (no personal data)
-- ---------------------------------------------------------------------------
create table public.exercise_library (
  key text primary key,
  name text not null,
  default_variant text not null,
  muscle_group text not null
);

-- ---------------------------------------------------------------------------
-- Personal tables
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  nickname text not null check (char_length(nickname) between 1 and 40),
  units text not null check (units in ('kg', 'lb')),
  timezone text not null check (char_length(timezone) between 1 and 64),
  adult_confirmed boolean not null,
  goal text not null check (goal in ('consistency', 'maintenance', 'fat_loss', 'strength', 'muscle_gain')),
  height_cm numeric check (height_cm > 0 and height_cm < 300),
  target_energy_kcal numeric check (target_energy_kcal > 0),
  target_protein_g numeric check (target_protein_g > 0),
  target_source text,
  unique (user_id),
  unique (id, user_id)
);

create table public.foods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  name text not null check (char_length(name) between 1 and 80),
  unique (id, user_id)
);

create table public.food_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  food_id uuid not null,
  revision integer not null check (revision > 0),
  preparation_state text not null check (preparation_state in ('raw', 'dry', 'cooked', 'as_sold')),
  source_kind text not null check (source_kind in ('usda_fdc', 'label', 'user_recipe', 'generic_assumption', 'synthetic_demo', 'unknown')),
  source_ref text,
  source_version text,
  license text,
  -- Per 100 g. NULL = unknown (never coerced to 0).
  energy_kcal numeric check (energy_kcal >= 0),
  protein_g numeric check (protein_g >= 0),
  carbs_g numeric check (carbs_g >= 0),
  fat_g numeric check (fat_g >= 0),
  fiber_g numeric check (fiber_g >= 0),
  assumptions text[] not null default '{}',
  unique (food_id, revision),
  unique (id, user_id),
  foreign key (food_id, user_id) references public.foods (id, user_id) on delete cascade
);

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  name text not null check (char_length(name) between 1 and 80),
  unique (id, user_id)
);

create table public.recipe_revisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  recipe_id uuid not null,
  revision integer not null check (revision > 0),
  batch_cooked_edible_yield_g numeric not null check (batch_cooked_edible_yield_g > 0),
  assumptions text[] not null default '{}',
  sealed_at timestamptz,
  unique (recipe_id, revision),
  unique (id, user_id),
  foreign key (recipe_id, user_id) references public.recipes (id, user_id) on delete cascade
);

create table public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  recipe_revision_id uuid not null,
  food_version_id uuid not null,
  edible_grams numeric not null check (edible_grams > 0),
  state text not null check (state in ('raw', 'dry', 'cooked', 'as_sold')),
  unique (id, user_id),
  foreign key (recipe_revision_id, user_id) references public.recipe_revisions (id, user_id) on delete cascade,
  foreign key (food_version_id, user_id) references public.food_versions (id, user_id)
);

create table public.portion_calibrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  label text not null check (char_length(label) between 1 and 40),
  cooked_grams numeric not null check (cooked_grams > 0),
  recipe_id uuid,
  food_id uuid,
  check (num_nonnulls(recipe_id, food_id) = 1),
  unique (id, user_id),
  foreign key (recipe_id, user_id) references public.recipes (id, user_id) on delete cascade,
  foreign key (food_id, user_id) references public.foods (id, user_id) on delete cascade
);

create table public.meal_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  name text not null check (char_length(name) between 1 and 60),
  icon text not null,
  quantity_step numeric not null check (quantity_step > 0),
  unique (id, user_id)
);

create table public.preset_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  preset_id uuid not null,
  position smallint not null check (position >= 0),
  food_version_id uuid,
  recipe_revision_id uuid,
  unit_label text not null check (char_length(unit_label) between 1 and 30),
  grams_per_unit numeric not null check (grams_per_unit > 0),
  default_quantity numeric not null check (default_quantity > 0),
  check (num_nonnulls(food_version_id, recipe_revision_id) = 1),
  unique (id, user_id),
  foreign key (preset_id, user_id) references public.meal_presets (id, user_id) on delete cascade,
  foreign key (food_version_id, user_id) references public.food_versions (id, user_id),
  foreign key (recipe_revision_id, user_id) references public.recipe_revisions (id, user_id)
);

create table public.meal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  preset_id uuid,
  name text not null check (char_length(name) between 1 and 80),
  slot text not null check (slot in ('breakfast', 'lunch', 'dinner', 'snack')),
  local_date date not null,
  timezone text not null,
  logged_at timestamptz not null,
  quantity numeric not null check (quantity > 0),
  unique (id, user_id),
  foreign key (preset_id, user_id) references public.meal_presets (id, user_id)
);

-- Nutrition snapshot at logging time; later recipe revisions never rewrite it.
create table public.meal_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  meal_entry_id uuid not null,
  label text not null,
  quantity numeric not null check (quantity > 0),
  unit_label text not null,
  grams numeric not null check (grams > 0),
  energy_kcal numeric check (energy_kcal >= 0),
  protein_g numeric check (protein_g >= 0),
  carbs_g numeric check (carbs_g >= 0),
  fat_g numeric check (fat_g >= 0),
  fiber_g numeric check (fiber_g >= 0),
  complete jsonb not null,
  source_kinds text[] not null,
  food_version_id uuid,
  recipe_revision_id uuid,
  estimated boolean not null,
  unique (id, user_id),
  foreign key (meal_entry_id, user_id) references public.meal_entries (id, user_id) on delete cascade,
  foreign key (food_version_id, user_id) references public.food_versions (id, user_id),
  foreign key (recipe_revision_id, user_id) references public.recipe_revisions (id, user_id)
);

create table public.workout_programs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  name text not null check (char_length(name) between 1 and 60),
  unique (id, user_id)
);

create table public.program_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  program_id uuid not null,
  program_version integer not null check (program_version > 0),
  sealed_at timestamptz,
  unique (program_id, program_version),
  unique (id, user_id),
  foreign key (program_id, user_id) references public.workout_programs (id, user_id) on delete cascade
);

create table public.program_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  program_version_id uuid not null,
  position smallint not null check (position >= 0),
  name text not null,
  unique (id, user_id),
  foreign key (program_version_id, user_id) references public.program_versions (id, user_id) on delete cascade
);

create table public.planned_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  program_day_id uuid not null,
  position smallint not null check (position >= 0),
  exercise_key text not null,
  name text not null,
  variant text not null,
  load_convention text not null check (load_convention in ('total', 'per_dumbbell', 'per_side', 'bodyweight')),
  unilateral boolean not null,
  unique (id, user_id),
  foreign key (program_day_id, user_id) references public.program_days (id, user_id) on delete cascade
);

create table public.prescribed_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  planned_exercise_id uuid not null,
  position smallint not null check (position >= 0),
  set_type text not null check (set_type in ('warmup', 'working')),
  rep_min integer not null check (rep_min > 0),
  rep_max integer not null check (rep_max >= rep_min),
  target_load numeric check (target_load > 0),
  target_unit text not null check (target_unit in ('kg', 'lb')),
  rest_seconds integer not null check (rest_seconds between 0 and 900),
  rir_target smallint check (rir_target between 0 and 5),
  unique (id, user_id),
  foreign key (planned_exercise_id, user_id) references public.planned_exercises (id, user_id) on delete cascade
);

create table public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  program_version_id uuid not null,
  program_day_id uuid not null,
  program_snapshot jsonb not null,
  local_date date not null,
  timezone text not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  status text not null check (status in ('active', 'finished')),
  check ((status = 'finished') = (finished_at is not null)),
  unique (id, user_id),
  foreign key (program_version_id, user_id) references public.program_versions (id, user_id),
  foreign key (program_day_id, user_id) references public.program_days (id, user_id)
);

create table public.session_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  session_id uuid not null,
  position smallint not null check (position >= 0),
  exercise_key text not null,
  variant text not null,
  load_convention text not null check (load_convention in ('total', 'per_dumbbell', 'per_side', 'bodyweight')),
  unilateral boolean not null,
  unique (id, user_id),
  foreign key (session_id, user_id) references public.workout_sessions (id, user_id) on delete cascade
);

create table public.completed_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  session_exercise_id uuid not null,
  position smallint not null check (position >= 0),
  set_type text not null check (set_type in ('warmup', 'working')),
  planned jsonb not null,
  status text not null check (status in ('pending', 'completed', 'skipped')),
  reps integer check (reps between 0 and 200),
  load numeric check (load >= 0 and load <= 1000),
  unit text check (unit in ('kg', 'lb')),
  rir smallint check (rir between 0 and 10),
  discomfort boolean not null default false,
  completed_at timestamptz,
  -- A completed set has actual values; a skipped/pending set has none (skip != zero reps).
  check ((status = 'completed') = (reps is not null and load is not null and unit is not null and completed_at is not null)),
  unique (session_exercise_id, position),
  unique (id, user_id),
  foreign key (session_exercise_id, user_id) references public.session_exercises (id, user_id) on delete cascade
);

create table public.weight_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  local_date date not null,
  timezone text not null,
  measured_at timestamptz not null,
  value numeric not null check (value > 0 and value < 700),
  unit text not null check (unit in ('kg', 'lb')),
  unique (id, user_id)
);

create table public.daily_health_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  metric text not null check (metric in ('steps', 'sleep_minutes')),
  local_date date not null,
  timezone text not null,
  value integer not null check (value >= 0),
  source text not null check (source in ('manual', 'import_file', 'screenshot_confirmed', 'health_connect')),
  import_method text,
  refreshed_at timestamptz not null,
  unique (id, user_id)
);
-- One live value per metric/day; a source edit replaces it rather than double-counting.
create unique index daily_health_one_per_day on public.daily_health_summaries (user_id, metric, local_date) where deleted_at is null;

create table public.daily_log_status (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  local_date date not null,
  intake_complete boolean not null,
  unique (user_id, local_date),
  unique (id, user_id)
);

-- Written only by the backend (service role) after validation; clients read.
create table public.coach_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  period_from date not null,
  period_to date not null,
  review jsonb not null,
  model_id text not null,
  prompt_version text not null,
  check (period_to >= period_from),
  unique (id, user_id)
);

create table public.change_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  coach_review_id uuid,
  kind text not null check (kind in ('target', 'program')),
  before_value jsonb not null,
  after_value jsonb not null,
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'rejected')),
  decided_at timestamptz,
  unique (id, user_id),
  foreign key (coach_review_id, user_id) references public.coach_reviews (id, user_id) on delete cascade
);

create table public.user_confirmed_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  fact text not null check (char_length(fact) between 1 and 500),
  confirmed_at timestamptz not null default now(),
  unique (id, user_id)
);

-- Append-only consent ledger.
create table public.consent_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  consent_type text not null check (consent_type in ('cloud_backup', 'ai_processing', 'health_import')),
  granted boolean not null,
  notice_version text not null,
  unique (id, user_id)
);

-- Children of a sealed revision cannot be added.
create or replace function private.parent_revision_unsealed()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  sealed timestamptz;
begin
  if tg_table_name = 'recipe_ingredients' then
    select r.sealed_at into sealed from public.recipe_revisions r where r.id = new.recipe_revision_id;
  elsif tg_table_name = 'program_days' then
    select v.sealed_at into sealed from public.program_versions v where v.id = new.program_version_id;
  elsif tg_table_name = 'planned_exercises' then
    select v.sealed_at into sealed
      from public.program_days d join public.program_versions v on v.id = d.program_version_id
      where d.id = new.program_day_id;
  elsif tg_table_name = 'prescribed_sets' then
    select v.sealed_at into sealed
      from public.planned_exercises e
      join public.program_days d on d.id = e.program_day_id
      join public.program_versions v on v.id = d.program_version_id
      where e.id = new.planned_exercise_id;
  end if;
  if sealed is not null then
    raise exception 'parent revision is sealed; create a new revision' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers, indexes, grants, RLS
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  personal text[] := array[
    'profiles', 'foods', 'food_versions', 'recipes', 'recipe_revisions', 'recipe_ingredients',
    'portion_calibrations', 'meal_presets', 'preset_items', 'meal_entries', 'meal_items',
    'workout_programs', 'program_versions', 'program_days', 'planned_exercises', 'prescribed_sets',
    'workout_sessions', 'session_exercises', 'completed_sets', 'weight_entries',
    'daily_health_summaries', 'daily_log_status', 'coach_reviews', 'change_proposals',
    'user_confirmed_memory', 'consent_events'];
  -- Owners may insert/select/update/delete these (deletes are normally soft via deleted_at).
  editable text[] := array[
    'profiles', 'foods', 'recipes', 'portion_calibrations', 'meal_presets', 'preset_items',
    'meal_entries', 'meal_items', 'workout_programs', 'workout_sessions', 'session_exercises',
    'completed_sets', 'weight_entries', 'daily_health_summaries', 'daily_log_status',
    'user_confirmed_memory'];
  -- Insert + select only (immutable history / append-only ledgers).
  append_only text[] := array[
    'food_versions', 'recipe_ingredients', 'program_days', 'planned_exercises', 'prescribed_sets', 'consent_events'];
  -- Insert + select + seal-only update.
  sealable text[] := array['recipe_revisions', 'program_versions'];
  -- Select only for clients; written by validated backend operations.
  read_only text[] := array['coach_reviews', 'change_proposals'];
  member_owner text := '(user_id = (select auth.uid()) and (select private.is_active_member()))';
begin
  foreach t in array personal loop
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function private.row_meta()', t || '_meta', t);
    execute format('create index %I on public.%I (user_id, version)', t || '_owner_version', t);
    execute format('create policy %I on public.%I for select to authenticated using %s', t || '_select_own', t, member_owner);
  end loop;

  foreach t in array editable || append_only || sealable loop
    execute format('grant select, insert on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for insert to authenticated with check %s', t || '_insert_own', t, member_owner);
  end loop;

  foreach t in array editable || sealable loop
    execute format('grant update on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for update to authenticated using %s with check %s', t || '_update_own', t, member_owner, member_owner);
  end loop;

  foreach t in array editable loop
    execute format('grant delete on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for delete to authenticated using %s', t || '_delete_own', t, member_owner);
  end loop;

  foreach t in array sealable loop
    execute format('create trigger %I before update on public.%I for each row execute function private.seal_only()', t || '_seal_only', t);
  end loop;

  foreach t in array read_only loop
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end;
$$;

-- Seal trigger must run before row_meta bumps the version (alphabetical trigger order: *_meta < *_seal_only),
-- so seal_only ignores version/updated_at in its comparison.

create trigger recipe_ingredients_unsealed before insert on public.recipe_ingredients for each row execute function private.parent_revision_unsealed();
create trigger program_days_unsealed before insert on public.program_days for each row execute function private.parent_revision_unsealed();
create trigger planned_exercises_unsealed before insert on public.planned_exercises for each row execute function private.parent_revision_unsealed();
create trigger prescribed_sets_unsealed before insert on public.prescribed_sets for each row execute function private.parent_revision_unsealed();

-- Owner/date indexes for bounded main views.
create index meal_entries_owner_date on public.meal_entries (user_id, local_date);
create index workout_sessions_owner_date on public.workout_sessions (user_id, local_date);
create index weight_entries_owner_date on public.weight_entries (user_id, local_date);
create index daily_health_owner_date on public.daily_health_summaries (user_id, local_date);
-- Child lookup indexes (owner/session etc.).
create index meal_items_entry on public.meal_items (meal_entry_id, user_id);
create index session_exercises_session on public.session_exercises (session_id, user_id);
create index completed_sets_exercise on public.completed_sets (session_exercise_id, user_id);
create index recipe_ingredients_revision on public.recipe_ingredients (recipe_revision_id, user_id);
create index preset_items_preset on public.preset_items (preset_id, user_id);

-- Shared library: readable by active members only; no client writes.
revoke all on public.exercise_library from public, anon, authenticated;
grant select on public.exercise_library to authenticated;
alter table public.exercise_library enable row level security;
create policy exercise_library_members on public.exercise_library for select to authenticated
  using ((select private.is_active_member()));

-- ---------------------------------------------------------------------------
-- RPC: record the user's decision on a proposal (plan/target changes need approval)
-- ---------------------------------------------------------------------------
create or replace function public.decide_change_proposal(p_proposal_id uuid, p_decision text)
returns public.change_proposals
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  result public.change_proposals;
begin
  if uid is null or not private.is_active_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_decision not in ('accepted', 'rejected') then
    raise exception 'invalid decision' using errcode = '22023';
  end if;
  update public.change_proposals p
     set status = p_decision, decided_at = now()
   where p.id = p_proposal_id and p.user_id = uid and p.status = 'proposed' and p.deleted_at is null
  returning p.* into result;
  if result.id is null then
    raise exception 'proposal not found or already decided' using errcode = 'P0002';
  end if;
  return result;
end;
$$;
revoke all on function public.decide_change_proposal(uuid, text) from public, anon;
grant execute on function public.decide_change_proposal(uuid, text) to authenticated;

-- Future tables are not exposed by default.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated, public;
alter default privileges in schema private revoke all on tables from anon, authenticated, public;

commit;
