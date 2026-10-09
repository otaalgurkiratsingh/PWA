# Security, threat and data-flow notes

These notes describe the current Phase 0 state and the target design. They are not a security certification. Nothing here makes the app "unhackable", anonymous, or end-to-end encrypted.

## Data flow today (Phase 0)

```
Phone/laptop browser
  └─ React app ──► IndexedDB (one database per profile: records + outbox + rest timer)
  └─ Service worker ──► Cache Storage (app files only: HTML/JS/CSS/icons/manifest)
Nothing leaves the device. No server, no login, no analytics, no AI provider, no third-party scripts.
```

## Target data flow (Phase 1–2, not built yet)

```
Phone ──HTTPS──► Supabase Data API (PostgREST)  ── JWT verified ──► Postgres with RLS + membership
Phone ──HTTPS──► Edge Function (photo_suggest | weekly_review | coach_question)
                   ├─ verify JWT, derive user from token (never from body)
                   ├─ re-check active membership, consent, per-user quota, global budget
                   ├─ build minimal redacted context from that user's rows only
                   ├─ Gemini (server-side key, stateless, no tools/grounding)
                   └─ validate response schema ──► store/return as plain text
```

## Keys and secrets

| Value | Where it may live | Never in |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | browser bundle (safe **only** with the grants + RLS below) | — |
| `GEMINI_API_KEY` | Supabase Edge Function secrets, entered by the owner in the dashboard | any `VITE_` variable, frontend code, source maps, APK, screenshots, chat, git |
| Supabase secret / service-role key | Supabase backend secrets only | same as above |
| Session tokens | Supabase SDK storage in the browser (Phase 1); sensitive | logs, URLs, error reports |

Enforcement:
- `.gitignore` excludes `.env*` (except `.env.example`), exports, photos, dumps and keystores.
- `npm run scan:secrets` checks tracked files, the full git history and `dist/` for key patterns, `VITE_GEMINI`, private-key blocks and source maps. It fails the build if it finds any. A self-test with a planted fake key confirmed that it detects one.
- Production builds disable source maps.

## Database controls (`supabase/migrations/20261009000001_init.sql`)

- `anon` has **no** privileges on any table. `authenticated` gets only the operations each table needs.
- RLS on every public table: `user_id = auth.uid() AND private.is_active_member()` for reads. Inserts use `WITH CHECK`. Updates use both `USING` and `WITH CHECK`.
- Composite `(parent_id, user_id)` foreign keys block cross-owner child references.
- Triggers block owner/id changes, force server versions and timestamps, freeze sealed revisions, and block adding children to sealed revisions.
- Append-only consent ledger. Coach reviews and change proposals are select-only for clients.
- `decide_change_proposal` is `SECURITY DEFINER`, uses `search_path = ''`, checks identity and membership explicitly, revokes `EXECUTE` from `public`/`anon`, and can be decided once.
- `private` schema (membership, AI usage/budget, sync receipts, privacy jobs, deletion ledger) has no client table privileges.

### Isolation evidence (local PostgreSQL 16, `npm run test:db`): 26/26 pass

Tested as the `authenticated`/`anon` roles with simulated verified-JWT claims:
B cannot read, update or delete A's rows, by id or by scan or through child tables. B cannot insert rows owned by A. B cannot attach children to A's parents with either owner value, and cannot re-parent its own child under A's parent. Owner reassignment is rejected. Forged `version`/`created_at` values are ignored. Unapproved, revoked, subject-less and unknown-subject callers see nothing and cannot write. Anon is denied everywhere. Private tables are denied. Sealed revisions are immutable. Consent and food versions cannot be updated or deleted. Skipped sets cannot carry performance. Duplicate set positions are rejected. There is one health value per metric and day. RPC decisions work for the owner only and only once. A grant audit checks for RLS on all tables, no anon grants, and an empty search_path on definer functions.

### Not yet tested (must be done against a real Supabase project before real data)

- JWT signature, issuer, audience and expiry rejection. This is done by Supabase/PostgREST before Postgres sees the request, so a local stand-in cannot prove it.
- Disabled public signup, invitation flow, and redirect URL allow-list.
- Edge Function behaviour, including the zero model calls for unauthorized callers. No functions exist yet.
- Old-JWT denial after account deletion.
- Behaviour under Supabase's real default grants and extensions (re-run the isolation suite there).

## Frontend controls

- No `dangerouslySetInnerHTML`/`innerHTML`. ESLint rules forbid both. All user and imported text renders as React text.
- No analytics, session replay, ads, fonts or scripts from third parties.
- A restrictive CSP and other headers are prepared in `public/_headers` for the Phase 1 host. Add the Supabase origin to `connect-src` then.
- No sensitive query strings: routing uses hash fragments with no data.
- Profiles are separated by database. Phase 1 must also clear owner caches, outbox and auth state on sign-out after preserving unsynced work.

## Honest limits

- IndexedDB is **not** encrypted by this app. Anyone with an unlocked, logged-in phone can see the data. Keep the device locked.
- Clearing site data or uninstalling removes anything not yet exported or synced.
- Hosting and AI providers (later phases) process authorized data under their terms. "Stateless" requests can still be retained for abuse monitoring.

## Threats considered (short)

| Threat | Mitigation | Status |
|---|---|---|
| Another member reads/edits my records | RLS + membership + composite FKs + grants | DB-tested locally |
| Uninvited person signs up | public signup disabled + approved_members gate | gate tested; signup setting is Phase 1 |
| Leaked publishable key | grants + RLS make it identification only | tested at DB level |
| Leaked Gemini/service key | keys only in backend secrets; scanner; rotate on leak | no keys exist yet |
| AI cost runaway | server quotas, reservations, budget table, max-call cap | tables only; logic is Phase 2 |
| Prompt injection via notes/imports | treat as data, schema-validated output, no tools | Phase 2 |
| XSS stealing session | no HTML injection, CSP, no third-party scripts | lint-enforced; CSP pending host |
| Data loss on phone | atomic local writes, export, persistent-storage request | tested in browser/unit tests; restore is Phase 1 |
