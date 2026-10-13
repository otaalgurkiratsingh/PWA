# TrainLuma build report: food database, frictionless logging, retention and referral

**Brief:** `docs/spec/TRAINLUMA_FOOD_DB_BUILD_BRIEF.md` (§5–§15, tasks T1–T24) with `indian_dishes.json` (130 dishes, 25 restaurants).
**Branch:** `claude/meal-workout-journal-phase-0-pepxc3` · **Date:** 2026-10-13
**Commits:** `90bb8d5` Phase 1 · `d166c3b` Phase 2 · Phase 3 (retention + referral, this push; backend and Insights were built in parallel and merged in `bbcb639`/`2fc781e`).
**Live credentials used:** none. Nothing was published, billed or sent to anyone, and nobody was invited.

The hard rules held throughout:
- **Nutrition numbers:** every dish number comes from `indian_dishes.json`. A missing number shows the fallback (closest match, quick-add, or "Request this food"), never a guess. *Update 2026-10-13 (your call):* Canadian Nutrient File / USDA values are back on, but only for list foods the database doesn't cover (see §3.3).
- **Tier gating:** Tier 2 and needs-review dishes stay hidden, and kadhi pakoda never appears.
- **Restaurant label:** every restaurant card says "Typical values — this restaurant's recipe will differ."
- **Bans:** none of the dark patterns banned in §14 or the referral abuses banned in §15 were built.
- **Tone:** copy is warm everywhere, with no guilt and no red.

---

## 1. What was built

### Phase 1: data foundation (T1–T9, T22 cards)

| Task | What it does now |
|---|---|
| **T1 Seed** | The JSON is bundled as `supabase/functions/_shared/data/indian-dishes-v1.json` and loaded only when Food opens. Nothing is written into anyone's journal, so the import is idempotent and existing logs are untouched. Old "usual meals" named boiled eggs / chai / roti / rice link to `asc056` / `asc001` / `asc096` / `asc113` for search de-duplication (`LEGACY_DISH_MAP`). Their saved values are not rewritten. |
| **T2 Tier gating** | A dish is public only when it is Tier 1, not `needs_review`, has complete per-serving macros (and per-100 g when present) and has a source. Result: **72 public, 58 hidden**, with kadhi pakoda quarantined. Settings → Data sources → "Dishes still being verified" lists the hidden ones by name only, with no numbers. |
| **T3 Search** | Ranked search over names and aliases: exact alias, then name, then prefix, then all words, then partial. It is boosted by your own use, by time of day and by Punjabi spellings ("rajmah", "saag", "parantha", "makki"). A veg-only filter is included. "My" badges mark your own meals and recipes. An empty search never dead-ends (T14). |
| **T4 Serving selector** | Multipliers 0.5×/1×/2×/3× plus custom grams. Macros scale `per_100g × grams/100`. Brand items with no grams use servings only. |
| **T5 Dish detail** | Per-serving macros are shown big, with a small per-100 g toggle and the one-line source. |
| **T6 Recipe engine (§6)** | "Make it mine" clones a dish into an editable recipe: change ingredient grams, add or remove ingredients, set the servings. It shows the per-serving result and a delta line ("−42 kcal, +6 g protein vs the standard"). Ingredients come only from public database dishes or values you type yourself. The QA case (paneer 100 g + roti 40 g) is a unit test. |
| **T7 Combos** | Rajma chawal and saag + makki log every component in one tap. The components are stored, so you can still edit them. |
| **T8 Attribution** | The data-sources footer now includes the ICMR-NIN / mealPlan.fit and INDB line. |
| **T9 Analytics** | First-party events go to the owner's own Supabase (`log_events`). Events include `food_logged` (with method and `zero_typing`), `dish_searched`, `dish_searched_no_result` (with the text), `recipe_created`, `combo_logged` and app opens (for D1/D7/D30). There is no SDK. The owner views are in `supabase/admin/growth.sql`. |
| **T22 Restaurant cards** | 25 restaurants and brand cards have 1-tap signature dishes. Every card carries the typical-values label. Each mapping is checked to point at a public Tier-1 dish. |
| **Check script** | `npm run check:food-db`, which runs inside `npm run check`. Results are in §2. |

