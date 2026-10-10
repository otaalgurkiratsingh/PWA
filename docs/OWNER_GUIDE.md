# Owner guide (plain language)

Rozana is a private meal and workout journal for you, your wife and a few invited friends. This guide covers three things: how to try it, the one-time setup that only you can do, and how data is kept. Dashboard menu names change from time to time. If a label below doesn't match what you see, look for the closest equivalent; the official links are at the end.

> Never paste a key, password or recovery code into a chat, an issue, a screenshot or a file in this project. Enter secrets only in the official dashboards.

---

## 1. Try it right now (no accounts needed)

Your existing Netlify site (or `npm run dev` on your computer) opens the **welcome screen**. Tap **Explore the demo (made-up data)**. Everything in the demo is invented: meals, nutrition numbers, history and plan. It stays only on that device.

Try:
- **Food:** tap **+** on a usual meal (with Undo). Tap a meal card to choose an amount and the meal type. Use **Add food → Create meal** to save one of your own.
- **Workout:** **Edit plan** to add a day and a custom exercise, then save. **Start** a day, enter weight and reps, and tap ✓. Lock the phone for a minute: the rest timer keeps counting. Reload the page: your sets are still there.
- **Progress:** switch between 7 days, 4 weeks and 3 months. Tap the weight chart to read a day.
- **Settings:** use the sun/moon toggle. The app starts in light mode even if your phone is in dark mode.

---

## 2. One-time setup for real sign-in, backup and AI

You only need to do this once. Until it's done, the sign-in screen says "Sign-in is still being set up" and offers the demo.

### 2a. Supabase project (free tier)
1. Create a **new, separate** Supabase project, not your agency one. Turn on MFA for your Supabase account and keep the database password in a password manager.
2. Apply the database migrations in order. Either:
   - with the Supabase CLI on your computer: `supabase link --project-ref <your-ref>`, then `supabase db push`, or
   - in **SQL Editor**: paste and run `supabase/migrations/20261009000001_init.sql`, then `…000002_sync_auth_ai.sql`.
3. In **Authentication → Sign In / Providers**:
   - **Email**: enabled.
   - **Allow new users to sign up**: **off**. Rozana never creates accounts by itself; the app sends `shouldCreateUser: false`.
   - **Email OTP expiration**: a short value, e.g. 10 minutes. **Email OTP length**: 6.
4. In **Authentication → Emails → Templates → Magic Link**, make the email contain the **code**, not a link. The app asks for a code. For example:

   ```
   <h2>Your Rozana sign-in code</h2>
   <p>Enter this code in the app: <strong>{{ .Token }}</strong></p>
   <p>It expires soon. If you didn’t ask for it, ignore this email.</p>
   ```
5. In **Authentication → Emails → SMTP settings**, connect a real email sender (for example Resend, Postmark or Amazon SES) and verify your sending domain as the provider instructs. The built-in Supabase mailer is for testing only and sends very few emails.
6. In **Authentication → Rate limits**, keep the email limits low; a few per hour is plenty for this group.
7. In **Authentication → URL configuration**, set **Site URL** to your Netlify address. Add only that exact address under **Redirect URLs**.

### 2b. Invite people (start with yourself)
1. **Authentication → Users → Add user**: enter the email address and confirm the user.
2. **SQL Editor**: run the first statement in `supabase/admin/members.sql` with that email. This approves the membership.
   Without step 2 the person can receive a code but sees "This account isn’t active".
3. Start with your own account only. Add your wife after you've checked separation (section 5). Add friends only with their informed agreement.

### 2c. Connect the website (Netlify)
1. In Supabase, open **Project Settings → API Keys** and copy the **Project URL** and the **publishable** key. **Do not** use the secret or service-role key here.
2. In Netlify, open **Site configuration → Environment variables** and add:
   - `VITE_SUPABASE_URL` = your project URL
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = the publishable key
3. Trigger a new deploy. The build writes your project address into the site's security headers automatically.

