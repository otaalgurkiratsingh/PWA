# CLAUDE_CODE_FOOD_AND_AI_ONBOARDING_UPDATE_V2.md
# AapnaFit — preserve the approved UI, fix date badges, expand foods, and personalize onboarding

Version: 2.0 | Updated: 2026-10-09 (America/Toronto)
Companions: PUNJABI_CANADIAN_FOOD_CATALOGUE_V2.json and AI_FITNESS_COACH_SYSTEM_PROMPT_V2.md

## 1. Implement this focused update in the existing app

The owner APPROVES the current white-first UI, food illustrations, navigation, animations, and overall layout. Preserve them. This is not another redesign.

Implement four connected improvements:
1. Fix Recent workouts date badges so every month/day stays inside its mint tile.
2. Add a broad searchable Punjabi Canadian food catalogue using the SAME illustration system.
3. Complete personalized onboarding with optional progress/inspiration photos and an actual AI-generated workout DRAFT.
4. Add private TEXT-BASED AI Coach chat to the first version, with staged screenshot and export imports specified below.

Read the earlier master/redesign specifications and existing app code/docs. This prompt supersedes them only for these additions. Preserve private membership, Supabase, per-user isolation, safe AI, offline saves, current records, and immutable workout history. No billing, public signup, social feed, or Play Store launch.

The project source is authoritative. Inspect what exists rather than trusting a screenshot or previous completion statement. Implement and test the work; do not stop at a proposal. Missing credentials are a setup blocker, not permission to fake a login, upload, or AI response.

## 2. Screenshot evidence and date-badge fix

References:
- Screenshot_20261009_205306_Chrome.jpg: approved meal-picker list and soft food artwork.
- 1000064694.jpg: approved Recent workouts list, with September labels wrapping poorly.

Keep the meal sheet's row layout, cream thumbnail tiles, familiar images, names, search, and Create a meal action.

For workout badges, inspect the actual DOM/computed CSS first. Likely contributing causes include a longer month string, word wrapping, inadequate padding, or a fixed size; don't declare the cause without checking.

Use separate elements for abbreviated month and day, centered consistently:
- A short month label, then a larger day number.
- Prefer consistent English labels Jan/Feb/Mar/Apr/May/Jun/Jul/Aug/Sep/Oct/Nov/Dec for the current English UI, or supported localized labels that fit.
- Use flex/grid centering, deliberate line heights, non-shrinking badge dimensions, and adequate inner padding.
- At larger text settings allow the badge/row to grow. Never “fix” overflow by clipping dates or shrinking them below readability.
- Surrounding row uses auto / minmax(0,1fr) / auto columns; labels and secondary text can wrap safely.
- Full localized date remains accessible through an appropriate accessible label; don't announce duplicate month/day fragments unnecessarily.
- Use the recorded session local date/timezone correctly. Parsing a date-only string as UTC midnight can shift a day in Canada; do not introduce that bug.

Test Sep 29, Sep 27, Sep 25, every other month, single/double digit days, 360px/390px screens, light/dark, and 200% text scaling. Preserve workout names, counts, and click behavior. Inspect rendered screenshots, not only CSS declarations.

## 3. Import the supplied catalogue

PUNJABI_CANADIAN_FOOD_CATALOGUE_V2.json contains 293 curated entries in 16 categories:
breads; rice/grains; dals/beans; sabzis; paneer/protein; eggs; meat/fish; dairy;
drinks; breakfast; snacks; sweets; fruit; nuts/seeds; sides/add-ons; Canadian meals/takeout/gym staples.

This is a broad discovery seed, not a prevalence survey, a universal Punjabi diet, a claim of completeness, or a verified nutrient database. Preserve Create a meal for anything missing.

Implement a typed loader/importer, schema validation, stable IDs, seed versioning, normalized search, and migration mapping. Use a global read-only catalogue visible only as appropriate to approved users; store individual favorites, recipes, calibration, and history separately. Don't clone all 293 records into every person's journal or expose any personal data alongside catalogue records.

Preserve existing food IDs/presets/history. Map old known names such as roti/chai/whey shake to suitable catalogue IDs without changing historical nutrient snapshots. A generic “dal” must not silently become a different confirmed recipe.

