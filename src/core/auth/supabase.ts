import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Browser Supabase client. Only the public project URL and the PUBLISHABLE key are used here;
 * they identify the project and are safe only together with the database grants + RLS.
 * Sessions persist in this browser's storage under one key (see SECURITY_AND_DATA_FLOW.md).
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const AUTH_STORAGE_KEY = 'rozana-auth';

export function backendConfigured(): boolean {
  return Boolean(url && key && /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url.replace(/\/$/, '')) && !key.includes('replace_me'));
}

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!backendConfigured()) throw new Error('Sign-in is not set up yet.');
  client ??= createClient(url!, key!, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: AUTH_STORAGE_KEY, flowType: 'pkce' },
  });
  return client;
}

export function functionsUrl(name: string): string {
  return `${url!.replace(/\/$/, '')}/functions/v1/${name}`;
}

export function publishableKey(): string {
  return key!;
}
