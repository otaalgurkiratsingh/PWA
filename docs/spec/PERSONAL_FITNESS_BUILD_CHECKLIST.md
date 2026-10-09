# PERSONAL_FITNESS_BUILD_CHECKLIST.md
# AapnaFit Private — first-time builder's checklist

Version: 1.0 | Prepared 2026-10-09
Companion: CLAUDE_CODE_SYSTEM_PROMPT.md, version 2.0

Purpose: build a useful private app for you, your wife, and eventually 3–4 adult friends. Keep your agency as your business priority. This checklist reduces avoidable mistakes; it cannot guarantee a perfect app, accurate AI advice, or immunity to hacking.

All boxes begin unchecked. Check a box only after you have observed the result or Claude Code has recorded the actual test evidence. “Implemented” is not the same as “tested.” Keep evidence and unresolved issues in docs/BUILD_STATUS.md. Never put passwords, API keys, recovery codes, or real health records in that file.

## 0. Understand the five parts

| Term | Plain meaning | Your choice |
|---|---|---|
| Frontend | The screens and buttons on your phone | React/TypeScript |
| Backend | The server that checks access and performs protected work | Supabase Edge Functions |
| Database | Your saved meals, workouts, and preferences | Supabase PostgreSQL |
| Authentication | Proving which person is logged in | Supabase Auth |
| RLS | Database rules that decide whose records that person can access | Owner-only policies plus approved membership |
| API key | A credential a service uses to recognize your application | Gemini secret stays on the backend |
| PWA | A website that can install as an app on supported phones | First delivery method |
| APK | An Android installation package | Optional later Health Connect integration |

Your phone may contain Supabase's public project URL and publishable key. It must never contain the Gemini secret or a privileged Supabase key. Public project identification is not permission to read health records.

**Owner:** you. **Builder:** Claude Code working in your project.
Claude Code can write code and explain setup. You control accounts, billing, secrets, device permissions, and the decision to release.

## 1. Set a boundary before building

- [ ] Owner: choose the first goal: “Replace my notebook and make my usual meals quick to log.”
- [ ] Owner: commit to private use; remove selling, billing, public signup, referrals, and marketing from this project.
- [ ] Owner: set an initial budget of 20 hours of your own effort for a useful daily journal. This is a scope limit, not a guaranteed completion time.
- [ ] Owner: postpone automatic Samsung imports, elaborate animations, and advanced coaching if they block that first useful version.
- [ ] Owner: continue your current workouts and health care while building. The app is not a prerequisite for healthier habits.
- [ ] Owner: list your current notebook workout plan, 10–20 usual meals, equipment, units, and three biggest logging frustrations. Keep this personal information outside the repository.
- [ ] Owner: record current measurements/targets when needed; don't reuse old conversational values without checking.
- [ ] Owner: agree that initial recipe calibration is acceptable. Exact nutrition cannot be recovered from an arbitrary photo.

**Gate:** you can explain the first version in one sentence and name the features deferred.

## 2. Prepare a private project

- [ ] Owner: install Claude Code, Git, and a currently supported Node.js LTS version through official sources. Ask Claude Code for instructions matching your operating system.
- [ ] Owner: create one project folder and place both companion Markdown files inside it.
- [ ] Builder: inspect the folder and any existing instructions before modifying files.
- [ ] Builder: record compatible versions and exact install/run commands in README.md; commit a dependency lockfile.
- [ ] Owner: create a private GitHub repository if using GitHub. Enable MFA on GitHub and your other administrator accounts; protect recovery codes separately.
- [ ] Builder: ignore secret environment files, local exports, photos, database dumps, and Android signing material in git.
- [ ] Builder: supply .env.example with placeholders only. Scan the first commit before pushing.
- [ ] Owner: use separate personal-app projects rather than agency production credentials, databases, and billing.
- [ ] Builder: create docs/BUILD_STATUS.md with phase, checks actually run, open issues, and the next action.

**Gate:** the project starts locally with synthetic data and no AI or production credentials.

## 3. Make the visual journal work locally