Browse UX:
- Search names and aliases, including roti/chapati/phulka, dal/daal, sabzi/sabji, dahi/curd, and common Canadian names.
- Add horizontal category chips or a restrained category picker.
- Default to the user's usual/favorite meals, followed by relevant starter foods.
- Onboarding lets each person choose 5–15 usual foods; do not show all 293 on the home screen.
- Search and All foods expose the full catalogue with sensible lazy/virtual rendering when needed.
- Support vegetarian/egg/meat/fish preferences and optional specific-day choices, but never infer religion or diet from Punjabi identity.
- Catalogue dietary hints are recipe-dependent discovery metadata, not allergen/vegan guarantees.
- Maintain accessible list rows, smooth sheets, readable empty/no-results states, and custom food creation.

## 4. Extend the existing illustrations, not the visual style

Inspect the current food illustration implementation before adding artwork. Reuse its shapes, viewpoint, soft shading, cream tile, proportions, and rendering method. Do not replace it with emojis, unrelated photos, generic monochrome outlines, or a new art style.

Every catalogue entry has a unique asset_key, an illustration family, and a food-specific brief. These are instructions, not completed image files. Generate the actual local SVG/component assets in the existing app.

Requirements:
- Recognizable identity: roti on a plate, grains in rice, yellow/red/brown dals, paneer cubes, eggs, chai, shaker, fruit, paratha filling, and distinct sabzi ingredients.
- Shared plates/cups/bowls may reuse components, but adjust food shape/color/garnish deliberately so everything is not the same bowl.
- Close variants can share a base silhouette with meaningful variation; don't generate 293 API image calls.
- Match the current artwork at the actual thumbnail size. Avoid text, brand logos, broken references, and inaccurate food icons.
- Bundle assets locally; avoid unauthorized manufacturer/restaurant photography.
- Add an illustration coverage check ensuring every catalogue asset key resolves.
- Inspect a gallery of every illustration plus representative actual picker rows at phone size. Fix mistaken identity and repetitive placeholders.
- Don't put adult progress photos into the food-image registry or shared asset bundle.

## 5. Nutrition must remain useful and honest

The supplied seed intentionally has null nutrients and uncalibrated portions. Do not turn these into zeroes, copy placeholder demo numbers, or ask an LLM to invent authoritative nutrition.

Resolve values from:
- A current, exact Canadian product Nutrition Facts label, including serving size.
- A properly matched current Canadian Nutrient File record.
- Other verified legally reusable records when a suitable Canadian match is unavailable.
- A confirmed recipe with quantities, incorporated oil/ghee, cooked edible yield, and a calibrated household serving.

Health Canada has a 2026 CNF release, while legacy online/API pages can still describe 2015 data. Verify source version/IDs and licensing during import. Do not label legacy values as 2026.

Source/prepare a practical first set of common ingredient/food records, then expand coverage. Homemade dishes may use a clearly disclosed standard-recipe estimate that the user confirms or replaces; a dish name alone does not establish its recipe.

Calibrate once, reuse often:
- Roti/paratha size; household katori/bowl; milk/cream/sugar in chai; shake brand/amount/liquid.
- Keep oil included in a recipe distinct from added ghee; never count the same fat twice.
- Separate dry/cooked quantities and product variants.
- Allow logging an unknown-nutrition item as a journal entry, but show nutrition totals as partial.
- Keep the current attractive food flow; recipe/source detail stays behind Edit recipe / Details.
- Never promise that 293 names means 293 exact calorie records.

## 6. Audit the existing AI prompt before replacing anything

Locate the actual runtime system/developer prompt, provider adapter, Edge Functions, structured response schemas, context assembly, and plan-approval logic.

Report the exact source file(s), current operation coverage, and checks actually run. If only mock responses/frontend cards exist, say so. Presence of a prompt string doesn't prove integration works.

Install AI_FITNESS_COACH_SYSTEM_PROMPT_V2.md as the versioned backend coach instruction or merge it into an existing compatible single source of truth. Avoid two conflicting prompts. Make model/prompt version auditable without exposing private context.

The earlier specification requested coach behavior; it did not establish that Claude implemented it. Verify implementation through a real configured call or a clearly labeled integration harness. No invented success.

## 7. Onboarding — questions first, optional images

Use the approved components to create a short friendly wizard with progress, Back, Save and continue, and Skip for optional steps. Save a recoverable draft. Suggested steps:

