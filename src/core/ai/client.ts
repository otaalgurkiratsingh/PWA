/**
 * Calls the authenticated `ai` Edge Function. The browser never holds a provider key:
 * it sends the user's session token; the backend verifies it and calls Gemini.
 */
import type { AiResponse } from '../../../supabase/functions/_shared/aiContracts';
import { functionsUrl, publishableKey, supabase } from '@/core/auth/supabase';
import { newId } from '@/core/ids';

export type { AiResponse, StoredReview, AnswerOutput, FoodPhotoOutput, NotebookPhotoOutput } from '../../../supabase/functions/_shared/aiContracts';

type AiBody =
  | { operation: 'weekly_review'; today: string }
  | { operation: 'coach_question'; today: string; question: string }
  | { operation: 'photo_suggest'; kind: 'food' | 'notebook'; image_base64: string; presets: { id: string; name: string }[] };

export async function callAi(body: AiBody, operationId: string = newId()): Promise<AiResponse> {
  const { data } = await supabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { status: 'error', error: 'unauthenticated', message: 'Please sign in again.' };
  try {
    const res = await fetch(functionsUrl('ai'), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, apikey: publishableKey(), 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, operation_id: operationId }),
    });
    const json = (await res.json().catch(() => null)) as AiResponse | null;
    if (json && typeof json === 'object' && 'status' in json) return json;
    return { status: 'error', error: 'provider_error', message: 'The coach is unavailable right now. Logging still works.' };
  } catch {
    return { status: 'error', error: 'provider_error', message: navigator.onLine ? 'The coach is unavailable right now. Logging still works.' : 'You’re offline. The coach needs a connection; logging still works.' };
  }
}