- [ ] Builder: deliver Today, Meals, Train, and Progress with readable labels, large tap targets, and a phone layout.
- [ ] Owner: try the interface on your actual Samsung phone; verify that it feels easier than the notebook.
- [ ] Builder: show planned reps/sets separately from actual completed reps, loads, and skipped sets.
- [ ] Builder: provide usual-meal tiles, portion controls, undo/edit, and clear estimates.
- [ ] Builder: calculate nutrients deterministically from confirmed sources and quantities; keep unknown values unknown.
- [ ] Builder: distinguish dry/cooked weights, record serving conventions, and count recipe oil once.
- [ ] Builder: save entries locally immediately; nutrition calculation and workout logging must work without AI.
- [ ] Owner + Builder: complete a workout with network disabled, close/reopen the app, and check saved sets, timer, and pending changes.
- [ ] Builder: test refresh, browser storage failure, reconnection, duplicate retries, and conflicting edits.
- [ ] Owner: time a usual-meal entry. Aim for 10–15 seconds after setup.
- [ ] Builder: respect reduced motion, large text, keyboard/screen-reader labels, and narrow screens.
- [ ] Builder: run build/type/lint checks and meaningful calculation/persistence tests; record results.

**Gate:** one full meal-and-workout day can be logged and recovered. Attractive mockups alone do not pass.

## 4. Configure Supabase and private membership

- [ ] Owner: create a separate Supabase project in a suitable available region. If choosing Canada, understand that other providers may still process data elsewhere.
- [ ] Owner: enable administrator MFA and keep the database password in a password manager.
- [ ] Owner + Builder: install reviewed migrations with constraints, ownership checks, indexes, and RLS on every exposed personal table.
- [ ] Builder: keep membership administration and AI usage tables outside direct client access.
- [ ] Owner: disable public signup; initially approve only your own account.
- [ ] Builder: require active approved membership for every database operation and AI request.
- [ ] Owner + Builder: configure Supabase Auth, exact permitted redirect URLs, and a production-capable email sender if using email OTP. Follow the sender's domain-verification instructions.
- [ ] Owner: enter only VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in frontend configuration.
- [ ] Builder: keep privileged Supabase credentials only in backend secret settings. Never create a frontend variable for them.
- [ ] Builder: validate child-record ownership, updates, immutable snapshots, and server-controlled role/version fields.
- [ ] Builder: explain login, logout, session persistence, and owner cache separation in plain language.

**Gate:** approved login works; public registration and unapproved access fail.

## 5. Prove that accounts are separate

Use two synthetic accounts, A and B, before adding real health history.

- [ ] Builder: use A's real session token to attempt direct reads, edits, deletes, exports, and RPC calls against B's record IDs. Every attempt fails.
- [ ] Builder: try changing user_id, role, quota, and child references in requests; the server rejects or ignores forged fields appropriately.
- [ ] Builder: verify logged-out, unapproved, expired-token, and revoked-member access.
- [ ] Owner + Builder: sign out of A and sign in as B on the same phone; no A records, drafts, chat, or memory appear.
- [ ] Builder: ensure unsafe HTML and imported free text render safely.
- [ ] Builder: inspect the generated frontend bundle, source maps, repository history, logs, and browser requests for secrets.
- [ ] Builder: verify requests require authentication independently of CORS and the UI's login screen.
- [ ] Owner: read the recorded test evidence. Do not accept “RLS is enabled” as sufficient evidence.

**Gate:** all isolation checks pass before real cloud health data is entered.

## 6. Add your actual routines and recovery

- [ ] Owner: replace demo meals with verified labels/recipes and calibrated portions. Mark generic assumptions clearly.
- [ ] Owner: enter your existing workout plan and confirm each exercise, prescription, load convention, and unit.
- [ ] Owner: confirm your current targets. Journaling works even if no calorie target is set.
- [ ] Owner: give your wife her own account, plan, preferences, and targets after the separation checks; obtain her agreement first.
- [ ] Builder: add per-user export of meals, recipes, programs, history, units, sources, and confirmed AI memory.
- [ ] Owner + Builder: create an encrypted backup and restore it into a safe test environment using synthetic records first.
- [ ] Owner: set a backup schedule. A free database tier is suitable for testing only if you accept its availability and backup limitations.
- [ ] Builder: explain what remains only on the device until synced, and what happens if browser data is cleared.
- [ ] Owner: use the journal for real daily routines; record actual friction before adding features.

**Gate:** you can restore the journal and prefer using it over the notebook.

## 7. Add AI through a protected backend

Initial runtime choice: **Gemini 3.8 Flash**, model ID **gemini-3.8-flash**. Claude Code is the builder; Gemini is the model called by the finished app. Recheck account availability and current official documentation during implementation.