1. Your goal: consistency, fat loss, strength, muscle, fitness; ask which matters most.
2. Your week: available days, sessions/week, minutes/session, optional time windows, shift-work/rotation preference.
3. Your experience: new/returning/regular, current routine, exercise preferences, optional recent actual performance.
4. Your equipment: gym/home, equipment available, exercises to avoid, confirmed limitations/professional restrictions and appropriate screening guidance.
5. Your usual foods: select catalogue favorites, preferences/allergies, optional existing targets.
6. Optional photos: current progress photos and an inspiration image, with separate permission choices.
7. Review answers and generate a draft plan.

Adult eligibility and the required planning inputs must be confirmed. Current height/weight/measurements are optional where not necessary; never prefill old chat values. Sex/gender is not required merely to assign a workout. A woman does not automatically get a “toning” routine, and a man does not automatically get a heavy bodybuilding split.

Use suitable pre-exercise screening guidance; link to CSEP's official Get Active Questionnaire or use it with applicable permission. Do not represent a homemade checkbox list as a validated instrument. Relevant safety flags/restrictions require appropriate guidance, not AI medical clearance. Journaling remains available.

Ask only meaningful missing questions; don't force a long interview or a physique photograph before generating a useful routine.

## 8. Optional photo workflow and sensitive-data handling

Provide four optional slots: Front / Back / Left / Right, plus optional Inspiration. Every slot can be skipped or deleted.

Plain UI wording:
“Optional progress photos”
“Wear whatever feels comfortable. Photos are not needed to create your plan.”
“An inspiration photo helps describe your goal; it does not predict your results.”

Adult men may choose shirtless photos. Everyone, including women, may use comfortable normal clothing. Do not require exposed body areas, nudity, or close-ups. Provide consistent-position/lighting tips for comparison, not diagnostic promises.

Ask “What do you like about this goal?” after an inspiration image. Store the user's stated preference. Do not identify a celebrity, score attractiveness, estimate body fat, promise an identical physique, or claim the AI instantly understands fitness capability.

Separate permissions:
- Store optional photos privately for the user's progress history.
- Send selected photos to the AI provider for limited context.
Declining either must not block ordinary journaling or a plan based on answers.

Implementation:
- Authenticated approved members only.
- Separate private Storage bucket/purpose from ordinary food artwork; owner-scoped RLS and metadata.
- Upload only necessary compressed images; validate real content/MIME/dimensions/size, orientation, and metadata.
- Strip EXIF/location, allow face cropping, and use short-lived authorized reads.
- Don't let an LLM or client-supplied arbitrary URL fetch files; backend resolves only authorized owned objects.
- No image bytes, signed links, body descriptions, or identifying filenames in execution/error logs.
- Don't embed photos in public pages, compiled assets, shared exports, or another user's context.
- Prefer transient processing for AI; keeping images is an explicit user choice.
- Explain provider processing/retention honestly; never claim E2E encryption or zero retention.
- Deletion removes live owned images/metadata and queued processing; explain backup/offline expiry.
- Test that user B cannot upload/read/delete user A's photos through direct API or guessed object paths.
- Account cache separation covers previews; never show previous-user photo thumbnails after sign-out.

No unsupported body-fat scanning, posture diagnosis, physique scoring, or synthetic before/after predictor.

## 9. AI-generated plan immediately after completed onboarding

Implement a distinct authenticated onboarding_plan operation using the supplied runtime prompt.

Flow:
- Validate required answers, adult/member/consent status, restrictions, and profile version.
- Build minimal single-user context plus allowed exercise IDs.
- Include authorized optional image bytes only when their separate AI permission is active.
- Reserve budget before the call; generate ONE draft after review, not a call after every photo/question.
- Validate schema, exercise/equipment IDs, session count, units, constraints, and approximate duration.
- Persist a draft and show a beautiful plan preview with days, exercises, sets/reps, rest, warmup, recovery, and a brief rationale.
- Offer Accept plan / Edit / Regenerate.
- Activate only on approval through a transaction/new program version.
- Existing session prescriptions and history never change.

Unknown starting weights stay unset. Plans should fit available time and experience, rather than blindly selecting Push/Pull/Legs or promising six-pack results. Photo-free users receive the same functional planning flow.

