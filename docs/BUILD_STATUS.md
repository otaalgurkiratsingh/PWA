# Build status

**App:** TrainLuma (renamed from Rozana on 2026-10-10; new TL logo).
**Phase:** V2 food, AI onboarding and text AI Coach (`docs/spec/CLAUDE_CODE_FOOD_AND_AI_ONBOARDING_UPDATE_V2.md`), built on the approved redesign.
**Last updated:** 2026-10-10 · Branch `claude/meal-workout-journal-phase-0-pepxc3`
**Live credentials used:** none. Nothing was published, billed or shared, and nobody was invited.

> "Implemented" is not "tested", and "tested here" is not "tested on your phone or your live Supabase project". Each row below says which.

## What changed in this pass

| Area | Done |
|---|---|
| **Date badges** | Cause found in the DOM: on phones set to English (UK/India/Canada) the month reads "Sept". It was flipped into one text run inside a fixed 44×44 px tile with no padding, so "Sept 30" (~50 px) wrapped out of it. Now the month and the day are separate elements, with fixed labels Jan–Dec read from the stored local date (no UTC parsing). The tile has a minimum size and grows with text size. The row uses an `auto / minmax(0,1fr) / auto` grid, and the full date is in the row's accessible name. |
| **Food catalogue** | 293 entries, 16 categories, validated on load (unchanged ids and assets, nutrients null and never zero, counts and family checks). Loaded lazily as a separate 14 kB file. Search uses normalised aliases and spellings. Category chips, Popular, and All foods (lazy rows). One personal meal per picked food, never 293 copies. Old meals are linked only by exact name ("Roti", "Chai", "Whey shake"); generic "Dal" stays unlinked. Food choices (vegetarian/egg/fish/meat, meat-free weekdays, allergies) filter browsing only. |
| **Illustrations** | 293 original SVG drawings in the existing style (same plate, bowl, viewpoint and soft shadow). They come from a shared kit with deliberate per-food shapes, colours, fillings and garnish. Coverage test: every asset key resolves, there are no orphans, no text or external references, and no two pictures are identical. The gallery was inspected and weak drawings were redrawn (cashews, cottage cheese, egg curry, scrambled eggs, burfi/kaju katli, biscuits/mathri/peda). |
| **Nutrition honesty** | Servings can be logged before they're weighed (`grams_per_unit` nullable). Their nutrients are unknown and totals become partial ("≥"). No CNF values were imported (see Blocked). |
| **Coach prompt** | `AI_FITNESS_COACH_SYSTEM_PROMPT_V2.md` installed as the single backend system prompt for every coach operation, by a generator script with a SHA-256 hash. The version `coach-2.0+8417435771c1` is stored with every review, message and draft. Implementer notes are not sent. Schema 2.0 validators are shared by function and app. Saved v1 reviews are readable through a compatibility adapter, never rewritten. |
| **Text AI Coach** | **Ask Coach** on Today and Coach. Chat screen with scope note (shown once), starters, plain-text replies, suggestions, follow-up chips that fill the composer, **Remember this? Save/No**, **Draft an updated plan to review**, data window, New chat, Delete chat, Delete all. States covered: thinking, stop waiting, failure with Retry (same request id) or Edit, quota, offline, not configured, needs AI permission, needs backup. Threads and messages are stored privately for 90 days after the last message. |
| **Onboarding** | 9 steps with progress, Back, Save and continue, Skip for optional steps, and a draft saved on the device after every change. Steps: name/18+/units → goal priorities → week (days, sessions, minutes, time windows, shift work) → experience → equipment, exercises to avoid, professional limits, and the CSEP Get Active Questionnaire (linked, not reproduced) → 5–15 usual foods + food choices + optional targets → optional photos → privacy → review → **Generate my draft plan**, own plan, simple plan, or skip. |
| **Optional photos** | Front/Back/Left/Right/Inspiration, each skippable, replaceable and deletable. Two separate permissions: private storage and AI images. Photos are cropped and re-encoded on the phone (location data removed). Storage is a private bucket with random paths and folder-scoped RLS. Without storage, photos stay on that screen only and are sent once if AI images are allowed. "What do you like about this goal?" is saved as the person's own words. |
| **Plan drafts** | `onboarding_plan`: stale-profile refusal, missing-answer questions and screening guidance happen without a model call. One draft per request. Validation in code covers allowed exercise ids (from the person's equipment, avoided moves removed), days ≤ agreed, available weekdays, reps, units, unknown loads unset, and our own duration estimate. There is at most one retry after an invalid answer. Preview shows days, exercises, sets×reps, rest, warm-up, recovery and progression. **Accept** creates a new program version; **Edit** opens the plan editor, where saving counts as approval; **Regenerate** supersedes the old draft. |
| **Backend** | Migration `0003`: `coach_threads`/`coach_messages` (composite owner key, read-only to clients, 90-day expiry hidden by RLS and removed by pg_cron), `plan_drafts` + `decide_plan_draft`, `progress-photos` bucket + Storage RLS + `progress_photos`, new permission types, `ai_reserve` v2 (one request in flight, local-day windows, separate plan allowance, 20 chat messages a day), `my_ai_usage(tz)`, and account deletion covering all of it. |
| **Edge Function** | Every operation on the V2 prompt and schema 2.0. Context is a single-person envelope built from the caller's own documents (usual foods with "nutrition confirmed" flags, current plan, metrics, confirmed memories). Chat: last 8 messages, trimmed to an 8,000-token input ceiling, 1,200 output. Plan: 6,000 output, budget reserved for both attempts. Photo matching is restricted to real catalogue ids and the person's own meals. |
| **Rename** | TrainLuma name, icons rendered from the owner's logo, vector TL mark in the app. Storage keys deliberately unchanged (D19). |

## Checks actually run (2026-10-10, build container)

Environment: Linux · Node 22.22.0 · npm 10.9.4 · PostgreSQL 16 · Chromium (Playwright 1.56.1) · Deno 2.9.6.

| Check | Command | Result |
|---|---|---|
| Typecheck (app + tests) | `npm run typecheck` | **pass** |
| Lint | `npm run lint` | **pass**, 0 problems |
| Unit/integration tests | `npm test` | **137/137 pass** (18 files; 2 skipped = gallery generators). Covers: catalogue validation/search/legacy mapping (9), art coverage/uniqueness (4), catalogue → meal + browse filter (6), unweighed servings, date parts (3), AI handler incl. chat, plans, photos, injection, budget/retry, v1 compatibility (39), plan rules + prompt install (7), AI draft → program version (2), plus the earlier suites |
| Production build | `npm run build` | **pass**. Main JS 200 kB gzip (was 159; mostly the 293 drawings and new screens). Food list 14 kB, Supabase SDK 54 kB, CSS 7 kB, both separate. |
| Secret scan | `npm run scan:secrets` | **pass** (222 files, git history, dist) |
| Database | `npm run test:db` | **59/59 pass** over three migrations. New: chat exchange storage and replay, owner-only reads, no client writes or forged assistant turns, composite key blocks cross-owner messages, permission/revocation stops persistence, expiry hides then deletes, Delete chat keeps memories, drafts written only by the backend, supersede/stale/foreign-decision refusal, private bucket limits, upload needs photo-storage permission, folder/name/path-traversal refusal, no cross-person read or delete with guessed paths, revoked members locked out, deletion covers chats/drafts/photo records, 10 concurrent requests → exactly 1 reserved, 20 a day, failed calls not counted, Toronto day window, plan allowance (first + 2) separate from chat |
| Mutation checks (new) | migration edited, run, restored | single-column chat FK → 1 failure; photo-storage permission removed from upload policy → 2 failures; one-in-flight rule removed → 2 failures |
| Coach prompt in sync | `node scripts/build-coach-prompt.mjs --check` | up to date |
| Edge Function typecheck | `deno check` | **pass** |
| Edge Function runtime | `npm run smoke:ai` | **18/18 pass**. Phase 1 (no AI secrets): 401/403/503 with no reservation. Phase 2, an **integration harness with a mock Gemini on 127.0.0.1 and a fake key (not the real provider)**: chat stored through the service RPC for the verified user; the model receives the installed V2 prompt, a 1,200-token output budget and JSON schema with no tools; key only in the header; journal read with the caller's token; reservation with timezone; plan draft validated and stored; stale profile refused before any call |
| Browser, demo build | Playwright | **20/20 pass**. New: date badges for all 12 months and Sep 29/27/25 at 360/390 px, light and dark, 100% and 200% text, en-GB locale; food list search (chapati, sabji, daal makhani), add with unknown nutrition, one personal meal, reuse; categories and All foods (293 rows) |
| Browser, auth harness | Playwright vs. scripted fake Supabase | **15/15 pass**. New: onboarding resumes after reload; usual foods → skip photos → generate → preview → accept → new program version (nothing active before accepting); Edit → editor save = approval; Regenerate supersedes; photos stored with permission and AI images declined → plan from answers, photo_ids empty, delete removes file and record; AI images on without storage → one re-encoded JPEG sent, nothing stored; provider failure → truthful message, answers kept, manual plan works; chat (plain text: an HTML payload doesn't execute, thread in the URL, memory only on Save, plan proposal only as a draft, failure keeps the message, Retry reuses the request id, double-click sends once, reload restores, Delete chat keeps memories); quota and offline; **two people on one phone**: second person sees none of the first person's chats, drafts, photos or meals, and a guessed thread id shows "deleted or expired"; v2 review + v1 review readable + old proposal accepted; backup-off coach explanation |
| Visual review | `npm run screenshots` + `SHOTS=1` auth run | Inspected: welcome with TL logo, Today, food picker, alias search, category, list-food sheet, onboarding review, plan draft, chat reply, photos, date badges (light/dark, 1×/2×). Gallery of all 293 illustrations inspected |

## Blocked (external)

- **Nutrient sourcing:** the build container cannot reach Health Canada / open.canada.ca, so the 2026 Canadian Nutrient File version and licence couldn't be checked and no CNF values were imported. Every catalogue food is honestly "nutrition not set" until the person adds a label or recipe. Next step: download the CNF 2026 release on a normal computer, confirm the licence and source ids, then map a first set of staples (roti, rice, dals, dahi, milk, eggs, paneer, chicken) with source and version recorded.
- **Live services:** everything that needs your Supabase project, SMTP, paid Gemini key and phones (see the owner guide's checklist).
- **Official docs:** Google's and Supabase's documentation sites were unreachable from here, so current Gemini JSON-schema support, token and thinking accounting, and Storage details are unverified (see below).

## Not yet verified (do not treat as passed)

- **Live Gemini:** whether `gemini-3.8-flash` accepts the schema-2.0 JSON schema as sent; real token counts (the system prompt is about 16,400 characters); whether thinking counts against `maxOutputTokens`; usage fields; prices; answer quality on real data; safety behaviour; retention terms for your account. Reservations are deliberately conservative until measured.
- **Live Supabase:** the three migrations under Supabase's real roles (re-run the isolation suite there), Storage RLS and downloads with a user token, the bucket's size and MIME limits, the pg_cron schedule, JWT/getClaims, disabled sign-ups, code email, SMTP, rate limits.
- **Two real people on two phones**, including old-token denial after deletion.
- **Phones:** Samsung/Android install, chat keyboard and safe areas, photo picking from the camera, timing a usual-meal log; iPhone if anyone uses one.
- **Supabase provider backups** and restore (plan-dependent).

## Staged and disabled (not first-release work)

| Stage | Status |
|---|---|
| B: confirmed scale-screenshot import (`measurement_extract`) | **Not built, disabled.** No attachment button in chat; `measurement_candidates` must be empty (schema max 0). |
| C: MyFitnessPal CSV import | **Not built, disabled.** Needs a user-authorised sample export first. |
| D: other formats, Health Connect / Samsung / HealthKit | **Not built, disabled.** Steps stay manual. |

## Known limitations

- The coach needs backup on (D24). With backup off, it explains this instead of answering.
- Chat history is text only and expires 90 days after the last message; confirmed memories stay until deleted.
- The weekly review has no schedule; the person requests it (1 a week).
- The notebook-photo plan import still uses its own short extraction instruction (D22).
- Main bundle grew to 200 kB gzip; the drawings could be split into a lazy chunk later if first-load time on a slow phone matters.
- A member verified on a device can use local data offline for up to 14 days. The server still enforces access on every sync and AI call.

## Your next action (plain language)

1. **Look first, no accounts needed:** after this branch deploys, open the site, **Explore the demo**, try **Add food → Choose food** (search "chapati" or "daal") and **Workout → Recent workouts**. Tell me if any food picture looks wrong.
2. **Then do the one-time setup** in [OWNER_GUIDE.md §2](OWNER_GUIDE.md). There is a new third migration, the photo bucket check, `pg_cron`, and **redeploying the `ai` function**.
3. **Then we run the 20-minute live check together** (§2e). Only after it passes should you enter real records or invite your wife.
