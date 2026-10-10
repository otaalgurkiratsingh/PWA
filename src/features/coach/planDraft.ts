import type { LocalProfile } from '@shared/contracts';
import { callAi, type AiResponse } from '@/core/ai/client';
import { newId } from '@/core/ids';
import type { PhotoSlot } from '@/core/photos/progressPhotos';

/**
 * Ask for ONE plan draft. The backend reads the planning answers from the synced profile and
 * refuses a stale profile version, so the latest answers are backed up first.
 */
export async function requestPlanDraft(a: {
  profile: LocalProfile;
  today: string;
  syncNow: () => Promise<void>;
  source: 'onboarding' | 'chat';
  instruction?: string;
  photoIds?: string[];
  inlinePhotos?: { slot: PhotoSlot; image_base64: string }[];
  operationId?: string;
}): Promise<AiResponse> {
  await a.syncNow();
  return callAi(
    { operation: 'onboarding_plan', today: a.today, profile_version: a.profile.profile_version, source: a.source, instruction: a.instruction ?? '', photo_ids: a.photoIds ?? [], inline_photos: a.inlinePhotos ?? [] },
    a.operationId ?? newId(),
    { timezone: a.profile.timezone },
  );
}