Use configurable gemini-3.8-flash on the backend through a paid project. Keep credentials server-only, enforce stateless requests (store=false for Interactions), minimize context, and preserve all prior quota/privacy protections.

Separate onboarding-plan quota from food-photo/chat limits. Initial policy:
- One initial completed-profile plan.
- At most two explicit regenerations/week/person, configurable server-side.
- Idempotent request/profile hash and one in-flight draft operation.
- Optional image batch at most the four current views plus one inspiration image.
- Bound input sizes/output/thinking and reserve conservative maximum cost under the global budget.
- A full structured plan may require a larger bounded output budget than short chat; verify model semantics instead of truncating a plan at 2,048 tokens.
- Retry only within bounded limits; partial/invalid output never activates.
- AI unavailable or budget exhausted: retain answers and offer manual plan creation/retry. Don't fabricate a plan.

Completed profile does not imply consent to upload images or activate a generated plan.

## 10. Acceptance and delivery

Preserve the currently approved UI in before/after screenshots. Deliver:
- Resolved date-badge regression with screenshots for September and all other months.
- Validated/idempotent catalogue seed, indexed aliases, sensible browsing/favorites, custom meals intact.
- Real artwork asset coverage and representative gallery review, not asset briefs labeled finished images.
- Confirmed/sourced nutrition versus unknown entries represented honestly.
- Working onboarding answers, optional upload/skip/delete flow, private ownership tests.
- Actual backend prompt location/version, onboarding_plan function, validator, and draft approval.
- Tests for crossed ownership, no-consent images, prompt injection, budget/retry behavior, and changing plans without changing history.
- Screen refresh/reconnect and per-user offline persistence tests.
- Updated OWNER_GUIDE.md, SECURITY_AND_DATA_FLOW.md and BUILD_STATUS.md.

End-to-end checks:
A new approved user signs in -> chooses usual foods -> skips photos -> generates/reviews/edits/accepts a valid plan.
Another approved user adds selected photos/inspiration -> declines AI-image transfer -> still receives a plan from answers.
An opted-in user's images are processed only through their authorized context; deletion and revoked membership prevent new processing.
An unavailable provider produces a truthful recoverable state.
Neither user can access the other's photos, profile, meals, draft, or coach memory.

Recheck current official platform/API guidance. Record actual executed checks separately from code review, mocks, external setup blockers, and tests not run on the owner's phone.

## 11. Version-two addition: text-based AI Coach in the FIRST version

This addition is required for the first private release alongside sections 1–10. Preserve the approved UI, catalogue, illustrations, onboarding, and privacy controls. Use the existing backend provider and versioned runtime prompt; do not build a second unrelated chatbot.

### 11.1 Simple product flow

- Add a restrained Ask Coach button using approved components, opening a dedicated chat screen or full-height sheet. Keep the current four navigation tabs.
- Label the experience AI Coach. Do not imply the user is talking to a licensed professional or a human trainer. Explain the general-fitness scope once, with concise relevant limitations thereafter.
- Provide a readable conversation, composer, Send, New chat, and Delete chat. Add short optional starter questions such as adapting today's session to 30 minutes, explaining a weight trend, or choosing a meal from usual foods.
- First-version chat accepts TEXT ONLY. Existing optional onboarding photo uploads remain supported through their separate workflow. Do not add a working attachment button to chat until the applicable import stage passes its checks; never fake successful imports.
- Render validated assistant_message as plain text with safe formatting; never expose raw JSON, SQL, technical logs, or unsanitized model HTML. Any markup renderer must escape raw HTML and unsafe links.
- Include useful thinking/loading, cancel-wait, failure, quota-exhausted, offline, empty, and retry states. Keep the typed message after failures. Avoid duplicate sends; retry reuses the same request identity. Cancelling the UI wait does not imply the provider charge was cancelled.
- Chat requires internet. Existing offline journals continue working; do not silently queue sensitive AI requests for later transmission. Show which historical data window informed an answer when relevant.
- Match spacing, typography, light/dark themes, safe areas, keyboard behavior, reduced motion, and accessibility. No dashboard redesign, voice agent, public social features, or subscription work.

### 11.2 Grounded behavior and approved changes

Use the existing coach_question operation and AI_FITNESS_COACH_SYSTEM_PROMPT_V2.md. The backend assembles only the current authorized person's relevant profile, confirmed preferences, approved plan, recent logs, and deterministic progress metrics.

