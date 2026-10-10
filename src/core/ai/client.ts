/**
 * Calls the authenticated `ai` Edge Function. The browser never holds a provider key:
 * it sends the user's session token; the backend verifies it and calls Gemini.
 *
 * - A retry reuses the same operation id, so the backend replays a finished answer instead of
 *   paying for another call or storing another message.
 * - Cancelling only stops WAITING here; a request the backend already sent may still be charged.
 * - Nothing is queued while offline: sensitive AI requests are never sent later in the background.
 */
import type { AiResponse } from '../../../supabase/functions/_shared/aiContracts';
import { functionsUrl, publishableKey, supabase } from '@/core/auth/supabase';
import { newId } from '@/core/ids';
import { deviceTimezone } from '@/core/time/localDate';
import type { PhotoSlot } from '@/core/photos/progressPhotos';

export type { AiResponse, StoredReview, StoredDraft, ChatReply, CoachOutput, PlanDraft as AiPlanDraft, NotebookPhotoOutput } from '../../../supabase/functions/_shared/aiContracts';
export { reviewOutputFromStored, MAX_CHAT_CHARS } from '../../../supabase/functions/_shared/aiContracts';

export type AiBody =
  | { operation: 'weekly_review'; today: string }
  | { operation: 'coach_question'; today: string; thread_id: string | null; message: string }
  | { operation: 'onboarding_plan'; today: string; profile_version: number; source?: 'onboarding' | 'chat'; instruction?: string; photo_ids?: string[]; inline_photos?: { slot: PhotoSlot; image_base64: string }[] }
  | { operation: 'photo_suggest'; kind: 'food' | 'notebook'; image_base64: string };

const OFFLINE = 'You’re offline. The coach needs a connection; logging still works.';

export async function callAi(body: AiBody, operationId: string = newId(), opts: { signal?: AbortSignal; timezone?: string } = {}): Promise<AiResponse> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { status: 'error', error: 'provider_error', message: OFFLINE };
  const { data } = await (await supabase()).auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { status: 'error', error: 'unauthenticated', message: 'Please sign in again.' };
  try {
    const res = await fetch(functionsUrl('ai'), {
      method: 'POST',
      signal: opts.signal,
      headers: { authorization: `Bearer ${token}`, apikey: publishableKey(), 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, operation_id: operationId, timezone: opts.timezone ?? deviceTimezone() }),
    });
    const json = (await res.json().catch(() => null)) as AiResponse | null;
    if (json && typeof json === 'object' && 'status' in json) return json;
    return { status: 'error', error: 'provider_error', message: 'The coach is unavailable right now. Logging still works.' };
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      return { status: 'error', error: 'provider_error', message: 'Stopped waiting. If the coach already started, the answer may still appear in this chat, and the request may still count.' };
    }
    return { status: 'error', error: 'provider_error', message: navigator.onLine ? 'The coach is unavailable right now. Logging still works.' : OFFLINE };
  }
}

/** Plain-language text for any refusal or failure. */
export function aiErrorText(r: AiResponse): string {
  if (r.status === 'error') {
    if (r.error === 'not_configured') return 'The coach isn’t switched on yet. The owner needs to add the AI settings (see the owner guide). Logging works as usual.';
    if (r.error === 'ai_paused') return 'The coach is paused for this month’s budget. Logging works as usual.';
    return r.message;
  }
  if (r.status === 'insufficient_data' || r.status === 'safety') return r.message;
  return '';
}
