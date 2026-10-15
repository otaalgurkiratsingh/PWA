# TrainLuma one-shot build report

**Branch:** `claude/one-shot-build` (based on `claude/meal-workout-journal-phase-0-pepxc3`; `main` not touched) · **Date:** 2026-10-15
**Inputs:**
- `docs/spec/TRAINLUMA_FOOD_DB_BUILD_BRIEF.md`
- TRAINLUMA_AI_INTERVIEW_SPEC.md (v1.0)
- TRAINLUMA_EXERCISE_FORM_SPEC.md (v1.0)
- the Oct 12 app-review fixes
- the owner's notes: body problems shaping plans, and Bevel's daily score

**Live credentials used:** none. Nothing was deployed, published or billed, and nobody was invited.
**Previous report:** `docs/reports/BUILD_REPORT_2026-10-13_food-db-retention.md`.

| Phase | Commit |
|---|---|
| Prep: e2e ports configurable | `9920183` |
| 1 — Food DB import + bicultural ranking | `f23b43d` |
| 2 — Samosa / duplicate question / meal persistence | `e6ff75e` |
| 4 — Exercise form demos | `c2dad57` (merged `4f2c47b`, `dc2aeae`) |
| 3 — AI interview, trucker path, pain-aware plans, food plan, weekly adaptation | `21129f1` |
| Draft spec: morning readiness note | `cfe88ba` |
| 5 — Verification + this report | final commit |

Phases 3 and 4 were built in parallel on isolated copies, then merged; each is one commit on this branch.

---

## Phase 0: discrepancies between the specs and the repo

The build follows the repo as it actually is, not the docs. Items marked ⚠ change what could be built.

1. ⚠ **The final food database is not available.** The brief names `~/workspace/trainluma-food-db/indian_dishes.json` (FINAL: 229 dishes, 216 Tier 1, 13 Tier 2). That folder does not exist here.
   - The uploads only hold the older 130-dish file (72 Tier 1 / 58 Tier 2), byte-identical to the one already in the repo. Your Google Drive has no matching file either.
   - Per "never any older file", nothing older was imported. The live data stays the 130-dish v1 already in the app. Phase 1 instead ships a validated **drop-in importer** for the 229-dish file.
2. ⚠ **There is no "bicultural ranking (§13)".** The brief in the repo, and the uploaded copy (same checksum), has §13 = "The 90% goal — zero-typing logging". The bicultural blend was built from your one-line description (Phase 1).
3. **Onboarding claims (interview spec §0):**
   - 9 steps: verified. "Units" is weight units only.
   - Diet preference **already existed** (5 patterns: unspecified / vegetarian / eggetarian / pescatarian / everything). The spec treats it as missing; Phase 3 maps veg / egg / non-veg onto it.
   - **Weight, age, sex, sleep, timeline and pain areas did not exist.** "Injuries" were only free text in `restrictions` / `avoid_exercises`.
   - Usual foods "5–15" is only a hint: max 15, no minimum.
4. **Profile storage:** profile fields live in the synced JSON settings document (`journal_documents`) and are validated client-side. They need **no SQL migration**.
   - `public.profiles` exists but is unused.
   - Migration `20261013000006_growth2.sql` was still added, for the parts that are server-side (see Phase 3).
