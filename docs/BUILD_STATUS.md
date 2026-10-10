# Build status

**Phase:** redesign and completion (CLAUDE_CODE_REDESIGN_AND_COMPLETION_PROMPT.md), built on Phase 0.
**Last updated:** 2026-10-10 · Branch `claude/meal-workout-journal-phase-0-pepxc3`
**Live credentials used:** none. Nothing was published, billed or shared, and nobody was invited.

> "Implemented" is not "tested", and "tested here" is not "tested on your phone or your live Supabase project". Each row below says which.

## What changed

- **Look and feel:** a predominantly white design system, light on first launch, with a sun/moon toggle and a Light/Dark/System setting and no theme flash. Blue primary; food peach, training mint, coach lavender. Original dish-specific illustrations and equipment art. Plain language, with details behind Info/More. A compact "Demo data" chip replaces the banner.
- **Navigation:** Today · Food · Workout · Progress. Coach opens from Today and Settings; the profile opens Settings.
- **Food:** day switcher; usual-meal carousel with one-tap add and Undo; portion sheet (amount + meal type); Add food (Usual / Create / Photo); meals grouped by type, with edit, add again and delete+Undo; "I've logged everything". There is a meal and recipe editor with measured servings ("1 bowl weighs … g"), raw/dry/cooked state, oil counted once, favourites, optional own photo (cropped and re-encoded on the phone) and an edit entry point. Editing nutrition creates a new revision, so old logs keep their values.
- **Workout:** My plan, plus a full editor. Add, rename, reorder, duplicate and remove days. Choose in order or by weekday. Use the searchable library or create your own exercise (equipment, muscle, weight+reps / reps / seconds, one side at a time). Edit, reorder, duplicate, replace and remove exercises, and add, duplicate and remove sets (warmup/working, rep range, optional weight, rest). Saving shows a change preview and creates a new version; past and in-progress workouts keep their plan. Notebook-photo import uses AI and requires confirmation.
- **Active workout:** the current exercise is expanded; set rows read Set / Target / Weight / Reps / ✓; "Warmup" is spelled out. You can add a set mid-workout. Effort and "something hurt" sit behind the set number. **Something hurts** skips the rest of that exercise and notes it. The finish summary shows time, working sets and comparable progress, with Reopen. A compact rest dock sits above the nav.
- **Progress:** 7 days / 4 weeks / 3 months; four metric tiles; a large weight chart with touch readout and a one-line takeaway (method behind Info); a workout calendar with legend; an exercise picker with best-set chart and e1RM behind details; nutrition and steps when data exists; Log weight / Add steps sheets.
- **Sign-in and accounts:** a welcome screen with email one-time code (`shouldCreateUser:false`), resend countdown, edit email, and specific error, offline and rate-limit messages. Uninvited emails get the same neutral message. Session restore checks membership before showing anything. There are unapproved/revoked/deleting screens, a short skippable onboarding (name, adult, units, goal, optional targets, usual meals, workout setup, separate backup and AI consent), safe sign-out and account deletion.
- **Cloud:** a sync engine (push the outbox, pull changes, idempotent op ids, conflict copies you can restore, tombstones) over new RPCs. Migration `0002` adds documents, sync, membership status, deletion, and AI quota/budget accounting.
- **AI now:** an `ai` Edge Function with three operations. It verifies the JWT, checks membership and consent as the caller, makes a transactional reservation with limits and budget, sends minimal context, uses a stateless Gemini adapter, validates output, filters ungrounded and unsafe content, and bounds proposals. The Coach screen has the review (Evidence / Suggested next step / Missing information), starter questions, Accept / Keep current for proposals, memory you can view/edit/delete, and every unavailable state.
- **Also:** restore from export (exercised); CSP generated per build with your exact Supabase origin; Supabase SDK loaded only when configured; two real bugs fixed (described below).

## Checks actually run (2026-10-10, build container)

Environment: Linux · Node 22.22.0 · npm 10.9.4 · PostgreSQL 16.15 · Chromium (Playwright 1.56.1) · Deno 2.9.6.