- [ ] Owner: create a separate Google API project and explicitly configure paid billing before sending private health data. A consumer chatbot subscription does not configure API billing.
- [ ] Owner: enable Google administrator MFA; review project members and billing notifications.
- [ ] Owner: create the currently supported authorization API key through Google AI Studio and review its service-account/API permissions.
- [ ] Owner: place GEMINI_API_KEY directly into Supabase backend secrets. Never paste it into chat, a public issue, source code, a screenshot, or a frontend environment field.
- [ ] Builder: never use VITE_GEMINI_API_KEY; Vite exposes frontend-prefixed variables to browser code.
- [ ] Builder: make the phone call an authenticated backend function. That function verifies the session, membership, consent, quotas, and authorized context before calling Gemini.
- [ ] Builder: derive identity from the verified token, not a submitted user_id.
- [ ] Builder: use stateless requests; for Interactions API explicitly enforce store=false. Disable unnecessary tools, grounding, provider conversation storage, and optional data sharing.
- [ ] Owner: read the provider terms. Paid processing limits training use, but stateless requests do not eliminate all provider retention or third-party processing.
- [ ] Builder: send only necessary user-owned summaries; exclude names, emails, diagnoses, other members' records, and unnecessary full history.
- [ ] Builder: validate structured output and display it as safe text/components.
- [ ] Builder: bound image size/type/dimensions, remove metadata, and avoid retaining original photos.
- [ ] Owner: approve optional AI processing separately from basic cloud journaling.

**Gate:** the browser cannot find a Gemini key or make a provider request using a permanent credential.

## 8. Test AI behavior and spending

- [ ] Builder: start with weekly reviews of calculated metrics, optional short questions, and confirmed photo suggestions.
- [ ] Builder: never call AI when logging a saved meal or completing a set.
- [ ] Builder: implement server-side limits: initially 3 photo analyses/day, 5 short questions/day, and 1 new weekly review/week per user.
- [ ] Owner + Builder: set an initial US$10/month application budget, conservative spend reservations, and a separate maximum-call limit. Update price assumptions when provider pricing changes.
- [ ] Owner: understand that billing alerts alone do not stop charges; the application must enforce its own limits. A compromised provider credential can bypass those application limits.
- [ ] Builder: test concurrent requests, repeated operation IDs, timeouts, and exhausted budgets. Don't allow unlimited automatic retries.
- [ ] Builder: verify unauthorized requests result in zero model calls.
- [ ] Builder: verify the journal continues to work when AI is disabled, over budget, or unavailable.
- [ ] Owner + Builder: check a review against known journal records; it must cite the real period, identify missing data, and avoid invented facts.
- [ ] Builder: test malicious instructions in a chat/import/photo without permitting data disclosure or arbitrary tools.
- [ ] Owner + Builder: accept and reject a proposed plan change. Targets change only after approval; past sessions stay unchanged.
- [ ] Builder: separate AI observations from confirmed personal memory and provide view/edit/delete controls.
- [ ] Owner: reject extreme restriction, pain-dismissive advice, diagnoses, medication instructions, and promises of visible abs. Use qualified guidance for obesity treatment and individualized health decisions.

**Gate:** useful grounded reviews, safe failure behavior, and tested limits. More stored data does not guarantee better recommendations.

## 9. Install privately on your phone

- [ ] Owner + Builder: choose a separate HTTPS hosting project. Start with its hosted URL; buy a domain only if you want one.
- [ ] Builder: configure manifest/icons, secure response headers, restrictive CSP, and deployment environment separation.
- [ ] Builder: service-worker caches contain the app shell/static assets, not protected API responses or health photos.
- [ ] Owner + Builder: verify HTTPS, permitted auth redirects, login/logout, offline logging, sync status, and updates at the deployed URL.
- [ ] Owner: open the app in Android Chrome and use the available Install/Add to home screen menu. Labels depend on browser support.
- [ ] Owner: test the installed version during an actual workout, including screen lock, backgrounding, and reopening.
- [ ] Builder: preserve drafts during service-worker/schema updates; explain browser storage and background-sync limits.
- [ ] Owner: confirm the displayed step source is Manual/Imported until a real native connection exists.
- [ ] Owner: keep the phone locked and updated. Anyone using an unlocked logged-in phone may access that account.

**Gate:** installed daily journal works on your device. Knowing its URL must not grant access.

## 10. Optional: automatic Samsung Health imports

Skip this phase until the journal is useful. A regular browser PWA cannot directly read Health Connect.

