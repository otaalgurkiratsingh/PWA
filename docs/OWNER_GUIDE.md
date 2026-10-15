# Owner guide (plain language)

TrainLuma (formerly Rozana) is a private meal and workout journal with an AI Coach, for you, your wife and a few invited friends. This guide covers how to try it, the one-time setup that only you can do, and how data is kept. Dashboard menu names change from time to time. If a label below doesn't match what you see, look for the closest equivalent; the official links are at the end.

> Never paste a key, password or recovery code into a chat, an issue, a screenshot or a file in this project. Enter secrets only in the official dashboards.

---

## 1. Try it right now (no accounts needed)

Your Netlify site (or `npm run dev` on your computer) opens the **welcome screen**. Tap **Explore the demo (made-up data)**. Everything in the demo is invented and stays on that device.

Try:
- **Food:** **Add food → Choose food**. Search "chapati", "daal" or "sabji", or browse the category chips (Roti & breads, Dal & beans, Chai & drinks…, All foods). Picking a list food adds it to your meals with nutrition "not set" until you add a label or your recipe.
- **Workout:** **Recent workouts** shows the date in a mint tile (month over day).
- **Coach** needs a signed-in account; the demo explains this.

---

## 2. One-time setup for sign-in, backup, AI Coach and photos

You do this once. Until it's done, the sign-in screen says "Sign-in is still being set up" and offers the demo.

### 2a. Supabase project (free tier)
1. Create a **new, separate** Supabase project (not your agency one). Turn on MFA for your Supabase account. Keep the database password in a password manager.
2. Apply the database migrations **in order**. Either:
   - with the Supabase CLI: `supabase link --project-ref <your-ref>`, then `supabase db push`; or
   - in **SQL Editor**, paste and run each file in `supabase/migrations/`, oldest first:
     `20261009000001_init.sql`, `20261009000002_sync_auth_ai.sql`, `20261010000003_coach_v2.sql`, `20261012000004_notifications.sql`, `20261013000005_growth.sql`, `20261013000006_growth2.sql` (see 2h).
   The third one creates the private **progress-photos** storage bucket, the chat tables, plan drafts and the daily chat-expiry job. The fourth, `20261012000004_notifications.sql`, adds reminder settings and devices (see 2e). The fifth, `20261013000005_growth.sql`, adds usage stats, food requests, friend circles, the referral credit ledger and notifications v2 (see 2g).
3. Check **Storage**: a bucket named `progress-photos` exists and is **Private** (not public).
4. Check **Database → Extensions**: `pg_cron` is enabled. If the migration couldn't schedule the job, enable `pg_cron` and run the migration's last block again (or ask me). Expired chats are hidden either way.
5. **Authentication → Sign In / Providers**: Email **on**; **Allow new users to sign up: off**; Email OTP expiry about 10 minutes; OTP length 6.
6. **Authentication → Emails → Templates → Magic Link**: make the email show the **code**, for example:
   ```
   <h2>Your TrainLuma sign-in code</h2>
   <p>Enter this code in the app: <strong>{{ .Token }}</strong></p>
   <p>It expires soon. If you didn’t ask for it, ignore this email.</p>
   ```
7. **Authentication → Emails → SMTP settings**: connect a real sender (Resend, Postmark or Amazon SES) and verify your domain.
8. **Authentication → Rate limits**: keep email limits low.
9. **Authentication → URL configuration**: **Site URL** = your Netlify address; add only that address under **Redirect URLs**.

### 2b. Invite people (start with yourself)
1. **Authentication → Users → Add user**: enter the email and confirm the user.
2. **SQL Editor**: run the first statement in `supabase/admin/members.sql` with that email.
   Without this, the person gets a code but sees "This account isn’t active".
3. Start with yourself. Add your wife after the two-person check in 2f. Add friends only with their informed agreement (tell them what you, as project owner, can technically see; see section 4).

### 2c. Connect the website (Netlify)
1. Supabase **Project Settings → API Keys**: copy the **Project URL** and the **publishable** key (never the secret/service-role key).
2. Netlify **Site configuration → Environment variables**: add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
3. Trigger a new deploy.

