-- LOCAL TEST STAND-IN ONLY. Never apply to a real Supabase project (it already provides these).
-- Mirrors the parts of Supabase the migration relies on: client roles, auth.users, auth.uid().
-- In Supabase, PostgREST verifies the JWT (signature, issuer, audience, expiry) and then sets
-- `request.jwt.claims` and the role; these tests simulate the result of that verification.
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
grant usage on schema public to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (
  id uuid primary key,
  email text unique
);

create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(
    coalesce(current_setting('request.jwt.claim.sub', true), (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')),
    ''
  )::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Supabase's default: client roles get broad table privileges on public; the migration must revoke them.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
