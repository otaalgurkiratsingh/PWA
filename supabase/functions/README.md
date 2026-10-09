# Edge Functions

There are none yet (Phase 0). The planned Phase 2 functions are `photo_suggest`, `weekly_review` and `coach_question`. Each must:

1. verify the end-user JWT with Supabase's supported method and take the user id from the verified token only;
2. re-check active membership, the relevant consent, the per-user quota and the global budget (`private.ai_requests`, `private.ai_budget`) inside one transaction with an operation-id idempotency key;
3. use user-scoped database access to build a minimal, redacted context;
4. call Gemini statelessly from the server, with the key from function secrets, no tools or grounding, and bounded output;
5. validate the response against `shared/contracts/coach.ts` before storing or returning it.

Unknown, expired or unapproved callers must consume zero model calls.