**Exercise form photos:** the first `npm run build` on a machine downloads about 1,650 public-domain exercise photos (about 94 MB, from free-exercise-db at a fixed version) into a `.cache/` folder. Later builds reuse them, so nothing is downloaded again. If the download is blocked or you're offline, the build still finishes, and exercises show their steps without photos. To skip the photos on purpose (for example, a quick test build), set `SKIP_EXERCISE_IMAGES=1`. A fresh build server (such as Netlify) downloads them again on each deploy, which takes about 15 seconds.

### 2d. AI Coach (Gemini, paid API project)
1. In Google AI Studio / Google Cloud, use a **separate project with paid billing on** (a Gemini consumer subscription is different). Turn on MFA. Set a budget alert (alerts only notify; the app enforces its own limits).
2. Create an API key in Google AI Studio and restrict it to the Gemini (Generative Language) API.
3. Check that `gemini-3.8-flash` is available to your project. Note the current **input and output price per 1M tokens**.
4. From your computer: `supabase functions deploy ai` (redeploy after every update of this repository).
5. **Supabase → Edge Functions → Secrets**, type in:
   - `GEMINI_API_KEY`: your key (only here)
   - `GEMINI_MODEL`: `gemini-3.8-flash`
   - `AI_PRICE_INPUT_PER_MTOK`, `AI_PRICE_OUTPUT_PER_MTOK`: the prices from step 3 (without them the coach stays off on purpose)
   - `ALLOWED_ORIGINS`: your Netlify address, e.g. `https://your-site.netlify.app`
   - Leave `GEMINI_API_STYLE` unset. Never set `GEMINI_TEST_BASE_URL` (test harness only; it accepts only a local address anyway).
6. Limits (change with `supabase/admin/members.sql`): US$10 per month for everyone together; per person 20 chat messages a day (their local day), 3 food photo suggestions a day, 1 weekly review a week, the first plan draft plus 2 regenerations a week, and one AI request at a time.
7. Each person turns on **AI help** for themselves. The coach reads their **backed-up** journal, so backup must be on too. Photos need their own two switches (see 3).

### 2e. Phone reminders (routine nudge, gym reminder, milestone/insight ready)
Optional. Until it's done, the Notifications screen saves people's choices and says setup is pending.
1. On your computer: `npx web-push generate-vapid-keys`. You get a **public** and a **private** key.
2. Netlify environment variables: add `VITE_VAPID_PUBLIC_KEY` = the public key, then redeploy. (The public key is safe in the app.)
3. Supabase → Edge Functions → Secrets: `VAPID_PUBLIC_KEY` (same public key), `VAPID_PRIVATE_KEY` (the private key, **only here**), `VAPID_SUBJECT` = `mailto:your-email`, and `NOTIFY_CRON_SECRET` = a long random string (e.g. `openssl rand -hex 32`).
4. Apply migration `20261012000004_notifications.sql` (after the first three), then `supabase functions deploy notify`.
5. SQL Editor: open `supabase/admin/notifications.sql`, put your project ref and the same cron secret in **in the editor only**, and run it. It schedules `trainluma-notify` every 5 minutes. The file shows how to check runs and how to stop it.
6. On each phone: Settings → Notifications → **Turn on reminders**, allow notifications, then **Send a test notification**. On iPhone, add TrainLuma to the Home Screen first and open it from there.

### 2g. Phase 3: circles, invites, usage stats (after migration 0005)
1. Apply `20261013000005_growth.sql` after the first four.
2. **Redeploy the notify function** (`supabase functions deploy notify`). The old version calls a database function this migration removes; until you redeploy, reminders stop (nothing breaks for people).
3. SQL Editor: run the housekeeping block at the top of `supabase/admin/growth.sql` once (expires circle posts after 30 days and raw usage events after 400 days). The rest of that file holds the read-only views: daily events, **% of food logs with zero typing**, D1/D7/D30 retention, top food requests ("Request this food"), referral funnel.
4. Nothing to set up for circles or invites. Plus months from invites are only a **ledger** (no billing exists); they are shown to people as "saved".

