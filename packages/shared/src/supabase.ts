import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const clients = new Map<string, SupabaseClient>();

/**
 * Get the operations database client (solosolutions_ops).
 * Used by all agents for tickets, runs, knowledge base, etc.
 */
export function getOpsClient(): SupabaseClient {
  const key = 'ops';
  if (!clients.has(key)) {
    const url = process.env.SUPABASE_OPS_URL;
    const serviceKey = process.env.SUPABASE_OPS_SERVICE_KEY;
    if (!url || !serviceKey) {
      throw new Error('Missing SUPABASE_OPS_URL or SUPABASE_OPS_SERVICE_KEY');
    }
    clients.set(key, createClient(url, serviceKey));
  }
  return clients.get(key)!;
}

/**
 * Get the platform database client (the shared Supabase project).
 * All verticals share a single DB — use this for customer data,
 * support tickets, professional profiles, etc.
 * Falls back to SUPABASE_SOLOLAWYER_* env vars for backwards compat.
 */
export function getPlatformClient(): SupabaseClient {
  const key = 'platform';
  if (!clients.has(key)) {
    const url = process.env.SUPABASE_PLATFORM_URL || process.env.SUPABASE_SOLOLAWYER_URL;
    const serviceKey = process.env.SUPABASE_PLATFORM_SERVICE_KEY || process.env.SUPABASE_SOLOLAWYER_SERVICE_KEY;
    if (!url || !serviceKey) {
      throw new Error('Missing SUPABASE_PLATFORM_URL or SUPABASE_SOLOLAWYER_URL');
    }
    clients.set(key, createClient(url, serviceKey));
  }
  return clients.get(key)!;
}

/**
 * Get a vertical's Supabase client (e.g. SoloLawyerAI's database).
 * @deprecated Use getPlatformClient() — all verticals share one DB.
 */
export function getVerticalClient(vertical: string): SupabaseClient {
  if (!clients.has(vertical)) {
    const envPrefix = `SUPABASE_${vertical.toUpperCase()}`;
    const url = process.env[`${envPrefix}_URL`];
    const serviceKey = process.env[`${envPrefix}_SERVICE_KEY`];
    if (!url || !serviceKey) {
      throw new Error(`Missing ${envPrefix}_URL or ${envPrefix}_SERVICE_KEY`);
    }
    clients.set(vertical, createClient(url, serviceKey));
  }
  return clients.get(vertical)!;
}