### 2d. AI coach (Gemini, paid API project)
1. In Google Cloud / Google AI Studio, use a **separate project with paid billing turned on**. A consumer Gemini subscription is not the same thing. Turn on MFA, and set budget alerts. Alerts only notify you; the app enforces its own limits.
2. Create an API key in Google AI Studio and restrict it to the Gemini (Generative Language) API.
3. Check that `gemini-3.8-flash` is available to your project, and note the current **input and output price per 1M tokens** from the official pricing page.
4. Deploy the function from your computer: `supabase functions deploy ai`.
5. In **Supabase → Edge Functions → Secrets**, type these in yourself:
   - `GEMINI_API_KEY`: your key (never anywhere else)
   - `GEMINI_MODEL`: `gemini-3.8-flash`
   - `AI_PRICE_INPUT_PER_MTOK` and `AI_PRICE_OUTPUT_PER_MTOK`: the prices from step 3. Without them the coach stays off on purpose, so it can't spend money it can't count.
   - `ALLOWED_ORIGINS`: your Netlify address, e.g. `https://your-site.netlify.app`
   - Optional `GEMINI_API_STYLE`: leave unset, so it uses `generateContent`, which is stateless. `interactions` uses the newer Interactions API with `store=false`; only switch after a successful test.
6. The monthly budget starts at **US$10**, with per-person limits of 3 photos a day, 5 questions a day and 1 weekly review a week. Change them with `supabase/admin/members.sql`.
7. Each person turns on **AI help** for themselves under Settings or on the Coach screen. Logging never needs AI.

### 2e. First live check (about 15 minutes, with the builder)
- [ ] Sign in with your invited email: a 6-digit code arrives and works. A wrong code shows an error.
- [ ] An email that isn't invited gets no code, and the screen doesn't reveal that.
- [ ] A created but **unapproved** user sees "This account isn’t active".
- [ ] Log a meal and a set, then open Settings: it shows "Backed up". Sign in on a second device: the same entries appear.
- [ ] Turn on AI help and get a weekly review. It names the days it used and what is missing.
- [ ] Revoke a test member: their open app stops syncing straight away.

---

## 3. Daily use

- **Food:** the cards are your usual meals. **+** adds your usual amount; tap the card to change the amount or the meal type. **Add food** offers a saved meal, a new meal, or a photo. A photo gives dish suggestions that you confirm; it never assigns calories by itself. At the end of the day, tap **I’ve logged everything** so averages only use complete days.
- **Workout:** **Edit plan** changes days, exercises and sets. Each save creates a new version, and past workouts keep the plan they were done with. During a workout, tap a set number for effort, skip, or "something hurt". **Something hurts** skips the rest of that exercise and notes it.
- **Coach:** a weekly review grounded in your own logs, short questions, and target suggestions you can **Accept** or **Keep current**. "What the coach remembers" shows only the facts you added; you can edit or delete them.

---

## 4. Where your data lives

| What | Where | Who can read it |
|---|---|---|
| Your journal, on the phone | this browser's storage (IndexedDB), one separate store per account | anyone using your unlocked phone and browser — keep the phone locked |
| Backup copy | your private Supabase project, row-level security + approved membership | only your account through the app. The project owner can technically see stored rows in the Supabase dashboard — tell friends this; the app itself has no admin view of anyone’s journal |
| Meal pictures you choose to save | inside your meal record (small, re-encoded, no location data) | only your account |
| Photos sent for suggestions | cropped and shrunk on the phone, sent once to the AI function, not stored by Rozana | Google processes them under the paid API terms (stateless, but may keep them briefly for abuse monitoring) |
| Coach reviews, notes, consent history | your Supabase project | only your account |

**Backups and restore.** In Settings, **Export my data** downloads a JSON file, and **Restore from an export** brings it back. Both have been tested. Keep exports private: they are health records. The free Supabase tier has limited backups, so export regularly or choose a paid plan if you need managed backups.

**Signing out.** If something hasn't backed up yet, Rozana tells you and offers an export first. Your entries stay on that phone until they're backed up. After signing out, nobody can open your journal in Rozana without signing in again.

**Deleting an account.** Go to Settings → **Delete my account** and type DELETE. This removes the cloud journal, reviews, notes and consent records, stops access immediately, and clears that phone. You, as owner, then delete the user under Authentication → Users. Provider backups expire on their own schedule; the deletion ledger lets you re-apply the deletion after any restore.

**If a key leaks.** Revoke or rotate it in the provider's dashboard immediately, update the secret in Supabase, and check usage logs. Deleting it from a file does not revoke it.

---

## Official references
- Supabase passwordless email: https://supabase.com/docs/guides/auth/auth-email-passwordless
- Supabase SMTP: https://supabase.com/docs/guides/auth/auth-smtp
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase Edge Function auth and limits: https://supabase.com/docs/guides/functions/auth · https://supabase.com/docs/guides/functions/limits
- Gemini model, keys, Interactions API, data retention: https://ai.google.dev/gemini-api/docs/latest-model · https://ai.google.dev/gemini-api/docs/api-key · https://ai.google.dev/gemini-api/docs/interactions-overview · https://ai.google.dev/gemini-api/docs/zdr