### 2h. Trainer interview, trucker path, food plans (after migration 0006)
1. Apply `20261013000006_growth2.sql` after the first five. It lets AI Coach draft **food plans** (`diet_draft`), counted under the existing 20 chat messages a day (no new allowance), and stores those drafts next to plan drafts so they need the person's Accept like workout plans.
2. **Redeploy the ai function** (`supabase functions deploy ai`). Until you do, onboarding, workout drafts and chat work as before; only AI food-plan drafts are missing (the app then builds the food plan on the phone from the food database, which always works).
3. Nothing else to set up. New members now meet their trainer as a short chat ("Prefer a form?" brings back the old form). Questions about food, weight, age, sleep and goals come later, at most one a day during the first week, and can always be skipped.
4. Please read and approve the photo wording (Onboarding → Optional photos): "Progress photos: these help you see change over time. No app can measure body fat from photos reliably — anyone who claims otherwise is guessing." It is marked pending your approval in DECISIONS D43.
5. If the food database file is ever replaced (e.g. the 229-dish version), run `node scripts/build-diet-shelf.mts` once and redeploy `ai`; `npm run check` fails until you do, so it can't be forgotten.

### 2f. First live check (about 20 minutes, with me)
- [ ] Sign in with your email: a 6-digit code arrives and works; a wrong code shows an error.
- [ ] An uninvited email gets no code and the screen doesn't reveal that.
- [ ] A created but **unapproved** user sees "This account isn’t active".
- [ ] Onboarding: pick 5 usual foods, skip photos, turn on backup and AI help, **Generate my draft plan**. A draft appears; nothing changes until **Accept plan**.
- [ ] Workout shows the accepted plan. Your earlier workouts (if any) keep their old plan.
- [ ] Coach → **Ask Coach** → "Can you fit today’s workout into 30 minutes?" gets a grounded answer. Reload: the chat is still there. **Delete chat** removes it.
- [ ] Settings → Optional progress photos: turn on private storage, add one photo, delete it; it disappears from Storage → progress-photos.
- [ ] Log a meal and a set; Settings shows "Backed up"; a second device shows the same entries.
- [ ] Revoke a test member: their open app stops syncing and the coach refuses them straight away.
- [ ] Two people, one phone: sign out, sign in as the second person; none of the first person's chats, photos, drafts or meals appear.
- [ ] Reminders (if set up): a test notification arrives; set gym time 20 minutes ahead and a reminder arrives 15 minutes before; "Hide details" shows only the neutral line.
- [ ] Scan the barcode on a package you have: the product and its label values appear; check them against the package.
- [ ] Settings → Circles: start a circle, share the code with a second account, join it; the week board appears at 3 members.
- [ ] Settings → Invite friends: the second account uses your code once; a second try says it's already used; your "waiting" count shows 1.

---

## 3. Daily use

