-- TrainLuma reminders: owner setup (run once in the Supabase SQL Editor, AFTER migration
-- 20261012000004_notifications.sql and after deploying the `notify` function).
--
-- Before running:
--   1. On your computer: npx web-push generate-vapid-keys
--      - Public key  → Netlify env VITE_VAPID_PUBLIC_KEY and Supabase secret VAPID_PUBLIC_KEY
--      - Private key → Supabase secret VAPID_PRIVATE_KEY only (never Netlify, never git)
--      - Supabase secret VAPID_SUBJECT = mailto:your-email
--   2. Make a long random cron secret (e.g. openssl rand -hex 32) and save it as the Supabase
--      secret NOTIFY_CRON_SECRET. Type it below in place of PASTE_THE_SAME_SECRET — in the
--      SQL Editor only. Do not save this file with the real value.
--   3. supabase functions deploy notify
--
-- Replace YOUR_PROJECT_REF with your project ref (the part before .supabase.co).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Keep the secret in Supabase Vault (encrypted), not in the job text.
select vault.create_secret('PASTE_THE_SAME_SECRET', 'notify_cron_secret');

select cron.schedule(
  'trainluma-notify',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/notify',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'notify_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);

-- Check it: recent runs (status should be "succeeded"), and the function's replies.
-- select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'trainluma-notify') order by start_time desc limit 5;
-- select status_code, content from net._http_response order by created desc limit 5;   -- expect 200 {"due":…,"sent":…}

-- Stop reminders for everyone:
-- select cron.unschedule('trainluma-notify');
