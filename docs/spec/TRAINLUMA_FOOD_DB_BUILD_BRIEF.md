# TrainLuma Indian Food Database — Claude Code Build Brief

**For:** Claude Code, implementing in the TrainLuma repo (`trainluma.app`)
**Date:** 2026-10-12
**Author:** Rio (co-founder brief for GK)
**Accompanies:** `indian_dishes.json` (77 dishes, in this folder) + `build_food_db.py` (regenerates the JSON from source)

---

## 0. Mission

GK's complaint: *"My app is missing food calorie data — e.g. if I select rajma chawal, kadhi pakoda, or sarson ka saag with makki ki roti, there's nothing."*

**What to build:** Seed TrainLuma's food database with **77 Indian dishes with full nutrition data** (kcal, protein, carbs, fat, fiber — per serving AND per 100g), wired into search, serving selection, and logging. Users pick a dish → standard nutrition auto-fills. Users can ALSO build/optimize their own recipes from these ingredients (§6) — the app already has "Create meal — from a label or your own recipe"; this brief gives it a real nutrition engine.

**Definition of done:**
- [ ] All 50 Tier-1 dishes searchable and loggable with correct macros
- [ ] Serving selector works (label + grams + quantity multiplier)
- [ ] "Rajma chawal", "sarson da saag + makki di roti" loggable as 1-tap combos
- [ ] Custom recipe builder computes nutrition live from ingredients
- [ ] `needs_review` items (kadhi pakoda) are NOT user-visible until approved
- [ ] Existing user food logs are untouched by the seed migration
- [ ] Attribution strings added (§10)
- [ ] QA checklist (§11) passes

---

## 1. Data sources audited (all four links GK sent)

| # | Source | What it has | License | Verdict |
|---|--------|-------------|---------|---------|
| 1 | **INDB** — GitHub `lindsayjaacks/Indian-Nutrient-Databank-INDB-` (downloaded, `/tmp/*.xlsx`) | 1,014 Indian recipes; full macros + micros per 100g AND per serving; ingredient-level recipe tables | **No license file** (research project). Underlying data: ICMR-NIN IFCT 2017 (Indian govt), UK CoFID, USDA | ✅ USE — but see the frying-oil bug (§2) and licensing note (§10) |
| 2 | **mealPlan.fit** Indian Food Database | 869+ Indian foods from IFCT; per-100g kcal + protein on list pages; **full macros + micros + serving sizes on detail pages** at `https://mealplan.fit/nutrition/<slug>` | Free reference; factual nutrition data | ✅ USE for fried items (where INDB is broken) + Tier-2 completion |
| 3 | **Kaggle "Indian Food Nutritional Values Dataset (2025)"** | 250+ dishes, per 100g, derived from INDB, cleaned | **CC BY-SA 4.0** (cleanest license of the four) | ✅ BACKUP source — same data as INDB, but license is explicit. Prefer this citation if licensing is questioned |
| 4 | **Fitterfly** nutrition DB / API | 38,600 foods, 22,300 recipes, Klik photo-API | **Proprietary, paid** ("Contact Us" for all products) | ❌ NOT usable now. Revisit when revenue justifies a license; Klik photo API is the future answer to photo calorie estimation |

---

## 2. ⚠️ Critical data-quality finding: the frying-oil bug

**INDB counts 100% of frying oil as consumed.** Its per-serving (and per-100g) values for deep-fried foods are wildly inflated:

| Dish | INDB says (per serving) | Reality (IFCT) |
|------|------------------------|----------------|
| Poori | 921 kcal | ~133 kcal (35g @ 380/100g) |
| Bhatura | 1,155 kcal | ~220 kcal (70g @ 315/100g) |
| Mix veg pakora | 4,545 kcal ("plate") | ~270 kcal (100g @ 270/100g) |
| Samosa | 814 kcal | ~262 kcal (100g @ 262/100g) |
| Besan kadhi with pakodas | 2,367 kcal ("bowl") | under review — see below |
| Gulab jamun | 918 kcal | ~280 kcal (80g @ 350/100g) |
| Besan cheela | 1,142 kcal | ~144 kcal (80g @ 180/100g) |

**Rules (enforce in code and in all future data work):**
1. NEVER use INDB per-serving values for fried foods. Use per-100g × standard grams, with per-100g from IFCT for fried items.
2. `indian_dishes.json` already applies this: fried items are Tier 2 with IFCT kcal+protein.
3. **Kadhi pakoda is QUARANTINED** (`needs_review: true`, Tier 2). INDB claims 403 kcal/100g; home-style kadhi pakoda is ~150–200/100g. Do NOT ship it until verified against `mealplan.fit/nutrition/kadhi`. The JSON keeps the published value with the flag — surface it in an internal "pending verification" list, never in user search.
4. When in doubt, cross-check any dish against its mealplan.fit detail page before marking Tier 1.

---

## 3. The dataset

