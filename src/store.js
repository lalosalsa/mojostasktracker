/* Tiny observable app state — no framework needed. */

const listeners = new Set();

export const state = {
  ready: false,
  session: null,
  me: null,      // the signed-in member row
  team: null,    // their team, once they have one
  route: '',
  online: navigator.onLine,
  pendingUploads: 0,
  installEvent: null,   // captured beforeinstallprompt
};

export function setState(patch) {
  Object.assign(state, patch);
  emit();
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit() {
  for (const fn of [...listeners]) {
    try { fn(state); } catch (err) { console.error(err); }
  }
}

export const isManager = () => state.me?.role === 'manager' && state.me?.status === 'active';
export const isActive = () => state.me?.status === 'active';
export const hasTeam = () => Boolean(state.me?.team_id);
