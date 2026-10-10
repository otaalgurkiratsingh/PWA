# Security, threat and data-flow notes

These notes describe what is built and what has been tested. They are not a certification. Rozana is not anonymous, not end-to-end encrypted and not "unhackable". Hosting and AI providers process the data you authorise.

## Data flow

```
Phone browser (PWA)
 ├─ IndexedDB: one database per account (journal records + outbox + rest-timer end time + sync state)
 ├─ Cache Storage: app files only (service worker never caches API responses, health data or photos)
 ├─ HTTPS → Supabase Auth (email one-time code; shouldCreateUser:false; session in this browser's storage)
 ├─ HTTPS → Supabase Data API, as the signed-in user
 │     sync_push / sync_pull RPCs → public.journal_documents   (RLS: owner + active membership)
 │     consent_events, user_confirmed_memory, coach_reviews, change_proposals (RLS)
 └─ HTTPS → Edge Function "ai" with the user's access token (never a provider key)
          1 verify JWT (getClaims) → identity = token subject; request body never names a user
          2 bounded JSON body (≤ 2.5 MB), schema-validated
          3 membership + AI consent checked with the CALLER's token (RLS applies)
          4 provider key + prices configured? else "not configured" (no reservation, no call)
          5 urgent-symptom questions → safety reply, no model call
          6 photos: JPEG magic bytes, ≤ 1.5 MB, ≤ 1600 px, no EXIF/APP1 block
          7 minimal context computed from the caller's own documents (no name/email)
          8 ai_reserve (service role, advisory-locked): idempotent operation id, per-user limits,
            monthly budget, max calls → only then one model call, no automatic retries
          9 Gemini (generateContent by default; Interactions API with store=false optional):
            no tools, no grounding, no chaining, low thinking, ≤ 2,048 output tokens, 25 s timeout
         10 output validated by schema; ungrounded evidence refs and unsafe text removed;
            target proposals bounded (1,200–4,500 kcal; 40–300 g protein) and only proposed
         11 ai_finish records actual cost (or the reservation if usage is unknown)
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

Migrations: `20261009000001_init.sql` and `20261009000002_sync_auth_ai.sql`.
- `anon` has no table privileges. `authenticated` gets only the operations each table needs. Every public table has RLS on.
- Policies require `user_id = auth.uid()` **and** `private.is_active_member()`.
- Composite `(id, user_id)` foreign keys prevent cross-owner references. Triggers make id, owner, version and timestamps server-controlled and freeze sealed revisions.
- `journal_documents` is **read-only** for clients. Writes go only through `sync_push` (`SECURITY DEFINER`, empty `search_path`). It checks membership, requires `body.owner_id = auth.uid()`, limits 100 ops and 200 KB per document, records idempotent receipts, detects stale versions (keeping the device's own unacknowledged writes as non-conflicts) and allocates a per-user change sequence in the same transaction.
- `ai_reserve`/`ai_finish` are executable only by `service_role`. They take a global and a per-user advisory lock, so concurrent requests cannot both pass a limit.
- `request_account_deletion` stops access first (membership → `deleting`), deletes the member's rows, and records a privacy job and deletion ledger.
- The `private` schema (membership, AI usage/budget/limits, sync receipts and counters, privacy jobs, deletion ledger) has no client table privileges.

## Evidence (run 2026-10-09)

| Area | How | Result |
|---|---|---|
| Member isolation, grants, immutability, approval RPC | `npm run test:db` (local PostgreSQL 16 with a Supabase auth stand-in, simulated verified-JWT claims) | 40/40 across both migrations |
| Sync rules, forged owners, oversize/unknown collections, membership, deletion with old token, per-user memory, AI quotas under 10 concurrent connections, replay, budget | same suite | included above |
| Mutation checks | membership check removed, default grants kept, single-column FK, advisory locks removed, owner check removed | each made specific tests fail |
| AI handler: refusals before reservation/model, safety screen, grounding filter, proposal bounds, photo validation, adapter request shape (key in header, no tools, `store:false`), timeouts | `vitest` (`supabase/functions/_shared/handler.test.ts`) | 25/25 |
| Real Edge Function entry point in Deno 2.9.6 vs. mock Supabase | `npm run smoke:ai` | 7/7 (no token / bad token / rejected token → 401 with no backend call; foreign origin → 403; unconfigured → 503 with no reservation; membership read with caller's token) |
| Browser sign-in, membership denial, session restore without flash, sync ownership, consent, coach request shape | Playwright against a scripted fake Supabase (`tests/e2e/auth.spec.ts`) | 5/5 |

### Not yet verified (needs the owner's live project)
- Real Supabase JWT signature, issuer, audience and expiry handling, and `getClaims` with the project's signing keys. Locally these are simulated or mocked.
- Disabled sign-ups, the email template sending a code, SMTP delivery, rate limits and redirect URLs.
- Running the migrations on Supabase's real role and default-privilege setup. Re-run the isolation suite there before real data.
- The live Gemini call: model availability, the exact `generateContent` / Interactions response and usage fields, actual prices, and the provider's retention terms for your account.
- Edge runtime limits (memory, CPU, request size) with real photos.
- Physical phones: Samsung/Android install, screen lock during a workout, iPhone.

## Frontend controls
- There is no `dangerouslySetInnerHTML` or `innerHTML`; lint enforces this. AI output and journal text render as plain React text.
- No analytics, session replay, ads, remote fonts or third-party scripts. The theme script is a same-origin file, so the CSP keeps `script-src 'self'`.
- Each account has its own IndexedDB. A new account never inherits demo data. Signing out warns about anything not yet backed up and can remove the phone's copy once everything is backed up.
- The service worker never replaces the app mid-workout. It reloads only after the person taps Update. This was a real bug: the first install used to reload the page; the e2e tests found and fixed it.
- Photos are cropped, downscaled and re-encoded on the phone (dropping metadata). Originals are never stored or uploaded.

## Honest limits
- Browser storage is not encrypted by Rozana. Anyone with your unlocked phone and browser can read it. A cached member can keep using local data offline for up to 14 days after the last online check; the server still enforces everything on sync.
- The project owner has database-level access through the Supabase dashboard.
- "Stateless" AI requests can still be retained briefly by the provider for abuse monitoring under its terms.
- The AI can be wrong. It is not medical, dietetic or injury advice.

## Threats considered

| Threat | Mitigation | Status |
|---|---|---|
| Another member reads or edits my records | RLS + membership + composite FKs + definer RPCs with owner checks | tested locally (40 DB tests) |
| Uninvited person signs in | sign-ups off + `shouldCreateUser:false` + approved-membership gate | gate tested; dashboard setting is an owner step |
| Revoked/deleted member keeps a valid token | every policy checks membership on each request | tested (old-token denial) |
| Leaked publishable key | grants + RLS make it identification only | tested at the DB level |
| Leaked Gemini/service key | backend-only secrets, scanner, CSP, rotation guidance | scanner + CSP tested; rotation is an owner action |
| AI cost runaway / replay | locked reservations, idempotency, budget, max calls, no retries | tested with concurrency |
| Prompt injection via notes, imports, photos | data passed as quoted JSON; no tools; schema validation; ref filtering | unit-tested |
| Unsafe advice | symptom screen, banned-content filter, bounded proposals, approval required | unit-tested; live model behaviour still to check |
| XSS stealing a session | no HTML injection, strict CSP, no third-party scripts | lint-enforced; CSP generated per build |
| Data loss on a phone | atomic local writes, outbox, sync, export/restore | unit + e2e tested |