- [ ] Owner + Builder: test Health Connect availability on the actual Samsung phone and confirm Samsung Health sharing permissions.
- [ ] Builder: reuse the web interface in Capacitor and verify a current stable native bridge or implement a small read-only plugin.
- [ ] Builder: read steps first; add sleep only if useful. Request only required permissions.
- [ ] Owner + Builder: compare imported values/date/source with the device; test duplicate sources, revoked permissions, stale data, and missing records.
- [ ] Builder: send only consented daily summaries to cloud; do not upload raw health history by default.
- [ ] Builder: never double-count active/total calories or automatically prescribe eating back wearable estimates.
- [ ] Owner + Builder: verify current private-distribution/developer-verification requirements for your location/devices.
- [ ] Builder: produce a signed release APK; protect and separately back up the signing key, password, and recovery instructions.
- [ ] Builder: pin trusted origins/navigation and use supported native secure token storage. Never put the Gemini secret in the APK.
- [ ] Owner + Builder: install from a controlled source and test a signed update without losing records or signing identity.
- [ ] Owner: retain the PWA route for participants who use iPhones.

**Gate:** physical-device evidence before claiming automatic syncing. Packaging alone does not prove integration.

## 11. Invite friends and maintain it

- [ ] Owner: use the app yourself for two weeks before inviting more people.
- [ ] Owner: invite only the intended adult friends; get their informed agreement. Each gets a separate account.
- [ ] Owner: provide a short notice covering the operator, cloud storage, optional AI transfers, retention, export, and deletion.
- [ ] Owner: don't assume “private and free” removes all privacy obligations. Reassess if its audience, country, or use changes.
- [ ] Builder: test account deletion, withdrawal, cancellation of pending AI/uploads, and denial with an old access token.
- [ ] Builder: document delayed backup/provider expiry and deletion replay after a restore.
- [ ] Owner: do not share administrator passwords or create a friends' health-data dashboard.
- [ ] Owner: review costs and backup success monthly; run a restore drill periodically.
- [ ] Owner + Builder: review dependency/security updates and model deprecations; rerun relevant checks when changes occur.
- [ ] Owner: if a key leaks, revoke/rotate it promptly through the provider, audit use, and replace backend configuration. Removing it from a file does not revoke it.
- [ ] Owner: keep portable exports and source/signing recovery information. No vendor or model can promise lifetime availability.
- [ ] Owner: add features only when they fix repeated actual friction and fit the agency time budget.

**Gate:** private access, recoverable data, informed participants, and an affordable maintenance routine.

## Completion record

| Evidence | Result/date |
|---|---|
| Working local meal/workout slice | Not run |
| Direct API isolation and membership tests | Not run |
| Frontend/repository secret scan | Not run |
| Actual phone offline/recovery tests | Not run |
| Backup restore and deletion tests | Not run |
| AI quality, privacy, and quota checks | Not run |
| HTTPS installed PWA checks | Not run |
| Samsung native integration, if chosen | Not run / optional |

No box is pre-approved by these documents. Keep unfinished items visible and release in usable stages. Your measure of success is less logging effort and a routine you maintain.

## First instruction to give Claude Code

Copy this instruction after placing both files in your project:

> Read CLAUDE_CODE_SYSTEM_PROMPT.md and PERSONAL_FITNESS_BUILD_CHECKLIST.md. Begin Phase 0 and build the local visual meal-and-workout journal with synthetic data. Use no live API credentials yet. Implement in small verified steps, record actual check results in docs/BUILD_STATUS.md, and explain the next owner action in plain language. Stop short of external publishing, billing activation, or inviting people until I instruct you.

## Official setup references

Recheck these at implementation time; dashboard labels and platform rules can change.

- Claude Code: https://code.claude.com/docs/en/setup
- Supabase keys: https://supabase.com/docs/guides/getting-started/api-keys
- Supabase data security: https://supabase.com/docs/guides/database/secure-data
- Supabase email: https://supabase.com/docs/guides/auth/auth-smtp
- Gemini model: https://ai.google.dev/gemini-api/docs/latest-model
- Gemini key setup: https://ai.google.dev/gemini-api/docs/api-key
- Gemini privacy: https://ai.google.dev/gemini-api/docs/zdr
- Chrome installation: https://support.google.com/chrome/answer/9658361
- Samsung Health integration: https://developer.samsung.com/health/health-connect-faq.html
- Android private distribution: https://developer.android.com/distribute/marketing-tools/alternative-distribution