The coach can explain records, ask meaningful missing questions, give general nutrition guidance using confirmed foods/portions, and propose adaptations. It must not invent measurements, calculate a confident trend from sparse data, treat missing logs as zero, guess nutrition, assign a routine by ethnicity/gender, or diagnose injury. Medical concerns receive appropriate guidance; no instruction to train through pain or AI medical clearance.

Chat is not permission to mutate health records. Show a separate explicit review/accept action for an eligible plan proposal or candidate memory. Only an authenticated validated application action can apply it. Changed plans create a new version; historical sessions remain immutable. If profile/plan version changed since generation, revalidate or request regeneration before approval. First-release chat must not silently add meals, measurements, or completed workout sets.

For a requested plan adaptation, use the validated existing plan-draft contract and known exercise IDs. Short advice can use suggestions without a plan object. A larger plan draft uses its larger bounded plan quota/output budget, not a hidden unlimited chat call. Do not auto-regenerate the whole routine on ordinary questions.

Long-term personalization uses user-confirmed memories and recorded history, not automatic retraining of the model. Offer memory review/edit/delete. An AI interpretation never becomes a confirmed health fact without the person's approval.

### 11.3 Backend, ownership, privacy, and cost controls

- Extend the current architecture; a modular Supabase Edge Function/service is sufficient. No new microservice or n8n/Sheets replacement.
- Model coach_threads and coach_messages (or equivalent existing tables) with parent ownership, timestamps, deletion handling, request IDs, and validated response/model/prompt versions. Use an ownership-consistent relationship, such as a composite thread/user foreign key, to prevent a message referencing another person's thread.
- Enforce auth.uid(), approved membership, adult eligibility, and active AI permission in backend code and RLS. Never trust a client-submitted user_id, role, consent flag, or quota. The client cannot insert an assistant/system message or forge a generated draft.
- Recheck permission/membership before persistence. Scope any service-role query explicitly to the validated user; service-role bypasses RLS. Isolate conversation reads, writes, deletes, memory, drafts, and local caches.
- Store the minimal needed conversation content privately. Explain that chat is saved until deletion or configured expiry; initial retention is 90 days, with an implemented expiry job and Delete chat. Confirmed memories are a separate user-managed store and are not deleted implicitly with a chat; show a separate delete-memory option. Account deletion covers both. Explain backup expiry honestly.
- No raw health chats, screenshots, body descriptions, image bytes, secrets, or signed URLs in operational logs, analytics, or error reports. User-facing stored chat history is distinct from execution logging. Do not include prior-user chat previews after sign-out.
- Send a bounded relevant context window, not lifetime history. Initial configurable caps: 6,000 characters per user message; last 8 relevant messages; about 6,000 input tokens total including system/context; about 1,200 output tokens for ordinary replies; one in-flight AI request per person; 20 ordinary chat messages per person per day. Treat token limits as measured ceilings and trim old history before rejecting a valid request. Verify actual provider token/thinking semantics.
- Preserve the initial global US$10/month application budget from the earlier specification unless explicitly changed. Reserve conservative maximum cost atomically before every call, including retries and any billable thinking, reconcile usage, and enforce provider billing safeguards. The application budget is a target, not a guarantee against every provider billing event. Chat shares this budget with other AI operations; quotas are not a separate unlimited allowance.
- Derive the daily window from server time and validated user timezone. Enforce per-user quotas, timeouts, bounded retries, and idempotency in code. Reserve a request/thread key so concurrent duplicate requests cannot incur extra calls or saved messages. Do not retry automatically after an unknown provider outcome without a safe policy.
- Keep the provider key server-only. Preserve paid-project/stateless processing and provider-retention disclosure. Enforce request/content limits before provider transmission; do not enable arbitrary URL fetching, SQL tools, external browsing, or user instructions embedded in records.
- Validate output schema, evidence IDs, permitted exercises, units, and plan constraints. Enforce requested schema_version 2.0 consistently across the adapter, validator, fixtures, and frontend. Existing saved version-1 responses remain readable through a compatibility adapter; do not rewrite their history. Provider failures or invalid output produce an honest recoverable state.

### 11.4 Required first-version verification

