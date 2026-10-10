# Security, threat and data-flow notes

These notes describe what is built and what has been tested. They are not a certification. TrainLuma is not anonymous, not end-to-end encrypted and not "unhackable". Hosting and AI providers process the data you authorise.

## Data flow

```
Phone browser (PWA)
 ├─ IndexedDB: one database per account (journal records + outbox + timer + sync state + onboarding draft)
 ├─ Cache Storage: app files and the bundled food list only (never API responses, health data, chats or photos)
 ├─ Memory only: chat on screen, progress-photo previews (object URLs revoked on leave), photos the person chose not to store
 ├─ HTTPS → Supabase Auth (email one-time code; shouldCreateUser:false)
 ├─ HTTPS → Supabase Data API, as the signed-in user (RLS: owner + active membership everywhere)
 │     sync_push / sync_pull → journal_documents · consent_events (5 types, append-only)
 │     coach_threads / coach_messages (read, delete_coach_thread) · plan_drafts (read, decide_plan_draft)
 │     user_confirmed_memory · progress_photos metadata · coach_reviews / change_proposals
 ├─ HTTPS → Supabase Storage, as the signed-in user: bucket progress-photos (private, JPEG ≤ 1.5 MB),
 │     path <owner>/<random>.jpg; upload needs the photo-storage permission; read/delete own folder only
 └─ HTTPS → Edge Function "ai" with the user's access token (never a provider key)
          1 verify JWT (getClaims) → identity = token subject; the body never names a user
          2 bounded JSON body (≤ 2.5 MB; chat message ≤ 6,000 characters), schema-validated
          3 membership + AI permission (latest ledger entry) checked with the CALLER's token
          4 provider key + prices configured? else "not configured" (no reservation, no call)
          5 urgent symptoms in a chat message or plan request → safety reply, no model call
          6 chat: the thread must be the caller's own and unexpired (RLS) → else 404
          7 plan: profile version must match the synced profile (stale → 409); missing answers →
            questions; screening concern → guidance; no model call for any of these
          8 photos: own stored photos by id (RLS + Storage policy) or this-request-only inline photos,
            used ONLY with the separate AI-image permission; JPEG checks, no EXIF/APP1, ≤ 5
          9 single-person envelope from the caller's own documents (no name/email), bounded:
            chat ≤ 8,000 input tokens incl. the system prompt, last 8 messages max, oldest trimmed first
         10 ai_reserve (service role, advisory-locked): idempotent operation id, ONE request in flight per
            person, per-person limits on the person's local day, separate plan allowance, monthly budget;
            reserves the maximum cost of every allowed attempt (thinking included) before any call
         11 Gemini with the single versioned system prompt (coach-2.0+<sha256>), JSON schema 2.0 output,
            no tools/grounding/URL fetching, stateless (generateContent; Interactions store=false optional)
            chat ≤ 1,200 output tokens, plan ≤ 6,000, review ≤ 2,048; 25 s timeout
         12 output validated; ungrounded evidence refs and unsafe text removed; chat can't return a plan,
            food numbers or measurements; plan drafts checked in code (allowed exercise ids, days, weekdays,
            reps, units, unknown loads unset, our own duration estimate ≤ time available); one retry only
            after an INVALID answer, never after a timeout or unknown provider outcome
         13 storage via service RPCs that recheck membership + AI permission: coach_store_exchange
            (idempotent per request id), store_plan_draft (supersedes older drafts); ai_finish records cost
```

## Keys

| Value | Allowed location | Never in |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | browser bundle (identifies the project; safe only with grants + RLS) | — |
| `GEMINI_API_KEY` | Supabase Edge Function secrets, entered by the owner | `VITE_*`, frontend code, source maps, git, logs, chat |
| Supabase secret / service-role key | platform-provided to the Edge Function | same as above |
| Session tokens | Supabase SDK storage in this browser (`rozana-auth`) | URLs, logs, error reports |