**Files in this folder:**
- `indian_dishes.json` — the database. **130 dishes: 72 Tier 1 (complete macros, ship-ready) + 58 Tier 2 (partial — hidden until complete).** v1.1 added 29 pantry staples (dry fruits, dairy, fruits, vegetables, flours) — the everyday items users log daily. **Plus `restaurants`: 25 famous GTA Indian restaurants (10 Mississauga, 9 Brampton, 6 Vaughan) with 28 honest dish-mappings to Tier-1 dishes as clearly-labeled typical values — zero publish verified nutrition (researched 2026-10-12).** **Plus 24 chain-restaurant items with official Canadian brand nutrition:** Tim Hortons ×5 (Double-Double M/L, chocolate timbit, Boston cream, apple fritter — Nutrition Guide Canadian Edition July 2026), McDonald's Canada ×6 (Big Mac, Quarter Pounder with Cheese, McChicken, 10pc McNuggets, medium fries, Egg McMuffin — official product pages/calculator), Pizza Pizza ×2 (pepperoni + cheese slice, 1/8 of 12" medium — official nutrition table), Osmow's ×2 (chicken shawarma wrap regular, chicken on the rocks regular — official calculator), KFC ×2 (Big Crunch, popcorn chicken small — W8 PDF), Popeyes ×1 (classic chicken sandwich — 2025 Nutrition Guide), Wendy's ×1 (Baconator — official menu), Starbucks ×1 (grande caffè latte 2% — product page), Mary Brown's ×2 (Big Mary, taters small — July 2026 nutritionals). A&W ×2 (Teen Burger, fries) are Tier 2 — A&W Canada publishes calories/fat/protein only, no carbs/fibre.
- `build_food_db.py` — regenerates the JSON from the downloaded INDB xlsx. Re-run after any source update.

**Schema (per dish):**
```json
{
  "id": "asc165",
  "name": "Rajma curry",
  "name_local": "Rajma",
  "category": "curries_veg",
  "aliases": ["rajma", "rajma curry"],
  "serving_label": "1 katori (150g)",
  "serving_g": 150,
  "per_100g": {"kcal": 143.7, "protein_g": 6.0, "carbs_g": 16.4, "fat_g": 5.8, "fiber_g": 5.8},
  "per_serving": {"kcal": 215.5, "protein_g": 9.0, "carbs_g": 24.6, "fat_g": 8.7, "fiber_g": 8.7},
  "components": null,
  "source": "INDB (Indian Nutrient Databank) — per-100g values; serving computed",
  "tier": 1,
  "needs_review": false
}
```
- `per_100g`: `null` macros for Tier 2 (carbs/fat/fiber to fetch); `components` set for combos.
- Serving standard: katori = 150g (curries/dals/sweets), rice plate = 300g, piece weights per item, glass = 250ml, chai cup = 120ml, tbsp = 15g.

**Coverage by category:** breads 13, dals 6, curries_veg 13, curries_nonveg 5, rice 7, sweets 7, beverages 6, breakfast 9, combos 2, snacks 5, dairy 4, pantry 12, fruits 5, vegetables 4. (+ Tier-2 pantry/fruit/veg staples added v1.1.)

**GK's three examples — solved:**
- Rajma chawal → combo `combo-rajma-chawal`: 1 katori rajma + 200g rice = **450 kcal, 14.2g protein**
- Sarson da saag + makki di roti → combo `combo-saag-makki`: 1 katori saag + 2 makki roti = **581 kcal, 10.4g protein**
- Kadhi pakoda → quarantined (`needs_review`), plain kadhi available as Tier 2

---

## 4. Gap analysis: the app today vs after this build

**Today (verified in the trainluma.app demo):** the food database has ~11 items (boiled eggs, chai, dal, roti, dahi, whey shake, chicken curry, rice, ghee on roti, paneer bhurji, sabzi) and **zero nutrition values attached** — logging is name-only. No serving-size system. Searching "rajma" returns nothing.

**After:** 77 dishes with full macros, Punjabi/Hindi aliases, standard servings, 1-tap combos, custom recipe nutrition. The single biggest data complaint is resolved.

---

## 5. Implementation tasks

**T1 — Seed the database.** Import `indian_dishes.json` into the app's food store. Must be idempotent (re-runnable) and must NOT touch existing user logs. Map the 11 existing "usual meals" to new entries where they exist: boiled eggs→`asc056`, chai→`asc001`, roti→`asc096`, rice→`asc113`, dahi→`curd-plain` (T2), chicken curry→`chicken-curry` (T2). Leave whey shake, paneer bhurji, sabzi, dal (generic), ghee-on-roti as user foods until Phase 2.

**T2 — Tier gating.** Tier 1: searchable immediately. Tier 2: hidden behind an internal "verifying" state. For each Tier-2 dish, fetch full macros from `https://mealplan.fit/nutrition/<slug>` (slug = dish id minus `-ifct` suffix; verify each URL — pattern may vary), fill `carbs_g/fat_g/fiber_g`, set `tier: 1`. `needs_review: true` items stay hidden until GK explicitly approves.

**T3 — Search UX.** Fuzzy search over `name` + `aliases` (aliases include romanized Punjabi/Hindi: "rajma", "sarson", "makki", "kadhi", "paneer", "parantha"). Rank: exact alias match → name match → partial. Show recent + most-frequent dishes first. Empty state for no-results must offer "Create your own recipe" (§6), and log a `dish_searched_no_result` analytics event (§8.17).