### Phase 2: frictionless logging (T10–T16, T24)

| Task | What it does now |
|---|---|
| **T10 Usuals** | A meal becomes a "usual" after 3+ logs in 30 days. The top 6 are ranked by frequency and shown on the Food tab and on Today. Combos and restaurant items count. |
| **T11 Time-aware** | Search and the "Suggested now" row are re-ranked by clock: 6–10 breakfast, 12–2 lunch (plus restaurant lunch), 7–10 dinner, late night snacks. There is no setting for this. |
| **T12 Same as last time** | If the same meal was logged in the same slot 4 days in a row, then around the usual time (−60 to +90 min) Today and Food show "Your usual {meal}? [Log it]". It disappears once that slot is logged or you dismiss it. Any past meal can be repeated with a tap on it, then "Add again today", alongside "Repeat the day before". |
| **T13 Templates** | Save any slot's meals as a template ("My typical breakfast"), including restaurant items, then log it all in one tap. |
| **T14 Never a dead end** | An empty search offers, in order: the closest database match ("No 'dal tadka', log as Moong dal instead?"), quick-add calories, "Create your own recipe" and "Request this food". It says "A close guess beats a skipped meal." |
| **T15 Voice** | On-device Web Speech (`processLocally`) is used when the browser has it. If only cloud speech exists, it asks before using it. Typing always works. "I had rajma chawal and two rotis" is matched to your meals first, then to database aliases, and shown on a confirm screen. Unmatched phrases stay unmatched for you to fix; nothing is invented. |
| **T16 Barcode** | Open Food Facts lookup. Only the number is sent; label values are used as printed. |
| **T24 Request this food** | Every empty search has the button. It records the search text (`request_food`, max 50/day) and tells you "You're #N asking for this". |
| **Zero-typing %** | Every `food_logged` event records how the log was made; only `search` and `quick_add` count as typed. The owner view is `private.v_zero_typing_daily`. |
| **Notification deep link** | `#/quicklog/{meal}/{slot}` opens a one-tap confirm, used by the routine nudge. |

### Phase 3: retention and referral (T17–T23)

| Task | What it does now |
|---|---|
| **T17 Gentle streaks** | A logging streak and a workout-week streak sit on Today's "How you're doing" card. **One automatic freeze per week** covers a missed day ("❄️ freeze used"). A broken streak says "Life happens. Start a new one today 💪", never in red. |
| **Milestones** | At 7, 30 and 100 days a celebration sheet opens **once** per milestone. It has a shareable story card (PNG via the system share sheet, only on a tap). |
| **T18 Luma Insights** | A Today card ("Luma found something in your week 👀") opens a story-style weekly recap: consistency %, workouts and sets, PRs, protein trend (unknown values are never counted as 0) and one true "surprise". If nothing true can be said, nothing is said. It goes back 8 weeks and exports as a 1080×1920 Instagram-Story card. |
| **T19 Smart notifications** | Exactly three kinds: (1) routine nudge "Your usual {meal}?" with a **Log it** action; (2) a gym reminder at **your learned gym time** (median start on that weekday, 8 weeks, 2+ sessions), or a fixed time if you choose; (3) milestone or weekly insight ready. **Max 2 a day, quiet 10pm–7am** (in your time zone), skipped if you already trained, and **any kind dismissed 3 times stops forever**. The service worker records dismissals and the app sends them. Hide-details sends only a neutral fixed-time gym line. The daily motivation message is retired. |
| **T20 Circles** | Private circles of 3–6 people that you join by code, up to 5 circles each. The week board starts at 3 members. It celebrates the **most consistent** person; everyone else is listed **alphabetically** with their own 7 dots, with no ranks and no last place. Members see only active-day counts and shared wins, never food, weight or plans. After a workout with a new best, a "Share with {circle}" button appears; it never posts by itself, and you can turn the offer off per circle. Leaving takes your posts with you, and posts expire after 30 days. |
| **T21 Year in Training** | Progress → "Your year in training" gives an annual recap from your own records, with a story card. |
| **T23 Referral** | "Give a month, get a month" lives in Settings → Invite friends. You get a code like `GU-4821` with a copy button. The pre-written message is the brief's text and you can edit it; it goes out only through the share sheet on a tap. The friend redeems once per person and per device, never their own code. They get the brief's message, "Your friend gave you Plus free for your first 2 months". Your month is pending until they log on 7 days within 30; the app checks once a day and releases it exactly once on the server. An invite link opened before sign-in is remembered and offered on Today. The invite prompt appears only after a 7+ day streak, at most once a week, and never again after two "Not now"s. |
| **Analytics** | Events: `insight_opened`, `story_shared`, `milestone_shown`, `workout_finished`, `circle_created`/`joined`/`post`, `invite_sent`, `invite_code_redeemed`, `referral_activated`, `invite_prompt_shown` and `notification_opened`/`dismissed`. The owner views cover retention, insight opens and the referral funnel. |
| **Backend** | Migration `20261013000005_growth.sql` holds the analytics, food requests, circles, the referral ledger (`plus_credits`), notification dismissals and the notifications v2 decision RPCs. It is all security-definer and members-only, with owner-only RLS. The `notify` function was rewritten for v2. |

