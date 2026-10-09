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

## D12. AI deferred, but its contract is fixed now

`shared/contracts/coach.ts` defines the coach output schema (period, completeness, observations with evidence refs, suggestions with uncertainty, questions, safety flags, model/prompt version). The schema is fixed now, but there is no AI code, no model call, and no key handling in this build.