**T4 — Serving selector.** Show `serving_label`; allow quantity multiplier (0.5×, 1×, 2×, 3×) AND custom grams input. Macros scale linearly: `per_serving = per_100g × grams/100`.

**T5 — Dish detail.** Show per-serving macros big; per-100g toggle small; one-line source ("Nutrition: Indian Food Composition Tables (ICMR-NIN)").

**T6 — Custom recipe engine.** See §6.

**T7 — Combos.** `category: "combos"` dishes log all components in one tap (store component breakdown so edits stay possible).

**T8 — Attribution.** Extend the existing data-sources footer (currently: Canadian Nutrient File, USDA FoodData Central, Open Food Facts) with: "Indian dishes: Indian Food Composition Tables (ICMR-NIN, via mealPlan.fit) and the Indian Nutrient Databank (INDB) research project."

**T9 — Analytics for the friends test.** Events: `food_logged`, `dish_searched`, `dish_searched_no_result`, `recipe_created`, `combo_logged`. GK's 30-day validation decision depends on this — do not skip.

---

## 6. Custom recipe engine spec ("optimize your own recipe")

GK's requirement: users build their own version of a dish (e.g. "my rajma, less oil") and the app computes nutrition.

**Data model:**
```
user_recipe {
  id, name, servings_count,
  ingredients: [{ food_id (DB ref) | custom_name, grams }],
  computed_per_serving: { kcal, protein_g, carbs_g, fat_g, fiber_g },  // derived, never hand-entered
  created_from: food_id?   // if cloned from a DB dish ("make it mine")
}
```

**Computation:** `per_serving = Σ(ingredient.per_100g × grams/100) ÷ servings_count`. Recompute live on every edit.

**UI flow:** "Create meal" → "Start from a dish" (clone any DB dish into editable ingredients) OR "Start from scratch" (search DB for ingredients) → ingredient rows with gram steppers → servings stepper → **live nutrition preview** → save to "My recipes" (searchable with a "My" badge, editable, deletable).

**"Optimize" view:** when editing, show delta vs the original dish: e.g. "−120 kcal vs standard rajma (you halved the oil)". This is the feature that makes the engine special — implement the delta line, it's cheap.