| Check | Command | Result |
|---|---|---|
| Typecheck (app + tests) | `npm run typecheck` | **pass** |
| Lint (incl. React Compiler hooks rules, no HTML injection) | `npm run lint` | **pass**, 0 problems |
| Unit/integration tests | `npm test` | **91/91 pass** (12 files): nutrition, training, plan editor, metrics, storage + v1→v2 upgrade, export/restore, sync engine, meal builder, auth messages, AI handler/adapter/image/summary |
| Production build | `npm run build` | **pass**. Main JS 159 kB gzip; Supabase SDK in a separate 55 kB chunk; CSS 6 kB; no source maps |
| Secret scan (files + history + dist) | `npm run scan:secrets` | **pass** (168 files) |
| Database (both migrations) | `npm run test:db` | **40/40 pass**: isolation, grants, immutability, approval RPC, sync rules, forged owners, size limits, deletion with old token, per-user memory, 10 concurrent AI reservations → exactly 5, replay, budget/disable |
| Mutation checks (new) | migration edited, run, restored | advisory locks removed → 2 failures; `sync_push` owner check removed → 1 failure |
| Edge Function typecheck | `deno check` | **pass** |
| Edge Function runtime (real `index.ts`) | `npm run smoke:ai` | **7/7 pass**: no/bad/rejected token → 401 with no backend call; foreign origin → 403; unconfigured → 503 without reservation; membership read with the caller's token |
| Browser, demo build | `npm run test:e2e` (demo) | **14/14 pass**: light first launch + persisted theme; no network on unconfigured sign-in; create meal → log → change → add again → delete/Undo → edit nutrition (old log unchanged, new log uses new value); one-tap/Undo; unknown nutrition never zero; create day → custom exercise → sets → save → reload → start → log → finish summary → history; duplicate/reorder/edit without altering the old session (checked in IndexedDB); set + timer survive reload; set table fits its card; Something hurts; offline shell + set survives reload; export → reset → restore; demo people separated; no overflow at 320/360/390 px at 100% and 200% text; names and ≥40 px targets; reduced motion |
| Browser, auth harness | `npm run test:e2e` (auth-harness, scripted fake Supabase) | **5/5 pass**: wrong code → error; correct code → onboarding (no demo data) → backup via `sync_push` with only this user as owner → consent recorded → "Backed up" → reload restores the session without showing the welcome screen → sign out → sign in again; unapproved account refused with no sync; uninvited address gets the neutral message; Coach sends only the session token (no key) and renders the review; Accept proposal → decision RPC → targets updated; AI not configured → truthful message |
| Visual review | `npm run screenshots` + `SHOTS=1` auth run | 41 screenshots at 360 and 390 px, light and dark, empty/error states (`docs/screenshots/`). Inspected; fixed: clipped carousel start, ambiguous day badges, heavy editor buttons, set table overflow at 360 px, chart ticks not covering the data, fragmented weight line, chip touch targets, missing sub-page titles, clipped starter questions, bright rest dock in dark mode |

### Real bugs found by these checks (fixed)
1. **First visit reloaded the page:** the service worker's first `clients.claim` triggered the update reload, wiping what you'd typed. It now reloads only after you tap Update.
2. **Finish summary never appeared:** it was lost when the screen switched back to My plan. It is now owned by the Workout screen.
3. **Uninvited email showed "code expired":** fixed; it now shows the neutral invite-only message.
4. **Settings showed stale targets after an accepted proposal or sync:** the form now refreshes from saved values.
5. **The set table overflowed its card at 360 px:** it now uses a fixed layout and fits at 320–390 px.
6. **Build-time placeholders were replaced in a comment instead of the code** (CSP and service worker): fixed, with build assertions.

## External setup still required (owner actions)

Step-by-step in [OWNER_GUIDE.md §2](OWNER_GUIDE.md):

1. **Supabase project** (free tier): apply the two migrations; disable sign-ups; set the email template to send `{{ .Token }}`; connect SMTP with a verified domain; set rate limits, Site URL and redirect URL.
2. **Members:** create your user, then approve it with `supabase/admin/members.sql`.
3. **Netlify:** add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, then redeploy.
4. **Gemini:** paid, billing-linked Google project and API key; check `gemini-3.8-flash` availability and current prices; `supabase functions deploy ai`; set `GEMINI_API_KEY`, `GEMINI_MODEL`, `AI_PRICE_INPUT_PER_MTOK`, `AI_PRICE_OUTPUT_PER_MTOK` and `ALLOWED_ORIGINS` in Edge Function secrets.

**Blocker noted during the build:** this environment could not reach Google's or Supabase's documentation sites (DNS/proxy refused). The Gemini adapter therefore uses the long-stable `generateContent` shape by default. The Interactions API (`store=false`) option follows Google's published examples but is **unverified**. Both must be confirmed by one live call after setup.

## Not yet verified (do not treat as passed)
- **Live Supabase:** JWT signature/issuer/audience/expiry, disabled sign-ups, email code delivery, SMTP, rate limits, the migrations under Supabase's real roles (re-run the isolation suite there), and Edge Function limits with real photos.
- **Live Gemini:** response and usage fields, cost accounting against the real price list, answer quality, safety behaviour on real data, provider retention terms for your account.
- **Two real people on two phones:** account separation and an old-token denial after deletion, end to end.
- **Your Samsung phone:** install, screen lock during a workout, timing a usual-meal log (target 10–15 s), iPhone if anyone uses one.
- **Backup restore from Supabase's own backups** (plan-dependent). App-level export/restore is tested.
- The Notion reference screenshot was not among the attachments received; the design used the other references.

## Known limitations
- No native Health Connect/Samsung import. Steps are manual and labelled "Manual".
- The weekly review has no scheduled trigger; you request it (1 per week).
- Coach chat history lives only in the open screen; it is not stored. Confirmed memory is stored.
- The demo's nutrition numbers are placeholders. Starter meals created at onboarding have names and portions but no nutrition until you add label or recipe values.
- A member verified on a device can use local data offline for up to 14 days. The server still enforces access on every sync.

## Your next action (plain language)

1. **Look first, no accounts needed:** open your Netlify site after this branch deploys (or `npm run dev`), tap **Explore the demo**, and try Food, Workout (Edit plan → Start) and Progress on your Samsung phone. Tell me what still feels heavy or slow.
2. **When you're happy with how it feels,** do the one-time setup in [OWNER_GUIDE.md §2](OWNER_GUIDE.md): Supabase, then email, then Netlify variables, then Gemini. Start by inviting only yourself.
3. Then we run the **15-minute live check** together (§2e). Only after it passes should you enter real records or invite your wife.
