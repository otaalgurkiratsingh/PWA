-- TrainLuma Phase 3 (retention + referral): owner SQL. Run pieces in the Supabase SQL Editor AFTER
-- migration 20261013000005_growth.sql. The views live in schema `private`: only the owner (SQL
-- Editor / postgres role) can read them; the app and the service role cannot.
--
-- Privacy: these are first-party counts about how the app is used. Props never hold food names,
-- weights or body data (the app sends method names and booleans only). Don't export raw rows.

-- ---------------------------------------------------------------------------
-- Housekeeping jobs (once)
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron;

-- Circle posts are visible for 30 days; remove them afterwards.
select cron.schedule('trainluma-circle-posts-expire', '17 3 * * *', $$ select private.circle_posts_expire(); $$);
-- Raw analytics events are kept for 400 days.
select cron.schedule('trainluma-analytics-expire', '23 3 * * *', $$ select private.analytics_expire(); $$);

-- ---------------------------------------------------------------------------
-- Daily events
-- ---------------------------------------------------------------------------
-- Last 14 days, most used first.
select day, event, users, events
  from private.v_events_daily
 where day >= current_date - 14
 order by day desc, events desc;

-- ---------------------------------------------------------------------------
-- Zero-typing logging (event 'food_logged', props.zero_typing = true; by props.method)
-- ---------------------------------------------------------------------------
select local_date, food_logged, zero_typing, zero_typing_share, by_method
  from private.v_zero_typing_daily
 where local_date >= current_date - 28
 order by local_date desc;

-- Whole period share.
select sum(zero_typing)::numeric / nullif(sum(food_logged), 0) as zero_typing_share
  from private.v_zero_typing_daily
 where local_date >= current_date - 28;

-- ---------------------------------------------------------------------------
-- Retention (cohort = first 'app_open' local date; returning = 'app_open' exactly D1/D7/D30 later)
-- ---------------------------------------------------------------------------
select cohort_date, users,
       d1, round(100.0 * d1 / users, 1) as d1_pct,
       d7, round(100.0 * d7 / users, 1) as d7_pct,
       d30, round(100.0 * d30 / users, 1) as d30_pct
  from private.v_retention
 order by cohort_date desc
 limit 60;

-- Weekly cohorts (smoother with few people). Recent cohorts can't have D7/D30 yet.
select date_trunc('week', cohort_date)::date as week, sum(users) as users,
       round(100.0 * sum(d1) / sum(users), 1) as d1_pct,
       round(100.0 * sum(d7) / sum(users), 1) as d7_pct,
       round(100.0 * sum(d30) / sum(users), 1) as d30_pct
  from private.v_retention
 group by 1
 order by 1 desc;

-- ---------------------------------------------------------------------------
-- Food requests ("Ask for this food"): what to add to the catalogue next
-- ---------------------------------------------------------------------------
select norm_text, requesters, last_requested, latest_raw_text
  from private.v_food_requests
 order by requesters desc, last_requested desc
 limit 50;

-- ---------------------------------------------------------------------------
-- Referral funnel ("Give a month, get a month")
-- ---------------------------------------------------------------------------
-- invite_sent comes from the app's analytics event; redeemed/activated from the credit ledger.
select day, invite_sent, invite_code_redeemed, referral_activated
  from private.v_funnel_referral
 where day >= current_date - 60
 order by day desc;

select sum(invite_sent) as invites_sent, sum(invite_code_redeemed) as redeemed, sum(referral_activated) as activated,
       round(100.0 * sum(referral_activated) / nullif(sum(invite_code_redeemed), 0), 1) as activation_pct
  from private.v_funnel_referral;

-- Credit ledger totals (months). There is no billing system yet: 'queued' = banked, applies after
-- the standard 30-day trial; 'pending' = inviter reward waiting for the invitee's 7 logged days in
-- their first 30; 'released' = earned. A pending reward whose 30-day window passed without 7 logged
-- days simply stays pending (nothing is released, nothing is clawed back).
select reason, status, count(*) as rows, sum(months) as months
  from public.plus_credits
 group by 1, 2
 order by 1, 2;

-- Pending rewards whose window has closed without activation (for information only).
select r.id, r.redeemed_at, r.redeemed_at + interval '30 days' as window_closed
  from public.referral_redemptions r
 where r.activated_at is null and r.redeemed_at < now() - interval '31 days';

-- ---------------------------------------------------------------------------
-- Circles (sizes only; never read members' names or posts for analysis)
-- ---------------------------------------------------------------------------
select size, count(*) as circles
  from (select c.id, count(m.user_id) as size from public.circles c left join public.circle_members m on m.circle_id = c.id group by c.id) x
 group by size
 order by size;

-- ---------------------------------------------------------------------------
-- Notifications v2 health
-- ---------------------------------------------------------------------------
-- Sent per kind per day (log keeps one row per person/kind/claim date).
select (sent_at at time zone 'utc')::date as day, kind, count(*) as sent
  from private.notification_log
 where sent_at >= now() - interval '14 days'
 group by 1, 2
 order by 1 desc, 2;

-- How many people stopped each kind by dismissing it 3 times.
select kind, count(*) filter (where count >= 3) as stopped, count(*) as ever_dismissed
  from public.notification_dismissals
 group by kind;