---

## 2. Verification results

**Food-database check script (`npm run check:food-db`): 10/10 PASS**

| Check | Result |
|---|---|
| (a) JSON parses and matches the schema | **PASS** · 130 dishes, 25 restaurants |
| (b) every Tier-1 dish has complete macros + source | **PASS** · 72 Tier-1 complete; 72 public |
| (c) no Tier-2 or quarantined item reachable in search | **PASS** · 58 hidden incl. kadhi pakoda; 232+ search probes (names, aliases, prefixes) |
| (d) every restaurant mapping points at a Tier-1 dish | **PASS** · 28 mappings |
| serving maths `per_100g × g/100 = per_serving` (±0.15) | **PASS** |
| combos: components public, totals match (±1%) | **PASS** |
| every restaurant card carries the typical-values label | **PASS** · 28 cards |
| QA searches rank the right dish first (rajma, rajmah, sarson, makki, roti, paneer, parantha, rajma chawal, double double) | **PASS** |
| kadhi pakoda not in search | **PASS** |
| reference values only fill gaps (no food shows two sources) | **PASS** · 42 list foods covered by the database are hidden; 128 others use CNF/USDA; 123 stay "not set" |

**Other checks (all run on 2026-10-13 in the build container)**

| Check | Result |
|---|---|
| `npm run check` (typecheck, lint, unit tests, food-db check, build, secret scan) | **PASS** · 263 unit tests (2 skipped generators) · secret scan over 323 files + git history + dist |
| `npm run test:db`: 5 migrations on a throwaway Postgres; RLS, circles caps, referral rules (self, device, once, 7-day release exactly once), notifications v2 claims, quiet hours, 2/day, 3 dismissals | **PASS** · 97/97 |
| `npm run smoke:notify`: the real `notify` function in Deno against a mock database and push service; the harness decrypts what was sent | **PASS** · 13/13 (routine nudge with Log it, weekly insight, hidden details reads no records, quiet hours send nothing, logs carry no names) |
| `deno check` on the `notify` and `ai` functions | **PASS** |
| Playwright e2e (demo + auth harness, Pixel 7 viewport) | **PASS** · 55/55 (see note) |

The new Phase 3 e2e tests cover these flows:
- **Insights and year recap:** the streak badge, the Insights recap with week switching and the `insight_opened` event, and the year recap.
- **Notifications panel (v2):** only three kinds; the learned or fixed gym time; the quiet-hours note; the hide-details limit; saved to your own row.
- **Dismissals:** three dismissals stop that kind, and the queue is sent exactly once.
- **Circles:** join by link; the kind board (top person plus alphabetical, no ranks); the editable invite sent only on a tap; posts; the board waiting for 3 members; leave.
- **Referral:** the remembered invite link; your own code refused; the friend's code accepted once with a hashed device id; already-used; the editable share; the "no billing" note.
- **Demo:** the sample circle and invite page.

One real bug was found and fixed by these tests: reloading a circle invite link reopened the join sheet after you had already joined.

---

## 3. Skipped or simplified, and why

