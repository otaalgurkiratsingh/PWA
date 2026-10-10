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
2. Apply the three database migrations **in order**. Either:
   - with the Supabase CLI: `supabase link --project-ref <your-ref>`, then `supabase db push`; or
   - in **SQL Editor**, paste and run each file in `supabase/migrations/`, oldest first:
     `20261009000001_init.sql`, `20261009000002_sync_auth_ai.sql`, `20261010000003_coach_v2.sql`.
   The third one creates the private **progress-photos** storage bucket, the chat tables, plan drafts and the daily chat-expiry job.
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
3. Start with yourself. Add your wife after the two-person check in 2e. Add friends only with their informed agreement (tell them what you, as project owner, can technically see; see section 4).

### 2c. Connect the website (Netlify)
1. Supabase **Project Settings → API Keys**: copy the **Project URL** and the **publishable** key (never the secret/service-role key).
2. Netlify **Site configuration → Environment variables**: add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
3. Trigger a new deploy.

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

### 2e. First live check (about 20 minutes, with me)
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

---

## 3. Daily use

- **Food:** the cards are your usual meals; **+** adds your usual amount. **Add food → Choose food** opens your meals and the full food list (293 Punjabi and Canadian foods with pictures). List foods start with nutrition **not set**: they log as entries and daily totals show as partial ("≥") until you add a package label or your recipe (**Edit meal, portion or nutrition**). Weigh your usual bowl or roti once for better estimates.
- **AI Coach:** **Ask Coach** on Today (or Coach → Ask Coach). Text only. Answers use your own records, usual foods and plan. Suggestions are just suggestions. To change your plan, tap **Draft an updated plan to review**, then **Accept**, **Edit** or **Not now**. To remember something, tap **Save** on "Remember this?". Nothing is ever logged for you from chat.
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
