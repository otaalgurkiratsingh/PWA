# Decision record

Each entry gives the decision, the reason, and what would make us revisit it. Dates are build dates.

## Scope (2026-10-09)

**In scope for the first useful version:** quick repeat-meal logging with calibrated personal portions, a workout notebook replacement (planned vs actual sets, rest timer), simple progress views, offline use, and private login for GK and his wife (Phase 1), then a few invited adult friends (Phase 4).

**Explicitly out of scope:** sales, subscriptions/billing, public registration, referrals, social feeds, streaks/guilt mechanics, coach marketplaces, enterprise dashboards, Play Store launch, market research.

**Deferred until the journal is in daily use:** the AI weekly review and photo suggestions (Phase 2), automatic Samsung Health / Health Connect import and Android packaging (Phase 3), friends (Phase 4), elaborate animations, a global food database.

**Time budget:** a target of about 20 owner-hours to a usable meal and workout slice. If that budget is exceeded, record the blocker here and shrink the scope.

## D1. PWA first, React + TypeScript + Vite

A single web codebase that installs on Android Chrome and still works on iPhone browsers. There is no second native UI. Capacitor packaging (Phase 3) can reuse this interface.
*Revisit if:* the PWA cannot meet the gym-use reliability bar on the owner's phone.

## D2. Plain CSS with design tokens instead of Tailwind

The interface is small, and one token file (`src/core/design/tokens.css`) gives light/dark themes, reduced motion and safe areas without a build plugin. The spec allows "CSS/Tailwind as appropriate".

## D3. Local-first: IndexedDB via `idb`, one database per profile

Gym logging must never wait for the network. Every user change writes the record **and** an outbox operation in one IndexedDB transaction (`Journal.commit`). If the outbox write fails, the transaction is aborted, and a test verifies this. A separate database per profile means switching profiles cannot mix records, drafts, timers or outbox.
Deletions are tombstones (`deleted_at`), so a later sync cannot bring them back.
*Not yet done:* the server sync/reconciliation (Phase 1). Outbox operations accumulate locally until then.

## D4. Snapshots, not live references, for logged meals

A logged meal stores a frozen nutrient snapshot plus the food/recipe revision it came from. Recipe edits create new immutable revisions, so old logs never change. Editing a logged quantity scales the stored snapshot. It does not re-read the current recipe.

## D5. Unknown is `null`, and partial totals are labelled

Unknown nutrients are never zero. Totals keep a `complete` flag, and the UI shows "≥ N kcal" plus an "Some items unknown" badge. Days the user has not marked complete are "partial". Missing steps, sleep and weigh-ins appear as missing markers, never as zeros.

## D6. Synthetic demo data is visibly synthetic

The spec forbids invented nutrition values. The demo still needs numbers to show the maths, so the fixtures use round placeholder values with `source.kind = 'synthetic_demo'`. Every screen shows a "Demo" banner, values carry "Demo values" and "Estimate" badges, and targets say "Synthetic demo target — replace with your own plan". These records are never queued for sync. One food (sabzi) deliberately has unknown nutrition so the unknown path can be seen.

## D7. Rest timer = absolute end timestamp

The timer stores `ends_at_ms` in IndexedDB. The display interval only repaints. This survives reloads, backgrounding and tab death, and a browser test confirms it after a reload.

## D8. Service worker caches the app shell only

A hand-written worker (`src/sw/sw.js`) precaches the built files. A tiny Vite plugin injects the exact file list and a content hash at build time. The worker never touches API, health data or photo traffic. New versions wait for the user to tap **Update**, and the prompt is hidden during an active workout.

## D9. Supabase schema with defence in depth

