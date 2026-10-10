import { supabase } from '@/core/auth/supabase';
import type { PullRow, PushOp, PushResult, SyncTransport } from './engine';

export const supabaseTransport: SyncTransport = {
  async push(ops: PushOp[]): Promise<PushResult[]> {
    const { data, error } = await (await supabase()).rpc('sync_push', { p_ops: ops });
    if (error) throw new Error(error.message);
    return data as PushResult[];
  },
  async pull(since: number, limit: number): Promise<PullRow[]> {
    const { data, error } = await (await supabase()).rpc('sync_pull', { p_since: since, p_limit: limit });
    if (error) throw new Error(error.message);
    return ((data ?? []) as PullRow[]).map((r) => ({ ...r, version: Number(r.version), change_seq: Number(r.change_seq) }));
  },
};

export const NOTICE_VERSION = '2026-10-10';

/** Append a consent decision to the cloud ledger (owner-only insert via RLS). */
export type ConsentType = 'cloud_backup' | 'ai_processing' | 'photo_storage' | 'ai_images';

export async function recordConsent(type: ConsentType, granted: boolean): Promise<void> {
  const { error } = await (await supabase()).from('consent_events').insert({ consent_type: type, granted, notice_version: NOTICE_VERSION });
  if (error) throw new Error(error.message);
}