5. **Plan validator (D25):** verified.
   - It **already had an equipment filter** (the person's equipment plus bodyweight; avoided names) but ignored location. Phase 3 adds the no-gym rule.
   - The AI may use exactly 49 exercise ids, as claimed.
6. **Photos:** two permissions (`photo_storage`, `ai_images`), 5 slots, on-device crop / re-encode, private bucket. All verified.
7. **Coach:** prompt `coach-2.0+8417435771c1`; the four ops and weekly reviews are verified. The chat limit is 20 a day (D27), global rather than per person.
8. **Decisions:**
   - D32 (daily motivation) was **superseded** by D38.
   - D37 was **amended** on 2026-10-13: CNF/USDA values are back as gap-fillers.
   - D6 (demo is synthetic) still stands, as do D25–D27, D33 and D39–D41.
9. **Form spec claims:**
   - The library entries carry **no `images` array**. 789 have `source_id`, and the commit `f00c92c7…` is recorded.
   - The How-to (ⓘ) existed **only in the picker**, not in the workout day or session view. Phase 4 added it there.
   - The muscle chips had no "glutes" group.
   - Phase 4 found 828 of 831 linked exercises with both photos (1,656 photos), not about 1,750.
10. **Bundle size:**
    - The docs said 200 kB gzip; it was 250.6 kB before this build.
    - After this build the main JS is **271.5 kB gzip**: Phase 4 added +0.6 kB, and Phase 3 (interview + food plan) about +18 kB.
11. **"What protein should I aim for?" duplicate:** that text isn't in the app code. The repeats came from the AI's own suggested questions (Phase 2).
12. **Docs:** SECURITY_AND_DATA_FLOW said "No analytics", which became stale after the first-party usage stats (D41). Updated in Phase 3.
13. **Branch and migrations:** migrations 0001–0005 are verified. `main` was not used.

---

## Phase 1: food database

- **Drop-in importer.** Run `npm run import:food-db <file>`, then the same with `--write`.
  - It validates with the app's schema, prints counts for tiers, needs_review and restaurants, and refuses restaurant mappings that point at hidden dishes.
  - With `--write` it installs the file, regenerates the food-plan shelf (`build-diet-shelf`) and runs the check script.
- **Visibility:** Tier 1 (complete and sourced) is visible and Tier 2 is hidden. `needs_review` dishes are **never shown, not even by name** (the review screen shows a count only).
- **Bicultural ranking:** every dish is tagged indian / western / neutral (from the file if it says so, otherwise inferred).
  - "Suggested now" and search keep both sides in the top 8 whenever relevant ones exist. The #1 result never moves, and nothing irrelevant is promoted.
  - Breakfast: paratha and chai alongside a Double-Double and a latte. Lunch: dal makhani and paneer alongside McChicken and a shawarma wrap. "chicken" and "egg" show both cuisines.
  - Chain items now suit lunch and dinner versus breakfast sensibly.
- **Check script:** all green, **12/12** (results in Phase 5).

## Phase 2: three fixes from the Oct 12 review

1. **Samosa:** the fallback now only offers a **related** loggable dish, meaning a shared word or very close spelling. Letter overlap like samosa / masala dosa no longer counts.
   - Hidden dishes are checked first. "Aloo samosa" is named as *still being verified* (no numbers).
   - A quarantined match (kadhi pakoda) suppresses suggestions entirely.
   - List foods that match ("Punjabi samosa") are pointed to under More foods.
   - "dosa" now says Plain dosa is being verified and offers Masala dosa (related).
   - Guarded by a check-script line and an e2e test.
2. **Duplicate sample question:** the coach's question, suggestion and observation chips are de-duplicated by text (ignoring case and punctuation).
3. **Demo data reset.** Confirmed: nothing in code resets demo data mid-session. The only resets are "Reset this demo", switching demo person, or the browser clearing site data. An e2e test proves a demo meal survives tabs, reloads, and leaving and re-entering the demo.
   - Proving real accounts persist exposed **two real-account bugs**, now fixed and tested:
     - A **new phone, or "Sign out and remove this phone's copy"**, went straight to onboarding **without restoring the backup**. It now restores first.
     - **A pull could overwrite a local save made at the same moment.** The check and the write were separate transactions, and the older content was then pushed back. In e2e this lost the AI-help consent chosen during onboarding.
     - They are now one transaction, and echoes of a version the phone already has are skipped.
   - The test backend now really returns backed-up data, which is how these were found.
- **Minor, not done:** "Sattu drink" still carries sattu powder values. Rename or split it in the next food file (data change, not code).

## Phase 3: AI interview (interview spec T1–T7 + the owner's body-problems request)

- **T1 Conversational interview.** The default for new members, after name / 18+ / units.
  - A scripted chat with their own named trainer: chips, one question at a time, and "A few more questions — about 2 min".
  - "Skip for now" on every question. **"Prefer a form?"** and **"Just set me up with a standard plan"** are always visible.
  - It resumes after a reload, never asks twice, and ends at the existing review + Generate.
  - **It makes no AI calls per question**, so there is no budget impact and it works offline and in the demo.
- **T2 Trucker path.** Choosing "I drive long-haul…" sets location *truck cab / rest stop*, bands + dumbbells, short sessions and few days.
  - Without gym access, the validator allows only bodyweight, dumbbell, kettlebell and band moves.
  - The plan says "Built for the cab — no gym needed."
- **Body problems (owner request).** Chips: lower back, knees, shoulders, neck, hips, wrists/ankles, plus "Anything hurting right now…?".
  - Code removes the risky moves for each area, including substitutions, and adds one **supportive** move per area to the shortest day that fits (e.g. bird dog, glute bridge, dead bug, band pull-apart).
  - The AI is told about it; code enforces it.
  - Drivers with back or knee trouble get sitting-recovery emphasis, plus plain food-plan notes (hydration, fibre on long drives, lighter body weight eases knees). Nothing is presented as treatment.
  - "I'm not a physio or doctor…" is always shown. Urgent words get the safety reply, and screening "has concerns" keeps the guidance path.
- **T3 Progressive profiling.** Essentials at signup: goal, days, minutes, gym / equipment, experience, lifestyle.
  - Kept as essentials for safety and your request: the existing CSEP screening and the pain chips.
  - Later, a gentle Today card asks one question a day for week 1, never as a notification, always skippable, then stops: veg / egg / non-veg (asked directly, never inferred), cuisine, weight / height, age / sex, timeline, sleep, direction.
- **T4 Photos.** The spec's honest copy is added (**pending your approval**, D43). Direction (lean / athletic / strong) is **picked by the person, never inferred from photos**. No comparisons, physique promises or body-fat numbers.
- **T5.** Diet, sleep and pain are covered above. The timeline reality check is shown once (e.g. more than 1 kg a week).
- **T6 Weekly adaptation.** One proposal a week from logged data:
  - a 2-day "busy week" version;
  - one more pressing set when recovering well;
  - a protein-breakfast swap.
  - Each offers **Accept / Edit / Not now**. Accept creates a new plan version (old sessions keep theirs). Nothing changes without approval.
- **T7 Food plan.**
  - **Maths in code:** Mifflin-St Jeor, an honest activity factor (long-haul 1.2), and the plain explainer.
  - **Safety floors:** deficit at most 750 kcal, at least 1500 kcal for men and 1200 for women, about 1 kg a week at most.
  - The day is composed **only from public database dishes**, usual meals first.
  - A new `diet_draft` AI op returns ids and servings only. Every id is checked and totals are recomputed from database numbers; there is one retry, then the app's own composition is used.
  - Preview → Accept / Edit / Regenerate. Drivers get an **"On the road"** section: dhaba choices, portable protein, gas-station traps.
- **Migration `20261013000006_growth2.sql`:**
  - `diet_draft` is an allowed op, counted under the **existing** chat allowance (no new quota).
  - `plan_drafts.kind` is 'training' or 'diet', and `store_plan_draft` takes `p_kind`.
  - A comment documents the new profile JSON fields.
- **Validator fix found on the way:** a plan day with no exercises is now rejected.
- **Decisions:** D42 (interview, essentials, trucker, pain rules), D43 (photo honesty), D44 (food-plan maths and composition, `diet_draft` accounting, weekly adaptation).

## Phase 4: exercise form demos (form spec T1–T6)

- **T1 Photos vendored at build time.** 1,656 photos (828 exercises, 94 MB) come from free-exercise-db at the pinned commit `f00c92c`.
  - They are cached in `.cache/` (gitignored) and copied to `dist/exercise-img/` with a manifest.
  - **Never hotlinked:** the CSP is unchanged, and they are not in the JS or the precache list.
  - The build never fails if the download is blocked. `SKIP_EXERCISE_IMAGES=1` skips it.
- **T2 Form button** next to every exercise: active workout, plan list, plan editor, picker. It opens the How-to sheet in place.
- **T3 Animation.** Start / end photos crossfade on a 1.6 s CSS loop, shown side by side with reduced motion. Steps, muscles, equipment and level are kept. **No GIFs, no AI-generated demos, no YouTube.**
- **T4 Fallbacks.**
  - Exercises without photos say "No photo demo for this one yet — steps below." That covers the 34 written for TrainLuma, your own customs, and 3 dataset entries whose photos 404.
  - A failed photo hides the demo and keeps the steps.
- **T5 Offline.** Viewed photos are cached by the service worker in a separate cache that survives updates, capped at 200.
- **T6 Muscle-map cards.** 7 SVG cards (glutes via primary muscles) set the same filter as the chips.
- **Decision:** D45.

---

## Phase 5: verification (run 2026-10-15 on the merged branch)

| Check | Result |
|---|---|
| `npm run check`: typecheck, lint, unit tests, food-db check, build (with photo vendoring), secret scan | **PASS**: 340 unit tests (2 skipped generators); secret scan over 369 files + history + dist |
| `npm run check:food-db` (details below) | **PASS 12/12** |
| `npm run test:db`: 6 migrations applied in order on a throwaway Postgres | **PASS 104/104** |
| `npm run smoke:ai`: real `ai` function in Deno vs. mock database and model | **PASS 22/22** (4 new `diet_draft` checks) |
| `npm run smoke:notify` | **PASS 13/13** |
| `deno check` on the `ai` and `notify` functions | **PASS** |
| Playwright (demo + auth harness, Pixel 7) | **PASS 72/72** |

The 72 Playwright tests include:
- **Interview:** full interview → draft → accept; the skip-everything path; the timeline check shown once.
- **Trucker:** the trucker path with the equipment filter respected.
- **Pain:** an excluded move absent and a supportive move present.
- **Food plan:** totals match targets and every item is a real database id; a veg choice yields no non-veg ids.
- **Weekly adaptation:** accept / edit / dismiss.
- **Form demos:** the session-view demo animates; imageless fallback; reduced motion; offline after viewing; muscle card filter.
- **Phase 2 fixes:** samosa; demo persistence; account persistence after removing the phone's copy.

The flaky onboarding-consent failure that appeared on the Phase 4 copy was the Phase 2 sync race; it is fixed on this branch.

**Food-database check script, per check:**

| Check | Result |
|---|---|
| (a) JSON parses and matches the schema | PASS · 130 dishes, 25 restaurants |
| (b) every Tier-1 dish has complete macros + source | PASS · 72 / 72 |
| (c) no Tier-2 or quarantined item reachable in search, closest-match, pending-match or restaurants | PASS · 58 hidden, 232+ probes |
| (d) every restaurant mapping points at a Tier-1 dish | PASS · 28 mappings |
| serving maths | PASS |
| combos | PASS |
| restaurant typical-values label | PASS · 28 cards |
| QA searches rank the right dish first | PASS |
| kadhi pakoda never in search | PASS |
| reference values only fill gaps | PASS · 42 hidden / 128 CNF-USDA / 123 not set |
| no-results fallback never suggests an unrelated dish | PASS · samosa, dosa, kadhi pakoda, momos, dal tadka |
| bicultural ranking | PASS |

### Deploy: `supabase link` is not available here, so nothing was deployed

The Supabase CLI isn't installed in this container and no project is linked (no `supabase/.temp/project-ref`). Run these on your computer, in this order:

```bash
git fetch origin && git checkout claude/one-shot-build
npm install
npx supabase login                          # once
npx supabase link --project-ref <YOUR_PROJECT_REF>
npx supabase db push                        # applies 20261013000005_growth.sql (if not yet) and 20261013000006_growth2.sql
npx supabase functions deploy ai            # needed for food-plan drafts (diet_draft) and the interview context
npx supabase functions deploy notify        # needed after migration 0005 (notifications v2), harmless otherwise
```

Then:
- Run the housekeeping block at the top of `supabase/admin/growth.sql` once, if you haven't since migration 0005.
- Deploy the branch on Netlify, or merge it.

The Netlify build downloads the 94 MB of form photos (about 15 s) unless they're cached. Set `SKIP_EXERCISE_IMAGES=1` to skip them; the app then shows the steps-only fallback.

Details are in `docs/OWNER_GUIDE.md` §2g and §2h.

---

## Not verified here, simplified, or waiting on you

- **The 229-dish food file.** Not provided, so not imported. When you have it:

  ```
  npm run import:food-db <path> --write
  npm run check
  ```

  Update unit tests that pin "72 public", then redeploy `ai`.
- **Not run against live services:** Supabase, Gemini, real push, real phones (camera, speech, share sheets) and Netlify's build with photo download.
- **Photo wording (D43)** needs your approval.
- **Food plans with 72 public dishes:** vegetarians often can't reach high protein targets from the database alone. The screen says so plainly and names foods that would help, without inventing numbers. The 229-dish file should largely fix this.
- **Food-plan editor:** you can change servings and remove dishes, but not add a new dish yet.
- **Demo:** today's food-plan and weekly-adaptation cards show for signed-in accounts only.
- **Coach system prompt unchanged** (hash unchanged). Trucker, pain and food instructions travel in the per-request message.
- **Bundle:** main JS grew to 271.5 kB gzip, mostly the interview and food-plan screens. Splitting them into lazy chunks is a cheap follow-up.
- **Morning readiness note (Bevel idea):** spec drafted in `docs/spec/READINESS_NOTE_SPEC_DRAFT.md`, to build **after** the friends test as you suggested. Not built.
- **Sattu drink:** carries sattu powder values. Rename or split it in the next food file.
