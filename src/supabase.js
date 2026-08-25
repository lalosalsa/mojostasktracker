import { createClient } from '@supabase/supabase-js';
import { getSupabaseConfig } from './config.js';

let client = null;

/** Single shared client. Sessions persist and auto-refresh, so a phone that
    signed in once stays signed in for good. */
export function sb() {
  if (client) return client;
  const { url, anonKey } = getSupabaseConfig();
  if (!url || !anonKey) throw new Error('Supabase is not configured yet.');
  client = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'mtt.auth',
      flowType: 'pkce',
    },
    global: { headers: { 'x-application-name': 'mojos-task-tracker' } },
    realtime: { params: { eventsPerSecond: 3 } },
  });
  return client;
}

export function resetClient() {
  client = null;
}

/** Turns a Postgres/PostgREST error into something a person can act on. */
export function friendlyError(error) {
  if (!error) return 'Something went wrong.';
  const msg = String(error.message || error);
  if (/photo of the finished work/i.test(msg)) {
    return 'Add at least one photo of the finished work before marking this task done.';
  }
  if (/Only a manager/i.test(msg)) return msg.replace(/^.*?(Only a manager.*?)$/s, '$1');
  if (/row-level security|violates row-level/i.test(msg)) {
    return 'Your account does not have permission for that. Ask your manager.';
  }
  if (/JWT|token is expired|Invalid Refresh Token/i.test(msg)) {
    return 'Your session expired — please sign in again.';
  }
  if (/Failed to fetch|NetworkError|network/i.test(msg)) {
    return 'Cannot reach the server. Check your connection and try again.';
  }
  if (/Email rate limit|over_email_send_rate_limit/i.test(msg)) {
    return 'Too many sign-in emails just went out. Wait a minute and try again.';
  }
  if (/Token has expired or is invalid|otp_expired/i.test(msg)) {
    return 'That code expired. Send yourself a fresh one.';
  }
  if (/Signups not allowed|signup_disabled/i.test(msg)) {
    return 'New sign-ups are turned off for this workspace. Ask your manager for an invite.';
  }
  return msg;
}
