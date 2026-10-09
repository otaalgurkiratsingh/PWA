# Build status

**Phase:** 0, foundations plus a local visual meal-and-workout journal. **Data:** synthetic only. **Credentials used:** none.
**Last updated:** 2026-10-09 · Branch `claude/meal-workout-journal-phase-0-pepxc3`

> "Implemented" is not the same as "tested", and "tested by automation" is not the same as "tried by you on your phone". Every result below says which kind it is.

## What changed in Phase 0

- Project scaffold: React 19 + TypeScript 6 + Vite 8, pinned versions, lockfile, `.nvmrc`, `.gitignore`, and an `.env.example` with placeholders only.
- Decision record and updated private scope ([DECISIONS.md](DECISIONS.md)), design tokens and four screen wireframes ([WIREFRAMES.md](WIREFRAMES.md)).
- Typed zod contracts shared by client and future backend (`shared/contracts`), plus clearly labelled synthetic fixtures (`shared/fixtures`).
- Deterministic domain logic: nutrition batch/portion maths, training sessions, metrics.
- Local-first storage: IndexedDB with an atomic record + outbox write, tombstones, idempotent op ids, and a separate database per profile.
- Usable local slice: Today, Meals, Train, Progress and Settings screens. Includes an app-shell service worker, manifest and icons.
- Supabase schema: tables, constraints, grants, RLS, membership gate, immutable revisions, approval RPC, private operational schema. Isolation tests run against local PostgreSQL.
- Secret scanner. Security/data-flow notes, owner guide, README.

## Checks actually run (2026-10-09, in the build container)

Environment: Linux, Node 22.22.0, npm 10.9.4, PostgreSQL 16.15, Chromium via Playwright 1.56.1.

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | **pass**, 0 errors |
| Lint (incl. no-HTML-injection rules, React hooks rules) | `npm run lint` | **pass**, 0 problems |
| Unit + persistence tests | `npm test` | **pass**, 42/42 (7 files) |
| Production build | `npm run build` | **pass**. JS 399 kB (≈120 kB gzip), CSS 16 kB, no source maps |
| Secret scan (tracked files + git history + `dist/`) | `npm run scan:secrets` | **pass**. A self-test with a planted fake key **fails as intended** |
| Database isolation (local PostgreSQL 16 + Supabase auth stand-in) | `npm run test:db` | **pass**, 26/26 |
| Mutation check of DB controls | ad hoc, migration edited then restored | removing the membership check → 2 tests fail; keeping default grants → 4 fail; single-column child FK → 2 fail |
| Mutation check of atomic save | ad hoc, `tx.abort()` removed then restored | the "outbox write fails → record not saved" test fails as intended |
| Browser end-to-end at phone size (Pixel 7 profile, Chromium) | `npm run test:e2e` | **pass**, 11/11 |
| Plain-HTTP LAN access (insecure context, no `crypto.randomUUID`) | ad hoc Playwright script | **pass**: meal and set saved and restored after reload, no page errors. This found and fixed a real bug |
| Visual review of all screens, light and dark | screenshots in `docs/screenshots/` | reviewed. Fixed: weight-trend wording, e1RM wrongly shown for a bodyweight move, preset ordering, scroll position on navigation |

### What the browser tests cover

- One tap logs a calibrated preset. "Saved on this device" appears **62–83 ms** after the tap (automated; this is not a human timing). Undo removes it.
- An unknown-recipe item makes totals "Unknown" or "≥ N kcal", never 0.
- The Amount sheet logs 3 rotis. Edit shows the logged recipe revision. Delete works.
- Workout: a completed set, its typed reps/kg, and the rest timer all survive a page reload. The timer keeps counting down. There is exactly one active session after reload. Planned "6–8 reps @ 50 kg" stays visible next to the actual values. Skip shows "Skipped". Finish works.
- Offline: after the first visit the service worker controls the page. With the network off, the app reloads, logs a meal, keeps it after another reload, and shows "1 change waiting in the local outbox".
- Switching from Demo A to Demo B shows none of A's meals.
- Missing steps and sleep show "Not entered" / "Not tracked".
- No horizontal overflow at 320 px and 360 px widths, at 100% and 200% text size.
- Every visible control has an accessible name and is at least 40 px. Primary controls are 48 px.
- A set can be completed with the keyboard only.

### What the unit tests cover

