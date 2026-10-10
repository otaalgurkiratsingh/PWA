# Edge Functions

## `ai`: weekly_review · coach_question · photo_suggest

- `ai/index.ts` holds the wiring only: Deno, Supabase clients and environment variables.
- `_shared/handler.ts` makes every decision (unit-tested in `handler.test.ts`).
- `_shared/aiContracts.ts` holds the typed request/response schemas, which the app also uses.
- `_shared/summary.ts` builds the minimal, deterministic context from the caller's own documents.
- `_shared/gemini.ts` is the stateless adapter: `generateContent` by default, or the Interactions API with `store=false`.
- `_shared/image.ts` does bounded JPEG validation and rejects EXIF.
- `_shared/prompts.ts` has the system instructions, the urgent-symptom screen and the unsafe-text filter.

**Order of checks:** verified token → bounded, schema-valid body → membership + AI consent (as the caller) → configured key and prices → no-model shortcuts (safety, insufficient data, bad photo) → transactional reservation (`ai_reserve`) → one model call → output validation and grounding filter → `ai_finish`.

Deploy with `supabase functions deploy ai`. Secrets are listed at the top of `ai/index.ts` and in `docs/OWNER_GUIDE.md` §2d.

Local checks:
- `npx vitest run supabase/functions` runs the handler, adapter, image and summary tests.
- `DENO=$(which deno) npm run smoke:ai` runs the real entry point in Deno against a mock Supabase.
- `deno check --config supabase/functions/ai/deno.json supabase/functions/ai/index.ts` typechecks it.