Supabase schema protection (`supabase/migrations/20261009000001_init.sql`) works in layers:
- explicit table grants to `authenticated` only (Supabase's default broad grants are revoked; `anon` gets nothing);
- RLS on every table requiring `user_id = auth.uid()` **and** active approved membership (`private.is_active_member()`);
- composite `(id, user_id)` foreign keys, so a child can never reference another owner's parent;
- triggers that make `version`, `created_at` and `updated_at` server-controlled, block owner reassignment, and freeze sealed recipe/program revisions;
- append-only consent ledger; coach reviews/proposals are read-only for clients; decisions go through a `SECURITY DEFINER` RPC with an empty `search_path` and explicit identity checks;
- operational tables (`approved_members`, `ai_requests`, budget, receipts, privacy jobs, deletion ledger) in a `private` schema with no client table privileges.

*Mutation-tested:* removing the membership check, keeping default grants, or using single-column child FKs each makes specific isolation tests fail.

## D10. Dependency versions

The newest stable versions compatible with each other on 2026-10-09: React 19.3.0, Vite 8.3.4, Vitest 5.0.3, zod 4.6.5, idb 8.0.4, ESLint 10.12.0, typescript-eslint 8.71.1.
**TypeScript 6.0.3**, not 7.0: typescript-eslint 8.71 supports `<6.1.0`.
**Playwright 1.56.1**, not 1.64: it matches the Chromium build available in the build container. Upgrade both together on a developer machine.

## D11. Exercise comparisons only within a comparable variant

"Same exercise" means the same movement key + equipment variant + load convention (total / per dumbbell / per side / bodyweight) + unilateral flag. Warm-ups are excluded from working-set summaries. Volume is described for one exercise only. The e1RM is labelled "estimate — Epley v1, 1–10 reps". It is not shown for bodyweight moves.

## D12. AI deferred, but its contract is fixed now (superseded: AI is live in the redesign and V2, see D22–D27)

`shared/contracts/coach.ts` defines the coach output schema (period, completeness, observations with evidence refs, suggestions with uncertainty, questions, safety flags, model/prompt version). The schema is fixed now, but there is no AI code, no model call, and no key handling in this build.

## D13. App name: TrainLuma (2026-10-09)

"TrainLuma" means "daily" in Hindi, Urdu and Punjabi. The app is a daily habit for meals and workouts: short, personal, and not tied to only food or only the gym. It fits under a home-screen icon. The owner asked the builder to choose. It replaces the working name "AapnaFit". The original spec files in `docs/spec/` keep the old name because they are the owner's source documents. No trademark search was done; that is acceptable for a private, non-commercial app with no store listing.
Storage keys were renamed too (`rozana-journal-*`, `rozana.theme`). Any demo data created under the old name stays in the browser's old database and is ignored. It was synthetic only.

## D14. Redesign direction (2026-10-09)

The owner found the Phase 0 look heavy, technical and dark. The new system is predominantly white and light by default, with dark mode opt-in or following the system. It uses one blue primary action and three role colours: peach for food, mint for training and lavender for the coach. Language is plain, with technical detail behind Info/More. The demo is a compact chip, not a banner. See WIREFRAMES.md.

## D15. Journal sync uses owner-scoped JSON documents

The app's aggregates (meal entries with snapshots, sessions with nested sets, plan versions, presets, recipes, custom exercises, profile settings) sync as whole documents in `public.journal_documents`. Writes go only through `sync_push`, which checks owner, size, idempotency and version. Pulls use a per-user server sequence. This keeps local and cloud shapes identical, makes conflicts per document, and avoids a large set of per-table writers. The normalised tables from migration 0001 stay defined and protected for future server-side use. `consent_events`, `coach_reviews`, `change_proposals` and `user_confirmed_memory` are used directly.
*Revisit if:* server-side queries across many documents become slow (add generated columns or a projection then).

## D16. AI request style

`generateContent` is the default because the build environment couldn't reach Google's documentation to confirm the Interactions API fields; `generateContent` is stateless by nature. The Interactions API is available with `store=false` and no chaining or background mode via `GEMINI_API_STYLE=interactions`, after a live smoke test. The model ID is configurable (`GEMINI_MODEL`, default `gemini-3.8-flash`). Prices must be set as secrets, otherwise the coach stays off.

## D17. Auth: email one-time code, invite-only

Sign-in uses Supabase email OTP with `shouldCreateUser:false`, sign-ups disabled in the dashboard, and approved membership in `private.approved_members`. Uninvited addresses get the same neutral message as invited ones. Session restoration validates membership before showing any journal. A previously verified member can use local data offline for up to 14 days.

## D18. Supabase SDK loaded on demand

`@supabase/supabase-js` is a separate chunk (≈55 kB gzip), downloaded only when sign-in is configured. The demo and offline logging never need it.

## D19. Name: TrainLuma (2026-10-10)

The owner renamed the app TrainLuma and supplied the TL logo. Install icons are rendered from the owner's artwork (`scripts/render-icons.mjs`); the in-app mark and `icon.svg` are a vector redraw of the same TL shape. Supersedes D13 for everything people see. **Internal storage keys stay `rozana-*`** (IndexedDB names, theme key, export format id) so nobody's journal or exports are orphaned by the rename. The coach prompt uses "TrainLuma Coach" where the owner's spec says "AapnaFit Coach"; nothing else in the prompt is changed (checked by a test).

## D20. Food catalogue: bundled, read-only, never copied into journals

The 293-item Punjabi Canadian catalogue ships with the app as a validated, lazily loaded file (no personal data, works offline after first load) and with the Edge Function (for photo matching). Picking a food creates ONE personal meal with `catalogue_id`; a person's favourites, recipes, servings and history stay their own records. Search normalises spelling (dal/daal, sabzi/sabji, roti/chapati/phulka, dahi/curd, chai/cha). Old meals are linked only by an exact, unique name or alias match ("Roti", "Chai", "Whey shake"); a generic "Dal" stays unlinked, and nothing is rewritten.
*Revisit if:* the catalogue grows past a few thousand items (move to a server table with a member-readable policy).

## D21. Nutrition stays unknown until sourced; servings may be unweighed

Every catalogue nutrient is null by design, and no Canadian Nutrient File values were imported in this pass (the build container couldn't reach the CNF/Health Canada sites to verify the 2026 release or licence). `grams_per_unit` became nullable, so a list food can be logged before anyone weighs a bowl. Its entries carry unknown nutrients and make daily totals partial ("≥"), never zero.

## D22. One versioned coach prompt; schema 2.0; v1 kept readable

`docs/spec/AI_FITNESS_COACH_SYSTEM_PROMPT_V2.md` (identity → output contract) is installed by `scripts/build-coach-prompt.mjs` as the only system prompt for every coach operation. The version `coach-2.0+<sha256 prefix>` is stored with every review, message and draft. The implementer notes are not sent to the model. The notebook-photo import keeps its own short extraction instruction, because it is a structured parser, not a coach conversation. Saved version-1 reviews are read through `reviewOutputFromStored`; stored rows are never rewritten.

## D23. Chat budget: 8,000 input tokens (spec said about 6,000)

The owner-supplied system prompt alone is about 16,400 characters (roughly 4,000–4,700 tokens), which would leave almost no room for context and the last 8 messages under 6,000. The ceiling is 8,000 (code constant, configurable), and old messages are trimmed first. Output stays at 1,200 tokens. To be re-measured against real provider token counts.

## D24. The coach needs backup on

The backend assembles context from the person's backed-up documents, read with their own token under RLS, and never trusts context sent by the phone. With backup off, the coach screens explain this and offer to turn backup on, rather than answering from nothing.

## D25. Plan drafts: one call, validated in code, activated only on approval

`onboarding_plan` refuses stale profile versions and asks for missing answers or gives screening guidance without calling the model. It reserves budget for one bounded retry, which is used only after an invalid answer, never after a timeout. It validates exercise ids, days, weekdays, reps, units and our own duration estimate, unsets unknown loads, and stores a draft. **Accept** creates a new program version on the phone; **Edit** opens it in the plan editor, and saving there counts as approval; **Regenerate** supersedes the draft. Chat never returns a plan; it offers to draft one, which uses the plan allowance (first plan + 2 per week), not chat messages.

## D26. Photos: two separate permissions; storing is optional

"Keep my photos in private storage" and "Let AI Coach see my photos" are independent. Without storage, photos live only in memory on that screen and, if AI images are allowed, are sent once inside the plan request. The server re-checks permission and JPEG content and never stores them. Stored photos use random paths in a private bucket, with folder-scoped Storage RLS. Account deletion removes files through the Storage API first (SQL can't delete Storage objects), and any leftovers are listed for the owner.

## D27. One AI request in flight per person; local-day quotas

`ai_reserve` refuses a second concurrent request from the same person (`busy`), computes "today" from server time in the person's validated IANA timezone, and counts failed requests as not used. Chat: 20 a day.

## D28. Staged imports and health integrations stay disabled

Scale screenshots (stage B), MyFitnessPal CSV (stage C) and device health connections (stage D) are specified, not built. There is no attachment button in chat. `measurement_candidates` must be empty in every response; the schema allows at most 0 items.
