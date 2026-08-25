/* Keeping every phone on the same page.
   A change one person makes should show up on everyone else's screen without
   anyone pulling to refresh. Realtime does that when the websocket is up;
   polling covers the times it isn't. */

import { sb } from './supabase.js';
import { state, setState } from './store.js';

/** Tables where a change means what someone is looking at is now out of date. */
const WATCHED = ['tasks', 'task_photos', 'blocks', 'block_items', 'members', 'activity'];

/** Tables carrying team_id, so the subscription only wakes for your own team. */
const TEAM_SCOPED = ['tasks', 'blocks', 'block_items', 'members', 'activity'];

// Overridable so the test suite doesn't have to sit through a real interval.
const pollMs = (fallback) => Number(window.__LIVE_POLL_MS__) || fallback;
const POLL_WHEN_LIVE = 90_000;      // realtime is up: a slow safety net
const POLL_WHEN_BLIND = 20_000;     // realtime is down: this is the only signal
const SETTLE = 700;                 // let a burst of changes land as one refresh

let channel = null;
let refreshFn = null;
let debounce = null;
let poller = null;
let retry = null;
let attempts = 0;

const isConnected = () => state.live?.status === 'connected';

function scheduleRefresh(reason) {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    if (document.hidden || !navigator.onLine) return;   // catch up when they come back
    setState({ live: { ...state.live, lastChange: Date.now(), reason } });
    refreshFn?.({ quiet: true });
  }, SETTLE);
}

function startPolling() {
  clearInterval(poller);
  poller = setInterval(() => {
    if (document.hidden || !navigator.onLine) return;
    refreshFn?.({ quiet: true });
  }, pollMs(isConnected() ? POLL_WHEN_LIVE : POLL_WHEN_BLIND));
}

function setStatus(status) {
  setState({ live: { ...(state.live || {}), status, tables: WATCHED } });
  startPolling();   // the cadence depends on whether realtime is carrying us
}

/**
 * Subscribes to everything that matters for the team currently open.
 * Safe to call again on a team switch — the old subscription is dropped first.
 */
export function startLiveSync(onRefresh) {
  refreshFn = onRefresh;
  stopLiveSync({ keepPolling: true });

  const teamId = state.team?.id;
  if (!teamId) return;

  setStatus('connecting');

  try {
    channel = sb().channel(`team-${teamId}`);

    for (const table of WATCHED) {
      channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table,
          // task_photos has no team_id of its own; it is reached through its task
          ...(TEAM_SCOPED.includes(table) ? { filter: `team_id=eq.${teamId}` } : {}),
        },
        (payload) => scheduleRefresh(`${payload.table}.${payload.eventType}`)
      );
    }

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        attempts = 0;
        setStatus('connected');
        refreshFn?.({ quiet: true });     // catch anything missed while away
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        setStatus('offline');
        scheduleReconnect();
      }
    });
  } catch {
    setStatus('offline');                 // polling alone will keep it current
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  clearTimeout(retry);
  attempts += 1;
  const wait = Math.min(30_000, 1000 * 2 ** Math.min(attempts, 5));   // 2s → 30s
  retry = setTimeout(() => {
    if (state.team?.id && !document.hidden) startLiveSync(refreshFn);
  }, wait);
}

export function stopLiveSync({ keepPolling = false } = {}) {
  clearTimeout(debounce);
  clearTimeout(retry);
  if (!keepPolling) clearInterval(poller);
  try { channel?.unsubscribe(); } catch { /* already gone */ }
  channel = null;
}

/** Called when the app comes back to the foreground or the network returns. */
export function wakeLiveSync() {
  if (!state.team?.id) return;
  refreshFn?.({ quiet: true });
  if (!isConnected()) startLiveSync(refreshFn);
}