Checks: `npm run scan:secrets` covers tracked files, the full git history and `dist/`. It looks for Google keys, `sb_secret_`, service-role JWTs, private keys, `VITE_GEMINI` and source maps. A planted fake key is detected. The e2e suite asserts that no browser request goes to a Google API host and that the AI request carries only the user's bearer token. The production CSP is generated at build time with `connect-src 'self' https://<project>.supabase.co`, so the browser cannot call the AI provider even if code tried.

## Database controls

Migrations: `20261009000001_init.sql`, `20261009000002_sync_auth_ai.sql` and `20261010000003_coach_v2.sql`.
- `anon` has no table privileges. `authenticated` gets only the operations each table needs. Every public table has RLS on.
- Policies require `user_id = auth.uid()` **and** `private.is_active_member()`.
- Composite `(id, user_id)` foreign keys prevent cross-owner references. Triggers make id, owner, version and timestamps server-controlled and freeze sealed revisions.
- `journal_documents` is **read-only** for clients. Writes go only through `sync_push` (`SECURITY DEFINER`, empty `search_path`). It checks membership, requires `body.owner_id = auth.uid()`, limits 100 ops and 200 KB per document, records idempotent receipts, detects stale versions (keeping the device's own unacknowledged writes as non-conflicts) and allocates a per-user change sequence in the same transaction.
- `ai_reserve`/`ai_finish` are executable only by `service_role`. They take a global and a per-user advisory lock, so concurrent requests cannot both pass a limit.
- `request_account_deletion` stops access first (membership → `deleting`), deletes the member's rows, and records a privacy job and deletion ledger.
- **Chat:** clients can only SELECT their own threads/messages (and only unexpired ones) and delete their own threads through `delete_coach_thread`. Messages reference threads with a composite `(thread_id, user_id)` key. Only the backend writes messages, through `coach_store_exchange` (service role), which rechecks membership and AI permission and is idempotent per request id. Retention: 90 days after the last message; RLS hides expired chats at once and `private.coach_expire()` (pg_cron, daily) removes them.
- **Plan drafts:** written only by `store_plan_draft` (service role). The person decides through `decide_plan_draft`, which checks owner, status and the profile version; activation happens on the phone as a NEW program version, so past sessions never change.
- **Photos:** private bucket; Storage RLS restricts every object to the caller's `<user id>/` folder with a strict random file name, requires active membership, and requires the `photo_storage` permission to upload (never to delete). `progress_photos` metadata has matching owner/folder checks.
- **Permissions:** `consent_events` accepts `cloud_backup`, `ai_processing`, `photo_storage`, `ai_images`; the latest event of each type decides.
- The `private` schema (membership, AI usage/budget/limits, sync receipts and counters, privacy jobs, deletion ledger) has no client table privileges.

## Evidence (run 2026-10-10; details in BUILD_STATUS.md)

| Area | How | Result |
|---|---|---|
| Isolation, grants, immutability, sync, deletion, AI accounting, chat/drafts/photos/permissions/retention | `npm run test:db` (local PostgreSQL 16 + Supabase auth/storage stand-ins, simulated verified-JWT claims) | 59/59 across three migrations |
| Mutation checks | membership check, default grants, single-column FKs, advisory locks, owner check (earlier); chat composite key, photo-storage permission, one-in-flight rule (new) | each made specific tests fail |
| AI handler + plan rules + prompt install | `vitest` in `supabase/functions` | 46/46 |
| Real Edge Function in Deno vs. mock Supabase + **mock Gemini (integration harness, not the provider)** | `npm run smoke:ai` | 18/18 |
| Browser: sign-in, onboarding, drafts, chat, photos, two people on one phone, offline, provider failure | Playwright vs. scripted fake Supabase | 15/15 (plus 20/20 demo) |

### Not yet verified (needs the owner's live project)
- Real Supabase JWT signature, issuer, audience and expiry handling, and `getClaims` with the project's signing keys. Locally these are simulated or mocked.
- Disabled sign-ups, the email template sending a code, SMTP delivery, rate limits and redirect URLs.
- Running the migrations on Supabase's real role and default-privilege setup. Re-run the isolation suite there before real data.
- The live Gemini call: model availability, whether it accepts the schema-2.0 JSON schema as sent, the exact response/usage fields (including how thinking tokens count), real token counts for the ~4–4.7k-token system prompt, actual prices, answer quality, and the provider's retention terms for your account.
- Supabase Storage on the real project (bucket limits, RLS on `storage.objects`, downloads with the user's token) and the pg_cron schedule.
- Edge runtime limits (memory, CPU, request size) with real photos.
- Physical phones: Samsung/Android install, screen lock during a workout, iPhone.

## Frontend controls
- There is no `dangerouslySetInnerHTML` or `innerHTML`; lint enforces this. AI output and journal text render as plain React text.
- No analytics, session replay, ads, remote fonts or third-party scripts. The theme script is a same-origin file, so the CSP keeps `script-src 'self'`.
- Each account has its own IndexedDB. A new account never inherits demo data. Signing out warns about anything not yet backed up and can remove the phone's copy once everything is backed up.
- The service worker never replaces the app mid-workout. It reloads only after the person taps Update. This was a real bug: the first install used to reload the page; the e2e tests found and fixed it.
- Photos are cropped, downscaled and re-encoded on the phone (dropping metadata). Originals are never stored or uploaded. Progress-photo previews are fetched with the person's own session into memory and revoked when the screen closes; nothing is cached on the device, so a second person on the same phone never sees them (tested).
- Chat replies render as plain text (an HTML payload in a reply is shown as text and never executes; tested).

## Honest limits
- Browser storage is not encrypted by TrainLuma. Anyone with your unlocked phone and browser can read it. A cached member can keep using local data offline for up to 14 days after the last online check; the server still enforces everything on sync.
- The project owner has database-level access through the Supabase dashboard.
- "Stateless" AI requests can still be retained briefly by the provider for abuse monitoring under its terms.
- The AI can be wrong. It is not medical, dietetic or injury advice.

## Threats considered

| Threat | Mitigation | Status |
|---|---|---|
| Another member reads or edits my records | RLS + membership + composite FKs + definer RPCs with owner checks | tested locally (59 DB tests) |
| Uninvited person signs in | sign-ups off + `shouldCreateUser:false` + approved-membership gate | gate tested; dashboard setting is an owner step |
| Revoked/deleted member keeps a valid token | every policy checks membership on each request | tested (old-token denial) |
| Leaked publishable key | grants + RLS make it identification only | tested at the DB level |
| Leaked Gemini/service key | backend-only secrets, scanner, CSP, rotation guidance | scanner + CSP tested; rotation is an owner action |
| AI cost runaway / replay | locked reservations, idempotency, budget, max calls, no retries | tested with concurrency |
| Prompt injection via chat, notes, meal names, photos | untrusted text passed as JSON data under a trust-boundary system prompt; no tools/URLs; schema 2.0 validation; ref filtering; chat can't return plans or numbers | unit-tested; live model behaviour still to check |
| Forged assistant message / another person's thread | no client write grants; composite thread key; service RPC checks owner | DB-tested |
| Photo leak between people | private bucket, folder-scoped Storage RLS, random names, no device caching | DB- and browser-tested |
| Chat kept forever | 90-day sliding expiry (RLS hides, pg_cron deletes), Delete chat, account deletion | DB-tested; cron schedule needs the live project |
| Unsafe advice | symptom screen, banned-content filter, bounded proposals, approval required | unit-tested; live model behaviour still to check |
| XSS stealing a session | no HTML injection, strict CSP, no third-party scripts | lint-enforced; CSP generated per build |
| Data loss on a phone | atomic local writes, outbox, sync, export/restore | unit + e2e tested |
