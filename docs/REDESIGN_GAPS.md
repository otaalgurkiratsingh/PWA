# Redesign gap list (pass A, 2026-10-09) — all rows addressed; see BUILD_STATUS.md for evidence

This list compares what the Phase 0 build does with what CLAUDE_CODE_REDESIGN_AND_COMPLETION_PROMPT.md asks for. It is based on the code, a fresh run of the tests, and the owner's phone screenshots: the Progress, meal-card/portion-sheet and workout screens, plus the Spotify and Headspace references. The Notion reference was not among the attachments received.

| Area | Phase 0 state | Gap |
|---|---|---|
| Visual system | Warm-white/green tokens, but system dark mode applies on first launch, so the owner saw an all-dark app. A big yellow Demo banner. Identical outlined icons. The egg glyph reads as an avocado. | Default to light; sun/moon toggle with no theme flash; blue primary, food peach, training mint, coach lavender; food-specific illustrations; compact Demo chip |
| Language | "V1", "W", "RIR", "calibrated portion", algorithm paragraph above the weight chart, "synthetic" | Everyday wording; details behind Info |
| Navigation | Today/Meals/Train/Progress, Settings via avatar | Rename to Today/Food/Workout/Progress; Coach reached from Today and contextual buttons |
| Food | Tiles with "Amount…" footers; no create/edit of meals; no date or meal-type choice; photo is an explanation only | Carousel of usual meals, add sheet, Add food (Usual/Create/Photo), meal-type sections, meal/recipe editor with measured serving, favourites, own photo (opt-in), repeat |
| Workout | Fixed Push/Pull/Legs demo program; no editing; every exercise expanded; W/RIR rows | My plan + editor (days, weekdays/rotation, library + custom exercises, sets), versioned saves with preview; focused active workout, add set, "Something hurts", finish summary with reopen |
| Progress | Explanation-first, small plots, dense labels | Period control, metric tiles, large weight chart with readout, workout calendar, exercise picker, Log weight sheet, details on demand |
| Login | None (local demo only) | Supabase email-code sign-in (`shouldCreateUser:false`), membership check, revoked state, session restore without a flash, sign-out that protects unsynced work, onboarding |
| Cloud | Migration exists but no client sync | Authenticated sync (push/pull, idempotent receipts, conflict copies, tombstones), consent ledger use, account deletion |
| AI | Contract only | `ai` Edge Function (weekly_review, coach_question, photo_suggest) with JWT verification, membership and consent checks, transactional quotas/budget, a stateless Gemini adapter and validated output; Coach UI with proposals and memory |
| Backup | Export only | Restore from export, tested |
| Hosting | `_headers` CSP allows only `'self'`, which would block Supabase on the owner's Netlify site | CSP generated at build with the exact Supabase origin |

Preserved and re-verified: nutrition maths, atomic local save + outbox, the timer end timestamp, per-profile databases, and the 26 database isolation tests (re-run 26/26 before changes).