**Storage:** local-first (matches app's privacy architecture); include in the JSON export format.

---

## 7. Search & UX requirements

- Aliases must include common spellings: "rajma/rajmah", "sarson/sarson da saag", "makki/makki di roti", "parantha/paratha", "dahi/curd", "paneer".
- Veg / non-veg filter toggle (categories `curries_veg` vs `curries_nonveg`; mark all Tier-1/2 items; sweets/breads default veg).
- Show kcal + protein in search rows (protein is what gym users scan for).
- Punjabi-first ordering for the GTA beta: when two dishes match, prefer the Punjabi staple.

---

## 8. Full blind-spot audit — everything the app still lacks

### A. Data blind spots
1. ✅ FIXED by this brief: zero nutrition values; only ~11 foods; no serving system.
2. **No barcode scanning** — MyFitnessPal/Cronometer have it free. Roadmap (Open Food Facts API is already cited in-app; wire it).
3. **No branded/packaged Indian foods** (Haldiram's, Amul, Mother Dairy) — mealPlan.fit lists many; Phase 2 import.
4. **No restaurant dishes** — Phase 3.
5. **Photo logging = "attach a picture" only** — no AI calorie estimation. This is THE competitive gap (Cal AI's whole product). Future option: Fitterfly Klik photo API (paid, §1.4). Do not build own model.
6. **Micronutrients collected but not surfaced** — INDB has full micros; surface iron/calcium/vitamin D later (matters for vegetarian Indian diets).
7. **Custom-recipe nutrition unverified** — the app has "Create meal" but demo never confirmed it computes nutrition. §6 spec resolves it.

### B. Product blind spots
8. **Web-only.** No native iOS/Android app; web push doesn't work reliably on iOS — but "reminders 15 min before workout" is a core feature. Native wrapper (Capacitor) or PWA push is needed before store launch.
9. **AI coach unverified.** Demo chat showed *sample replies*; the explainer promises a real coach behind sign-in. Verify the production coach is actually wired to journals before promising it anywhere.
10. **Local-only data + manual JSON export.** No cloud sync — lost phone = lost journal. Account sync required before public launch (Supabase/Firebase).
11. **Invite-only** — correct for the friends beta; must open for growth.
12. **No food-logging onboarding** — the "TrainLuma in 30 seconds" tutorial videos fill this gap.
13. **No meal planning / grocery list** (competitors have it) — roadmap.
14. **No wearable sync** (Apple Health / Health Connect) — steps are manual; roadmap.

### C. Tech & growth blind spots
15. **No analytics.** GK's 30-day friends-test decision ("are they still logging at day 30?") is impossible to measure without it. T9 is mandatory, not optional.
16. **No crash reporting.**
17. **No referral loop** ("invite a gym buddy" — the cheapest growth for this niche).
18. **No privacy policy / terms** — required before App Store / Play Store submission.
19. **No Punjabi/Hindi UI localization** — the wedge community (§9); roadmap, not v1.

---

## 9. Niche verdict: who to target

**GK asked: "just Indian community living in Canada, right?" — and then: "Punjabi or North Indian?" — Verdict below. This is a decision, not a menu.**

### ★ DECISION: Punjabi-first, North Indian welcome.

**Lead with Punjabi. Frame it as North Indian. Never as generic "Indian" or "Canadian."**

**Why Punjabi wins — 6 reasons:**
1. **You ARE Punjabi.** Gurkirat Singh from Punjab, living in Brampton ("Little Punjab"). Authenticity can't be copied — a Delhi startup can't out-Punjabi you.
2. **Your food examples are Punjabi.** Rajma chawal, kadhi pakoda, sarson da saag + makki di roti — the database wedge is already Punjabi-first, and v1 ships exactly that.
3. **Your test group is Punjabi.** The 5–6 friends, your gym circle, your uncle's network — the beta IS the niche.
4. **Punjabi is a stronger identity than "North Indian."** Language, music, food, culture — people rally around it. "North Indian" is a census category; "Punjabi" is a community. Marketing needs the community.
5. **The protein angle is custom-made for Punjabi food.** Dal, paneer, dahi, lassi, sattu, soya — the Punjabi kitchen already eats high-protein. Positioning: *"Your dadi's kitchen was already a gym diet — TrainLuma just counts it."* No other cuisine gives you this line.
6. **Brampton/Mississauga density.** The highest concentration of Punjabis outside Punjab is within 20 minutes of you. Flyers in gyms, gurdwara community boards, Punjabi fitness creators — all free distribution.

**"North Indian welcome"** means: the database already covers ~80% overlap dishes (dal, roti, paneer, rajma, biryani), UP/Delhi/Rajasthan users are never turned away, and expansion just widens the same DB. You market Punjabi, you serve North Indian.

**Positioning line (primary):** *"The fitness app that actually knows Punjabi food."*
**Backup line:** *"Saada khana, saadi ginti."* (Our food, our count — for Punjabi-language content.)

**What this changes in the build:** nothing in the data (already Punjabi-first) — it changes marketing only: Punjabi aliases in search (done), Punjabi creators for launch content, gurdwara/gym community distribution, Punjabi UI as a Phase-2 feature (§8.19).

**Target v1: Punjabi diaspora in the GTA.** Not "all Indians in Canada" (1.4M — too broad for day one), not "all Canadians" (unwinnable).

**Why — 5 reasons:**
1. His food examples are all Punjabi — the database wedge is Punjabi-first, and this brief ships exactly that.
2. **He IS the community** — his gym, his 5–6 friends, his uncle's network. Trust + distribution no ad budget can buy.
3. **MyFitnessPal is weakest on regional Indian dishes** — the gap is real and verified (their Indian entries are sparse/generic).
4. **Community word-of-mouth is the only free CAC that works** for a ~$10/month app. Paid ads would kill the unit economics.
5. **Gym culture is strong in this demographic** — the "bulking/cutting with dal-roti" problem is widely felt and rarely served.

**Positioning line:** *"The fitness app that actually knows Indian food."*

**Expansion ladder:** GTA Punjabi → South-Asian diaspora across Canada → India. Each step reuses the same DB, wider each time.

**What this means for the build:** Punjabi-first dish coverage (done — v1), Punjabi aliases in search (done), veg/non-veg filter (T3), Hindi/Punjabi UI later (§8.19). When logging analytics, tag the beta cohort so GK can see if the wedge is working.

---

## 10. Licensing & attribution (read before commercial launch)

- **INDB:** no license file in the repo (research project). Underlying data is ICMR-NIN IFCT 2017 (Indian government), UK CoFID, USDA. **Recommendation:** attribute it, and before the public store launch either (a) contact the repo owner for permission, or (b) switch citations to the **Kaggle mirror (CC BY-SA 4.0)** — same data, explicit license (requires attribution + share-alike), or (c) use IFCT-direct values. Do not ship commercially on an unlicensed research dataset without resolving this.
- **Explicit call (added 2026-10-12):** the cleanest legal path is (b) — cite *"Indian Nutrient Databank (INDB) via Kaggle, CC BY-SA 4.0"* in the app's data-sources screen. One line, zero emails, fully compliant. Default to this unless GK's lawyer says otherwise.
- **IFCT via mealPlan.fit:** nutrition facts are factual data; attribute as "Indian Food Composition Tables (ICMR-NIN)".
- **Fitterfly:** proprietary — not used; no action.
- Keep the app's existing attribution pattern (Canadian Nutrient File, USDA, Open Food Facts) and append the Indian sources (T8).

---

## 11. QA checklist

- [ ] Spot-check 5 Tier-1 dishes against their mealplan.fit detail pages (values within 10%)
- [ ] Search "rajma", "sarson", "makki", "kadhi", "roti", "paneer" → correct dishes rank first
- [ ] Serving math: `per_serving == per_100g × grams/100` (rounding ±0.1)
- [ ] `needs_review` dishes are NOT in user search; visible in internal verification list
- [ ] Tier-2 dishes hidden until macros completed
- [ ] Existing user food logs untouched after seed migration (snapshot before/after)
- [ ] Custom recipe: 100g paneer + 1 roti (40g) computes to the correct totals; delta line shows vs original
- [ ] Combos log all components; editing one component updates the combo
- [ ] DB works fully offline (no network calls for search/log)
- [ ] Attribution strings present in Settings → Data sources
- [ ] Analytics events fire (T9): log a food, search a missing dish, create a recipe

---

## 12. v1.1 additions — more data gaps, sources & product improvements (added 2026-10-12)

GK asked: *"Is there anything else that needs to be improved? Any data, any sources?"* — this section is the answer. Everything below is new since v1.0.

### 12a. Data gaps still open (beyond §8A)

1. **Pantry staples — PARTIALLY FIXED v1.1.** Added 29 Tier-2 items users log daily: almonds, walnuts, cashews, peanuts, makhana, sattu, besan, jaggery, papad, oats, soya chunks (52g protein/100g — vegetarian gold), low-fat paneer, Greek yogurt, hung curd, buttermilk, coconut water, banana, mango, guava, papaya, apple, potato, sweet potato, onion, tomato, atta, dalia, kurmura, brown rice. Full macros still to fetch (T2 rule).
2. **Street food — MISSING, high priority.** Vada pav, pav bhaji, golgappe/panipuri, bhel puri, dabeli, chole bhature (as combo). Young users WILL search these; "not found" on a cheat meal breaks trust. Source: mealPlan.fit detail pages; IFCT has chaat entries.
3. **Indo-Chinese — MISSING.** Hakka noodles, veg Manchurian, momos (steamed/fried). A staple for Indian youth; barely exists in Western databases = easy win.
4. **Supplements — MISSING.** Whey protein (1 scoop = 25g protein — THE most-logged item for gym users; use label data, it's standardized), creatine (0 kcal — loggable for streaks), mass gainer. The app has "whey shake" in usual meals with no data — embarrassing for a gym app. Fix: hardcode 1 scoop whey = 120 kcal / 24g protein (standard isolate/concentrate blend) with source "supplement label average".
5. **Amritsari fish fry + tandoori chicken** — Punjabi non-veg staples; INDB's tandoori serving is inflated (use IFCT-style per-100g).
6. **Paneer bhurji** — already in the app's usual meals, still no data. Priority Phase-2 fetch.
7. **Sarson da saag + white butter (makhan)** — Punjabis add a butter dollop; add a "with white butter" variant (+1 tbsp = +100 kcal) so the number stays honest.
8. **Festival foods** — Diwali (kaju katli, motichoor ladoo, barfi), Lohri (gajak, rewri — Punjabi!), Holi (gujiya, thandai). Seasonal logging prompts ("Lohri week: log the gajak without guilt") double as content marketing.
9. **Mango lassi, filter coffee, nimbu pani, jaljeera, sugarcane juice** — beverage gaps.
10. **Raita variants** — boondi raita, cucumber raita (INDB has some; promote).
11. **GTA Indian restaurant nutrition — RESEARCHED 2026-10-12, honest result: ZERO.** 25 famous restaurants catalogued (10 Mississauga, 9 Brampton, 6 Vaughan — full list in `indian_dishes.json` → `restaurants`). **Not one publishes any nutrition/macro data** — verified across restaurant websites, menu PDFs, DoorDash listings, and targeted searches. Ontario's menu-labelling law only covers chains with 20+ Ontario locations; the biggest Indian brand here (King Tandoori) has 6. There is nothing to license or scrape — this is a verified dead end, not an assumption.
    **The strategy instead (T22):** `dish_mappings` in the JSON point each restaurant's signature dishes at Tier-1 DB dishes as **typical values** — the app MUST label them *"Typical values — this restaurant's recipe will differ"* and never present them as restaurant-verified. Mappings only ever point at Tier 1 (never Tier 2, never quarantined items — kadhi pakora is deliberately NOT mapped). Dishes with no Tier-1 match sit in `unmapped_dishes` with the reason, which doubles as the Phase-2 fetch priority list (amritsari kulcha, chicken biryani, dal baati churma, stuffed parathas, tandoori platter items).
    **T22 — Restaurant logging UX:** searching a restaurant name shows its card (cuisine, address) + its signature dishes as 1-tap log buttons with the "typical values" label inline. This delivers the 1-tap restaurant experience GK wants without a single fabricated number. When a restaurant ever publishes real data, its entry flips `nutrition_published: true` and mappings get replaced by verified values.
12. **Chain-restaurant data — COMPLETE v1.2 (2026-10-12). 24 items, all official Canadian sources.** Tim Hortons ×5, McDonald's Canada ×6, Pizza Pizza ×2, Osmow's ×2 (shawarma wrap regular 565 kcal/26.8g protein; chicken on the rocks regular 857 kcal/39.6g protein), KFC ×2 (Big Crunch 620 kcal/25g protein; popcorn chicken small), Popeyes ×1 (classic chicken sandwich 730 kcal/34g protein), Wendy's ×1 (Baconator 920 kcal/58g protein), Starbucks ×1 (grande caffè latte 2%, 190 kcal/12g protein), Mary Brown's ×2 (Big Mary 598 kcal/33g protein; taters small 470 kcal). A&W ×2 (Teen Burger 500 kcal/27g protein; fries regular 340 kcal) are Tier 2 — A&W Canada does not publish carbs or fibre, so they stay hidden until completed; never substitute.
    **V1 CHAIN SET IS NOW FROZEN (GK's rule).** No more chains until 1,000 signups — then expansion by user recommendation via the T24 "Request this food" queue, most-requested first.
    **GK's expansion rule (2026-10-12): the v1 chain set is LOCKED.** After **1,000 signups**, new chains/dishes get added by user recommendation, most-requested first.
    **T24 — "Request this food" loop (build it in v1, it powers the rule above):** every empty-search dead end (T14) gets a *"Can't find it? Request it"* button. One tap logs the request as an analytics event with the search text. This builds a ranked, demand-driven queue — so post-1000 expansion is decided by real user votes, not guesses. Show the user their request was counted (*"Got it — we'll add it. You're #47 asking for this."* — social proof doubles as engagement).
11. **GTA Indian restaurant nutrition — RESEARCHED 2026-10-12, honest result: ZERO.** 25 famous restaurants catalogued (10 Mississauga, 9 Brampton, 6 Vaughan — full list in `indian_dishes.json` → `restaurants`). **Not one publishes any nutrition/macro data** — verified across restaurant websites, menu PDFs, DoorDash listings, and targeted searches. Ontario's menu-labelling law only covers chains with 20+ Ontario locations; the biggest Indian brand here (King Tandoori) has 6. There is nothing to license or scrape — this is a verified dead end, not an assumption.
    **The strategy instead (T22):** `dish_mappings` in the JSON point each restaurant's signature dishes at Tier-1 DB dishes as **typical values** — the app MUST label them *"Typical values — this restaurant's recipe will differ"* and never present them as restaurant-verified. Mappings only ever point at Tier 1 (never Tier 2, never quarantined items — kadhi pakora is deliberately NOT mapped). Dishes with no Tier-1 match sit in `unmapped_dishes` with the reason, which doubles as the Phase-2 fetch priority list (amritsari kulcha, chicken biryani, dal baati churma, stuffed parathas, tandoori platter items).
    **T22 — Restaurant logging UX:** searching a restaurant name shows its card (cuisine, address) + its signature dishes as 1-tap log buttons with the "typical values" label inline. This delivers the 1-tap restaurant experience GK wants without a single fabricated number. When a restaurant ever publishes real data, its entry flips `nutrition_published: true` and mappings get replaced by verified values.

### 12b. Extra sources worth mining (all free)

- **IFCT 2017 (ICMR-NIN) full tables** — the root source behind mealPlan.fit. If GK ever needs the primary citation, this is it: Longvah et al. 2017, National Institute of Nutrition, Hyderabad.
- **ICMR-NIN "Nutrient Requirements for Indians 2020"** — the RDA tables. The app shows macro targets; citing ICMR RDAs (instead of Western RDAs) makes targets credible for Indian users. One-time integration.
- **Open Food Facts** — already cited in-app; extend to Indian packaged foods (Parle, Haldiram's, Amul barcodes work).
- **TarlaDalal / Archana's Kitchen** — recipe sites with per-serving nutrition on many recipes. NOT for scraping (copyright) — for manual cross-checking of quarantined items like kadhi pakoda.

### 12c. Product improvements (beyond data)

1. **"Cheat meal" mode.** One-tap street-food logging with zero judgment copy ("Logged. Enjoyed? Good. Back to the plan tomorrow."). The app's gentle tone is perfect for this — MyFitnessPal shames; TrainLuma shouldn't.
2. **Protein meter.** For gym users, protein is THE number. Make it the hero metric on the Today tab (bigger than calories for this audience).
3. **Family table (roadmap).** In Indian households one person cooks. Let the cook log the family meal once; family members one-tap copy it. Nobody else has this — it's a genuine differentiator for the niche.
4. **Punjabi UI toggle (roadmap).** Full Gurmukhi/Punjabi interface option. Cheap to do later (string table), massive loyalty signal for the wedge.
5. **Festival prompts.** Seasonal nudges + pre-loaded festival foods (§12a.8). Content + data working together.

---

---

## 13. The 90% goal — zero-typing food logging (added 2026-10-12)

**GK's directive:** *"Make the food database so good that 80–90% of the time, people don't have to manually enter food."*

**Honest framing:** coverage alone won't reach 90%. This needs two halves — **(a) coverage** (106 dishes and growing; chain-restaurant + Indian-restaurant data being merged in) and **(b) friction mechanisms** below. Build both.

### Friction mechanisms (new tasks T10–T16)

**T10 — One-tap "usuals", auto-ranked.** The app has "Your usual meals" — extend it: auto-rank by frequency over the last 30 days, show the top 6 directly on the Food tab with no search. Rule: a dish becomes a "usual" after 3 logs. Usuals must include combos and restaurant items, not just home food.

**T11 — Time-aware suggestions.** 6–10am → breakfast items first; 12–2pm → lunch items (dals, rice, curries) + restaurant lunch items; 7–10pm → dinner items; late night → snacks. No configuration — just re-rank search and suggestions by clock time. Removes scrolling for routine eaters.

**T12 — "Same as last time" nudges.** Detect routines: if the user logs "Double-Double (Medium)" 4 mornings in a row, day 5 shows a morning nudge: *"Your usual double-double? [Log it]"*. Extend the existing "Repeat the day before" to **"repeat any meal from any day"** (long-press a past meal → repeat it today).

**T13 — Meal templates.** "My typical breakfast / lunch / dinner": user saves a multi-item meal once (e.g. 2 roti + 1 katori dal + sabzi), then logs the whole thing in one tap forever. For routine eaters this alone covers ~40% of all logs. Templates must support restaurant items too ("my Tim's run": double-double + wrap).

**T14 — Closest-match fallback (never a dead end).** When search finds nothing, do NOT show an empty state. Offer, in order: (1) closest DB match — *"No 'dal tadka' — log as 'Moong dal' instead?"*; (2) **Quick-add calories** — just a number, 10 seconds, no dish needed; (3) "Create your own recipe" (§6). UI copy must say: *"A close guess beats a skipped meal."* A logged approximation is always better than a skipped log.

**T15 — Voice logging (AI).** *"I had rajma chawal and two rotis"* → speech-to-text → dish + serving parser (match against `aliases`) → confirm screen → logged. GK wants AI used at most — after the coach, this is the highest-leverage AI feature in the app. Use on-device speech recognition; keep a text fallback.

**T16 — Barcode scanning (packaged foods).** Open Food Facts API (already cited in the app's data sources). Covers protein bars, milk cartons, bread, ghee packets — the packaged 10%.

### Coverage math — why this hits 90%

| Path | Share of logs |
|------|---------------|
| Meal templates + auto-usuals (routine home food) | ~50% |
| Chain/restaurant 1-tap items (Tim's, McDonald's, local spots) | ~20% |
| Time-aware recents + "same as last time" | ~10% |
| Voice / quick-add / closest-match fallback | ~10% |
| True manual entry (new dish, first time) | ~10% |

**Metric (add to T9 analytics):** `% of food logs created with zero typing` — target **80% by end of the friends beta**. If it misses, the fix is more templates/usuals tuning, not more dishes.

### What "lowering friction" must never break

- Speed over precision: a 1-tap approximate log beats a 2-minute perfect log. Never add a required field to the quick path.
- The gentle tone: no red warnings, no "you skipped lunch" shaming. The app's kindness IS the retention strategy.
- Privacy: voice processing on-device where possible; templates and usuals stay local like everything else.

---

## 14. Retention engineering — the ethical engagement playbook (added 2026-10-12)

**GK's directive:** make the app as engaging as social media algorithms — users keep coming back daily.

**Constraint the builder must understand (this is the product's soul):** use the *psychology*, never the *dark patterns*. TrainLuma's moat is the kind, gentle coach. Streak anxiety, red-badge spam, guilt notifications, infinite scroll, and shame would destroy the brand in a week. The model is **Duolingo, not TikTok**: compulsive return through warmth, progress, and identity — never through anxiety. Anxious users churn; encouraged users stay.

### The Hook Model (Nir Eyal) mapped to TrainLuma

Trigger → Action → Variable Reward → Investment, built from features already in this brief:

**T17 — Gentle streaks (Snapchat's streak, without the anxiety).**
- Logging streak + workout streak, displayed warmly.
- **Streak freeze** (Duolingo's best retention idea): 1 freeze per week, applied automatically — a missed day never breaks the streak, it just spends the freeze. No shame copy, ever. A broken streak says *"Life happens. Start a new one today 💪"* — never red, never scolding.
- Milestone celebrations at 7 / 30 / 100 days as shareable cards (→ free marketing).

**T18 — Variable rewards: "Luma Insights" (the slot machine, made kind).**
- The For-You-Page equivalent: a weekly **"Your Week" story-style recap**, auto-generated from the user's journal — PRs hit, consistency %, protein trend, plus one surprise Luma noticed (*"Your squat is up 10 kg in 6 weeks"*).
- Unpredictable delight: insights appear when *earned*, not on a fixed schedule — the user opens the app to **discover** what Luma noticed about them. That "what will it say?" pull is the variable-reward loop, ethical version.
- Every recap exports as an Instagram-Story-format card → organic marketing loop.

**T19 — Smart notifications (Instagram's pull, without the spam).**
- Only 3 notification types, all personal and earned: (1) routine nudge — *"Your usual double-double?"* (T12); (2) workout reminder at **their** usual gym time (learned from logs, never a generic blast); (3) milestone/insight ready — *"Luma found something in your week 👀"*.
- Hard rules: max 2 per day, quiet hours 10pm–7am, every notification actionable in 1 tap, and any notification dismissed 3× **stops forever**. Banned copy: "we miss you", "don't lose your progress", anything guilt-based.

**T20 — Social accountability (likes/comments, without the pressure).**
- The 30-day friends test IS the seed: small **private circles** (3–6 friends), weekly consistency leaderboard with kind framing (*"most consistent"* — never a last-place callout), PR celebrations shared to the circle.
- No public follower counts, no public profiles, no comparison with strangers — private-by-default, consistent with the privacy brand (§10).

**T21 — Identity & investment (the IKEA effect).**
- Templates, usuals, custom recipes, streak history: the more the user builds, the more the app becomes *theirs*. Switching cost through love, not lock-in.
- Annual **"Your Year in Training"** recap — an identity artifact: *"I am someone who trains."* Identity is the strongest retention force in fitness.

### Banned — dark patterns we will NOT build

- Infinite scroll anywhere in the app.
- Red badge counts engineered to create anxiety.
- "We miss you!" / guilt / loss-framed notifications.
- Fake urgency or countdown pressure.
- Shame on missed days — every return is *"welcome back"*, never *"where were you?"*.
- Engagement-bait: no content designed to provoke comparison anxiety or outrage.

**Metric (add to T9 analytics):** D1 / D7 / D30 retention + `weekly_insight_open_rate`. Target: **D30 ≥ 40%** in the friends beta (top quartile for health & fitness apps is ~30–40%).

---

## 15. Referral system — "Give a month, get a month" (added 2026-10-12)

**GK's directive:** two-sided invite-code referrals — both the inviter and the friend get rewarded (the pattern he likes from apps like Muse's launch referral).

**Why it fits TrainLuma:** the 30-day friends test IS a referral seed; private circles (T20) are the social surface; and the Punjabi community runs on word-of-mouth — "my cousin uses it" beats any ad. Referral is the growth loop. Paid ads come later, if ever.

**T23 — Referral spec:**

- **Reward: 1 free month of TrainLuma Plus for BOTH sides.** No cash, no points — subscription credit only. (Cash rewards = fraud nightmare + tax complexity. Credit = one database field.)
- **Invitee:** signs up with a friend's code → standard 30-day Plus trial + one bonus free month queued after the trial ends. Signup message: *"Your friend gave you Plus free for your first 2 months."*
- **Inviter:** the free month releases only when the invitee reaches **7 logged days** within 30 days. This is the anti-spam gate — it rewards real activation, not code-farming signups.
- **Code format:** memorable, e.g. `GK-4821` (letters + digits). Lives in Profile → "Invite friends", with copy button.
- **Share UX:** native share sheet with a pre-written, **user-editable** message, kind framing: *"I'm using TrainLuma to track my food and training — here's a free month of Plus if you want in."* Nothing ever auto-sends; the user taps send. (Same ethos as GK's standing rule: nothing goes out under his name without his tick — extend it to the user's name too.)
- **Smart prompts, not spam:** surface the invite card at *earned* moments — after a 7-day streak, after the first "Your Week" recap, after a PR. Max 1 prompt/week; dismissed twice = never shown again.
- **Anti-abuse:** one invitee credit per device; no self-referral (code owner ≠ redeemer, device check); inviter credit gated on the 7-day activation rule.
- **Analytics (extends T9):** `invite_sent`, `invite_code_redeemed`, `referral_activated` (7-day gate passed), referral-to-paid conversion rate.

**Banned:** cash payouts, inviter leaderboards, auto-DMing the user's contacts, pre-checked "invite all" — anything that makes it feel like a scheme instead of a gift. The brand is kindness; the referral must feel like generosity, not growth-hacking.

**Launch note:** the friends beta is the referral engine's first run — give each of the 5–6 testers their code on day 1 and watch `referral_activated` as a leading indicator of word-of-mouth fit.

---

## Appendix A — Phase-2 fetch list (dishes users will ask for; not in v1)

Fetch full macros from `https://mealplan.fit/nutrition/<slug>` (verify each URL): dal tadka, dal fry, missi roti, jeera rice, chicken biryani, aloo tikki, paneer bhurji, tandoori chicken, mutton curry, mix-veg sabzi, Amritsari fish fry, vada pav, pav bhaji, golgappe/panipuri, bhel puri, dabeli, chole bhature (as combo), veg Manchurian, hakka noodles, momos, filter coffee, mango lassi, nimbu pani, kaju katli, motichoor ladoo, barfi, rasgulla, gujiya, thandai, gajak, rewri, boondi raita, paneer tikka, chilli paneer, uttapam, medu vada, whey protein 1 scoop (use label data: 120 kcal / 24g protein).

## Appendix B — Regenerating the JSON

```bash
# 1. Download INDB xlsx files:
curl -sL -o INDB.xlsx https://raw.githubusercontent.com/lindsayjaacks/Indian-Nutrient-Databank-INDB-/main/INDB.xlsx
# 2. Edit the TIER1/TIER2 pick lists in build_food_db.py, then:
python3 build_food_db.py   # writes indian_dishes.json
```
`needs_review` rule: any dish whose INDB per-serving kcal exceeds 1,500 for a single serving, or whose per-100g fat exceeds 40g for a non-fried dish, gets quarantined automatically — extend the check in the script, don't eyeball it.