- A user asks for a 30-minute adaptation and receives grounded advice or a valid draft fitting their equipment and constraints; nothing activates before approval.
- A progress question uses authorized deterministic metrics and acknowledges sparse/missing observations. A meal answer never fabricates macros for an unverified catalogue entry.
- No medical diagnosis, body-fat photo estimate, extreme diet, or claimed professional credentials.
- User B cannot access A's threads/messages/memories/drafts through direct requests, guessed IDs, or cached UI. Deleted chats disappear from live context and future requests; expiry and revocation work.
- Duplicate sends/retries do not duplicate messages or billable calls; input/output/daily/global budget limits and provider failures are covered.
- Prompt-injection text remains untrusted, assistant messages cannot be forged, unsafe HTML cannot execute, and accepted plan proposals recheck ownership and current versions.
- Inspect real Android and iPhone chat layouts, including keyboard and safe areas, when devices are available. Mark unavailable device testing clearly. Show actual provider-call evidence or a labeled harness, never a mock presented as production AI.

## 12. Staged import roadmap — specify now, implement AFTER the first release

Only text chat in section 11 is an additional first-release requirement. Keep stages B–D disabled until implemented and tested. Record this staging in BUILD_STATUS.md so Claude does not treat every roadmap item as launch-blocking work.

### Stage B — confirmed scale screenshot imports

Add this after reliable chat and journaling. Initially accept only supported PNG/JPEG scale-app screenshots with visible readings, through an attachment entry point that launches a distinct import review.

Flow: Upload -> Extract candidate readings -> Review/edit -> Confirm -> Save.

- Extract only visible labeled readings: weight, body-fat percentage, muscle/fat mass, and other explicitly supported metrics. Unknown or unreadable values remain null. Never infer a missing date, unit, decimal, or health status; ask the user.
- Keep body muscle percentage, skeletal muscle percentage, and mass in kg/lb distinct. Preserve vendor labels and units; do not merge incompatible definitions. Unsupported vendor metrics may be recorded as labeled source notes rather than interpreted as clinical facts.
- Show source, measurement date/time/timezone, value, unit, uncertainty, and conflicts/duplicates before saving. A screenshot upload timestamp is not automatically the measurement timestamp.
- Store body-composition values as device-reported estimates, not clinically verified results. Do not change diet or training solely because one estimated fat/muscle reading moved. Record source/device and method when known so changes across devices are not treated as directly comparable.
- Use a separate gated measurement_extract operation and typed validated candidate schema from the runtime prompt. The model returns candidates only; explicit confirmation invokes application code to save.
- Use private owner-scoped temporary uploads, verified MIME/signature/dimensions, initial 10 MB/image maximum, metadata stripping, bounded processing, separate AI-image permission, and deletion. Temporary originals expire within 24 hours after processing unless the user separately chooses private retention. An implemented cleanup job enforces expiry. Do not send scale screenshots through the body-photo interpretation workflow or public food artwork registry.
- Reject malformed images, unauthorized objects, and arbitrary URLs. Test wrong units, dates, decimals, blurry/missing labels, repeated imports, revoked consent, cross-user access, and malicious image text.

### Stage C — a tested MyFitnessPal CSV importer

Add after stage B. MyFitnessPal's current official documentation describes Premium/Premium+ exports as a ZIP containing nutrition, progress, and exercise CSVs. Confirm the current documented format and obtain a user-authorized sample before promising compatibility; do not invent column names or require an MFP password.

