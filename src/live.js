/* Keeping every phone on the same page.
   A change one person makes should show up on everyone else's screen without
   anyone pulling to refresh. Realtime does that when the websocket is up;
   polling covers the times it isn't. */

import { sb } from './supabase.js';
import { state, setState } from './store.js';
import { forgetFilledDays } from './data.js';

/** Tables where a change means what someone is looking at is now out of date. */
const WATCHED = ['tasks', 'task_photos', 'blocks', 'block_items', 'members', 'activity'];

/** Tables carrying team_id, so the subscription only wakes for your own team. */
const TEAM_SCOPED = ['tasks', 'blocks', 'block_items', 'members', 'activity'];

// Overridable so the test suite doesn't have to sit through a real interval.
const pollMs = (fallback) => Number(window.__LIVE_POLL_MS__) || fallback;
const POLL_WHEN_LIVE = 90_000;      // realtime is up: a slow safety net
const POLL_WHEN_BLIND = 20_000;     // realtime is down: this is the only signal
const SETTLE = 700;                 // let a burst of changes land as one refresh
const MIN_GAP = 3000;               // hard floor between repaints, whatever fires

let lastRefresh = 0;

let channel = null;
let refreshFn = null;
let debounce = null;
let poller = null;
let retry = null;
let attempts = 0;

const isConnected = () => state.live?.status === 'connected';

/**
 * Presence noise, not content: "last seen" ticks over constantly and nobody is
 * looking at a screen that redraws because someone opened the app.
 */
function isHeartbeatOnly(payload) {
  if (payload.table !== 'members' || payload.eventType !== 'UPDATE') return false;
  const before = payload.old || {};
  const after = payload.new || {};
  const changed = Object.keys(after).filter((k) => String(after[k]) !== String(before[k]));
  return changed.length > 0 && changed.every((k) => k === 'last_seen_at');
}

function scheduleRefresh(payload) {
  if (isHeartbeatOnly(payload)) return;

  // Someone changed the day's plan on another phone: what today should contain
  // has changed too, so the coming refresh must work it out again.
  if (payload.table === 'blocks' || payload.table === 'block_items') forgetFilledDays();

  clearTimeout(debounce);
  // A repaint can never come round faster than this, no matter what fires it.
  // Without a floor, any write that feeds back into a subscription flickers the
  // screen — which is exactly what "last seen" did once members was watched.
  const wait = Math.max(SETTLE, MIN_GAP - (Date.now() - lastRefresh));
  debounce = setTimeout(() => {
    if (document.hidden || !navigator.onLine) return;   // catch up when they come back
    lastRefresh = Date.now();
    setState({
      live: { ...state.live, lastChange: lastRefresh, reason: `${payload.table}.${payload.eventType}` },
    });
    refreshFn?.({ quiet: true });
  }, wait);
}

/* Realtime can't reach the test harness, so the suite feeds change events
   through this instead. Harmless in production: it only runs what a real
   websocket message would have run. */
if (typeof window !== 'undefined') window.__LIVE_EMIT__ = (payload) => scheduleRefresh(payload);

function startPolling() {
  clearInterval(poller);
  poller = setInterval(() => {
    if (document.hidden || !navigator.onLine) return;
    if (Date.now() - lastRefresh < MIN_GAP) return;
    lastRefresh = Date.now();
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
        (payload) => scheduleRefresh(payload)
      );
    }

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        attempts = 0;
        setStatus('connected');
        lastRefresh = Date.now();
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
  if (Date.now() - lastRefresh >= MIN_GAP) {
    lastRefresh = Date.now();
    refreshFn?.({ quiet: true });
  }
  if (!isConnected()) startLiveSync(refreshFn);
}
