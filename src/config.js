/* Where the Supabase project lives.
   Values are baked in at build time from Vercel env vars; if the build ran
   without them the app falls back to a one-time setup screen and remembers the
   keys in localStorage, so a fresh clone still runs locally. */

/* global __SUPABASE_URL__, __SUPABASE_ANON_KEY__, __BUILD_ID__, __APP_NAME__ */
const BUILT_URL = typeof __SUPABASE_URL__ === 'string' ? __SUPABASE_URL__ : '';
const BUILT_KEY = typeof __SUPABASE_ANON_KEY__ === 'string' ? __SUPABASE_ANON_KEY__ : '';

export const BUILD_ID = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

const LS_URL = 'mtt.supabaseUrl';
const LS_KEY = 'mtt.supabaseKey';

const read = (k) => {
  try { return localStorage.getItem(k) || ''; } catch { return ''; }
};

export function getSupabaseConfig() {
  return {
    url: BUILT_URL || read(LS_URL),
    anonKey: BUILT_KEY || read(LS_KEY),
    fromBuild: Boolean(BUILT_URL && BUILT_KEY),
  };
}

export function saveSupabaseConfig(url, anonKey) {
  localStorage.setItem(LS_URL, url.trim().replace(/\/+$/, ''));
  localStorage.setItem(LS_KEY, anonKey.trim());
}

export function clearSupabaseConfig() {
  localStorage.removeItem(LS_URL);
  localStorage.removeItem(LS_KEY);
}

export const isConfigured = () => {
  const c = getSupabaseConfig();
  return Boolean(c.url && c.anonKey);
};

export const APP_NAME = typeof __APP_NAME__ === 'string' && __APP_NAME__ ? __APP_NAME__ : 'Task Tracker';
export const PHOTO_BUCKET = 'task-photos';