- Start with extracted CSV uploads. ZIP support is optional later, with entry-count, compressed/uncompressed size, expansion-ratio, nesting, and path-traversal checks. Initial CSV caps: 10 MB/file and 100,000 parsed rows, enforced while parsing; tune based on measured real exports.
- Parse with deterministic application code and explicit versioned column mappings. Do not send an entire export to an LLM or use chat to freely rewrite records. Reject unsupported executable files and unknown formats with clear instructions.
- Detect encoding, header version, units, dates, and timezone ambiguity; ask for confirmation when necessary. Treat notes and cells as data, never code or instructions; neutralize spreadsheet formulas when re-exporting.
- Preview the covered dates, supported datasets, row counts, duplicates, conflicts, invalid/skipped rows, and mapping choices. Nothing writes to the journal before confirmation.
- Import only what is present. Meal-level nutrition totals do not establish individual recipes or ingredient lists; preserve them as source meal totals. Exercise summaries do not prove detailed sets/reps. Separate reported calorie-burn estimates from intake and do not add them to a nutrition allowance automatically.
- Avoid double counting imported meal totals alongside existing detailed logs. Keep the source records visible with explicit user-selected reconciliation; do not silently overwrite manual records or generated plans.
- Preserve provenance, source-row identity, raw labels, units, and an import batch ID. Use user-scoped source IDs plus canonical row fingerprints to detect duplicate/overlapping exports; file hashes alone are insufficient. Confirm conflicts instead of assuming the latest file is correct.
- Stage rows then commit an approved batch consistently. Preview Cancel leaves no journal changes. Provide Undo import that removes only untouched records from that batch; if records were edited later, preview conflicts and preserve those edits. Never roll back unrelated/manual data.
- Raw CSV staging expires within 24 hours after completion/cancellation unless explicit retention is selected. Owner isolation, retention cleanup, bounded jobs, atomicity, repeat-import behavior, and undo require tests.
- Chat may explain the validated import summary. Deterministic normalized records and provenance are authoritative; unsupported or missing values stay missing.

### Stage D — additional sources and health integrations

Add other export formats and device connections only when demanded by real users and supported by documented APIs. Plan a native permissioned bridge for Android Health Connect/Samsung data and Apple HealthKit, verifying the exact Google/Samsung services then. A home-screen PWA alone does not access these device health stores.

Normalize approved measurements with source, unit, timestamp, timezone, permission state, and deduplication rules. Support consent revocation and data deletion. No automatic health sync, native release, billing, or universal importer is required for the first version.

## 13. Version-two delivery additions

Deliver section 11 as working code, migrations/RLS, a single versioned runtime prompt, schema-version compatibility, and tested UI alongside the original sections 1–10. Update OWNER_GUIDE.md and SECURITY_AND_DATA_FLOW.md with chat storage/retention, AI permission, approval boundaries, deletion, quota configuration, and key setup. BUILD_STATUS.md must distinguish implemented chat from stages B–D that remain planned/disabled.

Report actual executed tests, mocks/harnesses, external credential/setup blockers, and device checks separately. The food seed still contains 293 unchanged entries and illustration briefs, not completed artwork or verified nutrients. Do not mark roadmap imports, integrations, or art as complete merely because these specifications exist.

New references for import design:
- https://support.myfitnesspal.com/hc/en-us/articles/360032273352-Export-your-nutrition-progress-and-exercise-data — current export eligibility and meal/progress/exercise CSV scope; inspect actual files before mapping.
- https://mhealth.jmir.org/2021/4/e22487 — study of three smart scales, supporting caution with device-reported body-composition estimates; not proof about every device.

BEGIN IMPLEMENTATION IN THE EXISTING REPOSITORY. KEEP THE APPROVED DESIGN. COMPLETE TEXT CHAT FIRST; LEAVE STAGED IMPORTS DISABLED.

## Research basis and limits

- https://journals.sagepub.com/doi/10.1177/0017896910373031 — qualitative Punjabi Canadian family research; mixed traditional/Western practices, not a population food-frequency survey.
- https://onlinelibrary.wiley.com/doi/10.1111/j.1467-9566.2010.01252.x — contextual immigrant food-practice research in a specific older-male population.
- https://www.restaurants.brars.com/ — current GTA dish availability examples.
- https://nanakfoods.com/products — current product-discovery examples; exact labels still required.
- https://www.canada.ca/en/health-canada/services/food-nutrition/healthy-eating/nutrient-data/canadian-nutrient-file-about-us.html — Canadian nutrition reference.
- https://open.canada.ca/data/en/dataset/1b6139bd-ed7e-4043-bc28-ff00e10f3109 — CNF 2026 dataset; verify version/licence before import.
- https://help.timhortons.ca/hc/en-ca/articles/35736786288155-Where-can-I-find-ingredient-information-for-your-menu-items — exact Canadian menu/ingredient information.
- https://store.csep.ca/pages/getactivequestionnaire — Canadian exercise screening reference.
- https://supabase.com/docs/guides/storage/security/access-control — private image ownership.
- https://ai.google.dev/gemini-api/docs/zdr — provider-processing/retention boundaries.