- Nutrition: batch = Σ(g/100 × per-100 g); portion = batch × portion g / yield; batch oil counted once; dry/cooked mismatch rejected; unknown stays null and makes totals partial; old snapshots are unchanged by a new recipe revision; quantity scaling.
- Training: prescription snapshotted; actual separate from planned; undo; skip ≠ zero; finished sessions locked until reopened; warm-ups excluded from summaries; previous performance only from the same variant and load convention; copy-last drafts converted to the user's unit; exact lb↔kg; e1RM only for 1–10 reps; timer derived from an end timestamp.
- Metrics: missing days are null; weight trend refuses sparse data; unit conversion.
- Storage: record + outbox atomic (including a simulated quota failure); persistence across close/reopen; idempotent retry; owner and validation checks; version/base-version tracking; tombstones; profile separation; timer persistence; demo seed runs once and queues nothing for sync.

## Checklist progress (sections 2–3 of the owner checklist)

| Item | State |
|---|---|
| Inspect folder/instructions before modifying | done. The repository was empty |
| Compatible versions and exact commands in README; lockfile committed | done |
| Ignore secrets, exports, photos, dumps, signing material | done (`.gitignore`) |
| `.env.example` with placeholders only; scan before pushing | done. Scan passed before push |
| `docs/BUILD_STATUS.md` | this file |
| Gate: starts locally with synthetic data and no credentials | **met (automated)** |
| Today/Meals/Train/Progress with readable labels, large targets, phone layout | built, browser-tested |
| Planned vs actual, loads, skipped sets | built, tested |
| Usual-meal tiles, portion controls, undo/edit, clear estimates | built, tested |
| Deterministic nutrients; unknown kept unknown | built, tested. Numbers are synthetic until you supply real sources |
| Dry/cooked distinction, serving conventions, oil counted once | built, tested |
| Save locally immediately; works without AI | built, tested |
| Workout offline → close/reopen → sets, timer and pending changes intact | **automated pass in Chromium**. **Not yet done on your phone** |
| Refresh, storage failure, reconnection, duplicate retries, conflicting edits | refresh, simulated storage failure and duplicate retries tested. **Reconnection/conflict handling needs the Phase 1 sync server, not built** |
| Owner times a usual-meal entry (target 10–15 s) | **not run.** Needs you on your phone |
| Reduced motion, large text, labels, narrow screens | built; large text, labels and narrow screens tested; reduced motion implemented but not automatically tested |
| Owner tries it on the Samsung phone | **not run** |
| Gate: one full meal-and-workout day logged and recovered | **automated pieces pass; owner trial pending** |

## Known limitations and open issues

1. **No cloud, login, sync, backup or restore yet.** The outbox only accumulates locally. Export (JSON) exists. Import/restore is not built, so export is not yet a tested backup.
2. **All nutrition numbers are synthetic placeholders.** Replace them with label data, USDA FoodData Central records or your confirmed recipes before relying on any total.
3. **Setup screens are missing:** no UI yet to create your own presets, recipes, portion calibrations, program or targets. The demo library comes from fixtures. *This is the biggest gap before real daily use.*
4. Offline mode and installing to the home screen need HTTPS. Over a plain-HTTP Wi-Fi address the app works but cannot install or work offline.
5. JWT verification, signup settings and Edge Functions can only be tested on a real Supabase project (see SECURITY_AND_DATA_FLOW.md "Not yet tested").
6. Draft edits (typing reps/kg without ticking) each create an outbox entry when the field loses focus. Outbox compaction belongs with the sync work.
7. Progression suggestions, notebook-photo plan import, screenshot steps import, and the AI coach are not started (Phase 1–2 by design).
8. The bundle includes all of zod (~120 kB gzip in total). This is acceptable for now; it could switch to `zod/mini` later.
9. Physical-device checks are **not done**: Samsung phone use, screen lock during a real workout, iPhone.

## Your next action (plain language)

**Spend about 15 minutes trying the demo, ideally on your Samsung phone, and judge one thing: does logging feel easier than your notebook?**

1. On your computer, in this project folder: `npm ci`, then `npm run dev -- --host`.
2. On your phone (same Wi-Fi), open the "Network" address it prints. [OWNER_GUIDE.md](OWNER_GUIDE.md) has step-by-step instructions and a short list of things to try. Time one usual-meal tap from opening the app to "Saved".
3. Write down your three biggest annoyances. Separately, and outside this project folder, list your 10–20 real usual meals with portions and your current notebook workout plan.

Do not enter real health data yet, and do not create cloud accounts or keys yet. When you reply with your feedback (and whether you're ready to set up Supabase), the next build step is:
- **Phase 1a (no accounts needed):** setup screens for your own meals, recipes, portions, program and targets, plus JSON import so export becomes a real backup.
- **Phase 1b (needs you):** you create a private Supabase project with MFA. Then the builder adds login, sync, and the isolation tests against that project.

Nothing has been published, deployed, billed, or shared with anyone.