1. **T2 Tier-2 macro completion: not done.** The brief asks to fetch carbs, fat and fibre for 58 Tier-2 dishes from `mealplan.fit/nutrition/<slug>`. That site is not reachable from the build container, and the brief itself says the URL pattern must be verified per dish. Filling numbers without the source would break hard rule 1, so the 58 stay hidden behind the "verifying" state. To finish: fetch each page, verify it, set `tier: 1`, and rerun `npm run check:food-db`.
2. **T1 mapping of other usual meals:** only the four exact names with a public Tier-1 match are linked. Dahi (`curd-plain`) and chicken curry (`chicken-curry`) are Tier 2 and stay as the person's own foods until they are verified. Saved meals are never rewritten, so their history keeps its original values.
3. **CNF/USDA standard values: kept, as gap-fillers (you decided this on 2026-10-13).** The database comes first. Any list food the database covers (42) is hidden, so you never see two numbers for one food. The other list foods use their sourced CNF/USDA value (128), named on the food, or stay "not set" (123). The CNF ingredient list is back in recipes, next to "Build from the food database". The flag is `LEGACY_REFERENCE_VALUES = true` in `src/core/config/dataPolicy.ts`, and a new check-script line enforces the rule.
4. **Plus is a ledger, not a subscription.** No billing exists, so the "30-day trial + bonus month" and the inviter month are recorded and shown as "saved". Nothing is charged or applied, and "referral-to-paid conversion" can't be measured until billing exists.
5. **Repeat any meal** uses a tap on the past meal, then "Add again today", instead of a long-press. A long-press is undiscoverable and fails accessibility, and this reaches the same result.
6. **Invite prompt "earned moments"**: the prompt is shown after a 7+ day streak only. Showing it after the first weekly recap and after a PR was left out to keep it to one quiet card. The PR moment already has its own "share with your circle" button.
7. **Not verified on real devices or services:**
   - push delivery through Google/Apple, and lock-screen action buttons;
   - on-device speech on real phones (headless Chromium has no speech engine, so voice is tested with typed input and unit tests);
   - real Open Food Facts answers;
   - the live Supabase project;
   - real share sheets (stubbed in tests).
8. **The milestone celebration** is covered by unit tests (once per milestone; nothing without storage) rather than e2e, because the demo data doesn't land exactly on a 7-day streak on every date.
9. **Device check for referrals** is a random id kept on the phone and sent only as a SHA-256 hash. Clearing site data or using another browser defeats it. It is a fairness check, not fingerprinting, by design. The 7-day activation gate is the real anti-abuse rule.

---

## 4. Owner decisions to review

1. ~~CNF/USDA values~~ **Decided:** kept on, filling only the foods the database doesn't cover.
2. **Tier-2 completion:** approve fetching the 58 Tier-2 dishes from mealPlan.fit (needs a machine that can reach it), and review the `needs_review` items yourself before they go live.
3. **Licences before commercial launch (§10):** INDB has no declared licence, and the values derive from ICMR-NIN's copyrighted IFCT. The attribution line is in, but written permission is still needed for paid use.
4. **Daily motivation notification retired.** Notifications v2 allows only the three kinds in the brief. The old daily note you asked for earlier no longer sends. The "How you're doing" card on Today still shows it in the app.
5. **Usage stats on by default** for signed-in members, with an opt-out in Settings ("Share usage stats with the owner"). Tell friends-beta testers about it, or make it opt-in.
6. **Voice and cloud speech:** when a phone has no on-device speech, the app asks before using the browser's cloud speech (Google/Apple). Alternatively, allow typing only.
7. **Hide details** means only a fixed-time gym reminder can be sent, because routine nudges and insights need their details. This is fine for privacy-first users; confirm it.
8. **Plus pricing and billing** must exist before referral months mean anything. Decide the trial length (the brief says 30 days) and how queued months apply.
9. **Deploy steps (in this order):**
   1. Apply migration `20261013000005_growth.sql`.
   2. **Redeploy `notify`**. The old version calls a removed function, so reminders pause until this is done.
   3. Run the housekeeping block in `supabase/admin/growth.sql` (expires posts after 30 days and events after 400 days).

   The details are in `docs/OWNER_GUIDE.md` §2g.
10. **Circle limits:** 6 members, 5 circles per person, 10 posts a day and 50 food requests a day. Adjust these if the friends beta needs it.