- **Food:** the cards are your usual meals; **+** adds your usual amount. **Add food → Choose food** opens your meals and the full food list (293 Punjabi and Canadian foods with pictures). 145 of them start with **standard values** (Canadian Nutrient File or USDA), shown with their source. The rest start as **not set**: they log as entries and totals show as partial ("≥") until you add a label or recipe. Weigh your usual bowl or roti once for better estimates.
- **Barcode:** in Choose food, tap the barcode button and point the camera at a package (or type the numbers). The product comes from Open Food Facts; only the number is sent. Check the label values once, then it's one tap next time.
- **Your own recipe:** Edit meal → **My recipe** → **Add from ingredient list** (atta, dal, ghee, onion, paneer…). Enter grams for each and weigh the cooked pot; TrainLuma works out each portion.
- **Exercises:** in the plan editor, **Add exercise** searches 823 exercises, with muscle-map cards, muscle and equipment filters, and how-to steps. Tap **Form** next to any exercise (in the picker, your plan or during a workout) to see the start and end photos and the steps without leaving the workout.
- **Water:** tap **+** on Today for each glass (250 ml).
- **Reminders:** Settings → Notifications: a daily motivation time, gym days and time (reminder 15 minutes before by default), and "Hide details on the lock screen".
- **Your AI trainer:** tap the round avatar button at the bottom right (or **Chat with …** on Today). Give your trainer a name and a look in the chat header or Settings → Your AI trainer.
- **AI Coach:** the same chat. Text only. Answers use your own records, usual foods and plan. Suggestions are just suggestions. To change your plan, tap **Draft an updated plan to review**, then **Accept**, **Edit** or **Not now**. To remember something, tap **Save** on "Remember this?". Nothing is ever logged for you from chat.
- **Optional progress photos:** Front, Back, Left, Right and an Inspiration photo. Two separate switches: **Keep my photos in private storage** and **Let AI Coach see the photos I add when drafting my plan**. Both can stay off; plans work from answers alone. Wear whatever feels comfortable; crop out your face if you like.
- **Planning answers:** Settings → **Workout planning answers** updates goal, week, experience, equipment and screening. New plan drafts use the new answers.

---

## 4. Where your data lives

| What | Where | Who can read it |
|---|---|---|
| Your journal, on the phone | this browser's storage, one separate store per account | anyone using your unlocked phone; keep it locked |
| Backup copy | your private Supabase project, row-level security + approved membership | only your account through the app. The project owner can technically see stored rows in the Supabase dashboard; tell friends this |
| AI Coach chats | `coach_threads` / `coach_messages` in your project | only your account. Kept 90 days after the last message, or until you delete them |
| Things the coach remembers | `user_confirmed_memory` | only your account; only what you confirmed; deleting a chat doesn't delete these |
| Plan drafts | `plan_drafts` | only your account; nothing activates without your Accept |
| Progress photos (if you chose storage) | private bucket `progress-photos`, path `<your id>/<random id>.jpg` | only your account; cropped and re-encoded on the phone (no location data) |
| Reminder settings and devices | `notification_prefs` / `push_subscriptions` | only your account; removed when access ends; reminder text is encrypted to your phone |
| Barcode lookups | Open Food Facts (openfoodfacts.org) | only the barcode number is sent |
| Photos you didn't store | this screen only (memory) | sent once to the AI function if you allowed it, never stored by TrainLuma |
| What goes to Google | your question, a short summary of your own records, your answers, and photos only if you allowed it | processed under the paid Gemini API terms; may be kept briefly for abuse monitoring. It isn't zero retention |

**Export and restore:** Settings → **Export my data** / **Restore from an export**. Exports are health records; keep them private. They don't include chats or photos.

**Deleting an account:** Settings → **Delete my account**, type DELETE. This removes the cloud journal, chats, drafts, reviews, saved notes, photos (the phone deletes the files first) and consent records, stops access immediately, and clears the phone. Then you, as owner, delete the user under Authentication → Users, and check `supabase/admin/members.sql` step 7 for any photo files to purge. Provider backups expire on their own schedule.

**If a key leaks:** revoke or rotate it in the provider's dashboard immediately, update the secret in Supabase, check usage. Deleting it from a file doesn't revoke it.

---

## Official references
- Supabase passwordless email: https://supabase.com/docs/guides/auth/auth-email-passwordless
- Supabase SMTP: https://supabase.com/docs/guides/auth/auth-smtp
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase Storage access control: https://supabase.com/docs/guides/storage/security/access-control
- Supabase Edge Function auth and limits: https://supabase.com/docs/guides/functions/auth · https://supabase.com/docs/guides/functions/limits
- Gemini models, keys, retention: https://ai.google.dev/gemini-api/docs/latest-model · https://ai.google.dev/gemini-api/docs/api-key · https://ai.google.dev/gemini-api/docs/zdr
- Pre-exercise screening (linked, not reproduced): https://store.csep.ca/pages/getactivequestionnaire
