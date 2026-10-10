-- Owner administration (run in the Supabase SQL editor as the project owner; never from the app).
-- Replace the email addresses before running. Membership lives in the private schema, which
-- the app cannot read or change.

-- 1) Approve a person you already created under Authentication → Users:
insert into private.approved_members (user_id, status)
select id, 'active' from auth.users where email = 'person@example.com'
on conflict (user_id) do update set status = 'active', updated_at = now();

-- 2) Revoke access (their existing sessions stop working immediately through RLS):
-- update private.approved_members set status = 'revoked', updated_at = now()
-- where user_id = (select id from auth.users where email = 'person@example.com');

-- 3) Who has access:
-- select u.email, m.status, m.approved_at from private.approved_members m join auth.users u on u.id = m.user_id order by u.email;

-- 4) AI limits and monthly application budget (US$). Billing alerts are notifications, not caps;
--    these are the app's own hard limits.
-- update private.ai_limits set photo_per_day = 3, question_per_day = 5, review_per_week = 1;
-- insert into private.ai_budget (month, limit_usd, max_calls) values (date_trunc('month', now())::date, 10, 600)
--   on conflict (month) do update set limit_usd = excluded.limit_usd, max_calls = excluded.max_calls;
-- Pause AI for the month: update private.ai_budget set disabled = true where month = date_trunc('month', now())::date;

-- 5) This month's AI usage (no health data here):
-- select operation, status, count(*), sum(coalesce(actual_usd, reserved_usd)) as usd
-- from private.ai_requests where created_at >= date_trunc('month', now()) group by 1, 2 order by 1, 2;

-- 6) After someone deletes their account in the app, finish the job by deleting the auth user
--    (Authentication → Users → delete). Their journal rows are already gone; the deletion ledger keeps
--    only the user id and date so the deletion can be re-applied after any restore.
-- select * from private.privacy_jobs where status = 'queued';
