/**
 * Reads and owner-only actions for coach data stored in the private project. Everything goes
 * through the person's own session (RLS): chats, drafts, reviews, memories, photos.
 * Clients never write model output; they can only delete their own chats, decide drafts,
 * and confirm or delete memories.
 */
import type { CoachOutput } from '../../../supabase/functions/_shared/aiContracts';
import { CoachOutput as CoachOutputSchema, PlanDraft as PlanDraftSchema, type PlanDraft } from '../../../supabase/functions/_shared/aiContracts';
import { supabase } from '@/core/auth/supabase';
import { deviceTimezone } from '@/core/time/localDate';

export interface ThreadSummary { id: string; title: string; updated_at: string; expires_at: string }
export interface ChatMessage { id: string; role: 'user' | 'assistant'; content: string; output: CoachOutput | null; created_at: string; model_id: string | null }
export interface DraftRow { id: string; created_at: string; status: string; profile_version: number; plan: PlanDraft; response: CoachOutput | null; model_id: string; source: string }
export interface Usage {
  photo_today: number; questions_today: number; reviews_week: number; plans_week: number; has_first_plan: boolean;
  limits: { photo_per_day: number; question_per_day: number; review_per_week: number; plan_regen_per_week: number };
}

export async function listThreads(): Promise<ThreadSummary[]> {
  const { data, error } = await (await supabase()).from('coach_threads').select('id, title, updated_at, expires_at').order('updated_at', { ascending: false }).limit(30);
  if (error) throw new Error('Couldn’t load your chats.');
  return (data ?? []) as ThreadSummary[];
}

export async function threadMessages(threadId: string): Promise<ChatMessage[]> {
  const { data, error } = await (await supabase()).from('coach_messages').select('id, role, content, response, created_at, model_id')
    .eq('thread_id', threadId).order('created_at', { ascending: true }).limit(200);
  if (error) throw new Error('Couldn’t load this chat.');
  return (data ?? []).map((m) => {
    const parsed = m.response ? CoachOutputSchema.safeParse(m.response) : null;
    return { id: m.id as string, role: m.role as 'user' | 'assistant', content: m.content as string, output: parsed?.success ? parsed.data : null, created_at: m.created_at as string, model_id: (m.model_id as string | null) ?? null };
  });
}

/** Delete one chat, or every chat when `threadId` is null. Confirmed memories are kept. */
export async function deleteThreads(threadId: string | null): Promise<number> {
  const { data, error } = await (await supabase()).rpc('delete_coach_thread', { p_thread_id: threadId });
  if (error) throw new Error('Couldn’t delete. Check your connection and try again.');
  return Number(data ?? 0);
}

export async function aiUsage(): Promise<Usage | null> {
  const { data } = await (await supabase()).rpc('my_ai_usage', { p_timezone: deviceTimezone() });
  return (data as Usage | null) ?? null;
}

function toDraft(row: Record<string, unknown>): DraftRow | null {
  const plan = PlanDraftSchema.safeParse(row.plan);
  if (!plan.success) return null;
  const resp = CoachOutputSchema.safeParse(row.response);
  return {
    id: row.id as string, created_at: row.created_at as string, status: row.status as string, profile_version: Number(row.profile_version),
    plan: plan.data, response: resp.success ? resp.data : null, model_id: row.model_id as string, source: row.source as string,
  };
}

export async function getDraft(id: string): Promise<DraftRow | null> {
  const { data, error } = await (await supabase()).from('plan_drafts').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error('Couldn’t load that draft.');
  return data ? toDraft(data) : null;
}

export async function latestOpenDraft(): Promise<DraftRow | null> {
  const { data } = await (await supabase()).from('plan_drafts').select('*').eq('status', 'draft').order('created_at', { ascending: false }).limit(1);
  return data?.[0] ? toDraft(data[0]) : null;
}

export async function decideDraft(id: string, decision: 'accepted' | 'rejected', profileVersion: number): Promise<{ status: 'accepted' | 'rejected' | 'stale' | 'not_found'; plan?: PlanDraft }> {
  const { data, error } = await (await supabase()).rpc('decide_plan_draft', { p_draft_id: id, p_decision: decision, p_profile_version: profileVersion });
  if (error) throw new Error('Couldn’t record your decision. Try again.');
  const r = data as { status: 'accepted' | 'rejected' | 'stale' | 'not_found'; plan?: unknown };
  const plan = r.plan ? PlanDraftSchema.safeParse(r.plan) : null;
  return { status: r.status, plan: plan?.success ? plan.data : undefined };
}

export async function confirmMemory(fact: string): Promise<void> {
  const { error } = await (await supabase()).from('user_confirmed_memory').insert({ fact: fact.trim().slice(0, 500) });
  if (error) throw new Error('Couldn’t save that.');
}
