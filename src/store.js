/* Tiny observable app state — no framework needed. */

const listeners = new Set();

export const state = {
  ready: false,
  session: null,
  profile: null,
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

export const isAdmin = () => state.profile?.role === 'admin' && state.profile?.status === 'active';
export const isActive = () => state.profile?.status === 'active';
