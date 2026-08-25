/* Boot, session handling, chrome (header + tabs), and routing. */

import './ui.js';
import { el, esc, toast, initials } from './ui.js';
import { isConfigured, APP_NAME, BUILD_ID } from './config.js';
import { sb, friendlyError } from './supabase.js';
import { state, setState, subscribe, isManager } from './store.js';
import { route, setNotFound, startRouter, navigate, parse, resolve } from './router.js';
import * as data from './data.js';

import { setupView, signInView, teamSetupView, disabledView, errorView } from './views/auth.js';
import { todayView } from './views/today.js';
import { historyView } from './views/history.js';
import { meView } from './views/me.js';
import { dashboardView } from './views/dashboard.js';
import { reviewView } from './views/review.js';
import { teamView, } from './views/team.js';
import { taskBoardView, openTaskEditor } from './views/tasksBoard.js';
import { reportsView } from './views/reports.js';
import { blocksView } from './views/blocks.js';

/** Always resolve the live root — the shell is swapped out on sign-in/out, so
    a cached reference goes stale and later renders land in a detached tree. */
const root = () => document.getElementById('app');
let shell = null;
let realtimeChannel = null;
let mountedUserId = null;

/* ------------------------------------------------------------------ chrome */
const TABS = {
  employee: [
    { path: '/today', label: 'Today', icon: '☑️' },
    { path: '/history', label: 'History', icon: '🗓' },
    { path: '/me', label: 'Me', icon: '👤' },
  ],
  manager: [
    { path: '/dashboard', label: 'Overview', icon: '📊' },
    { path: '/review', label: 'Review', icon: '🔍' },
    { path: '/blocks', label: 'Blocks', icon: '🧱' },
    { path: '/team', label: 'Team', icon: '👷' },
    { path: '/me', label: 'More', icon: '⋯' },
  ],
};

function buildShell() {
  const tabs = isManager() ? TABS.manager : TABS.employee;

  const node = el(`
    <div class="app">
      <header class="appbar">
        <div style="min-width:0">
          <h1 data-title>${esc(state.team?.name || APP_NAME)}</h1>
          <div class="sub" data-sub></div>
        </div>
        <span class="spacer"></span>
        <button class="appbar-btn" data-refresh title="Refresh">⟳</button>
        <button class="appbar-btn" data-profile title="Your account">
          ${esc(initials(state.me?.name || state.me?.email))}
        </button>
      </header>
      <div class="offline-bar" hidden data-offline>Offline — changes will need a connection to save</div>
      <main class="view" id="view"></main>
      <nav class="tabbar">
        ${tabs.map((t) => `<button data-tab="${t.path}"><span class="ic">${t.icon}</span><span>${esc(t.label)}</span></button>`).join('')}
      </nav>
    </div>`);

  node.querySelector('[data-refresh]').onclick = () => resolve();
  node.querySelector('[data-profile]').onclick = () => navigate('/me');
  node.querySelectorAll('[data-tab]').forEach((b) => {
    b.onclick = () => navigate(b.dataset.tab);
  });

  root().replaceWith(node);
  node.id = 'app';
  return node;
}

function paintChrome() {
  if (!shell) return;
  const { path } = parse();
  shell.querySelectorAll('[data-tab]').forEach((b) => {
    b.classList.toggle('active', path.startsWith(b.dataset.tab));
  });
  const titles = {
    '/today': "Today's work",
    '/history': 'Your history',
    '/me': 'Your account',
    '/dashboard': 'Overview',
    '/review': 'Photo review',
    '/tasks': 'All tasks',
    '/team': 'Your team',
    '/reports': 'Reports',
    '/blocks': "The day's blocks",
  };
  shell.querySelector('[data-title]').textContent = titles[path] || state.team?.name || APP_NAME;
  const name = state.me?.name || state.me?.email || '';
  shell.querySelector('[data-sub]').textContent =
    isManager() ? `${name} · Manager` : `${name}${state.team ? ` · ${state.team.name}` : ''}`;
  shell.querySelector('[data-offline]').hidden = state.online;
}

/* ------------------------------------------------------------------ routes */
function guarded(view, { managersOnly = false } = {}) {
  return async (params) => {
    if (!state.me || !state.me.team_id) return;
    if (managersOnly && !isManager()) return navigate('/today', { replace: true });
    const container = shell?.querySelector('#view');
    if (!container) return;
    paintChrome();
    window.scrollTo({ top: 0 });
    try {
      await view(container, params);
    } catch (err) {
      console.error(err);
      container.innerHTML = '';
      container.appendChild(el(`
        <div class="banner danger">
          <span class="ic">⚠️</span>
          <div><strong>Could not load this screen</strong><br>${esc(friendlyError(err))}</div>
        </div>`));
    }
  };
}

function registerRoutes() {
  route('/today', guarded(todayView));
  route('/history', guarded(historyView));
  route('/me', guarded(meView));

  route('/dashboard', guarded(dashboardView, { managersOnly: true }));
  route('/review', guarded(reviewView, { managersOnly: true }));
  route('/tasks', guarded(taskBoardView, { managersOnly: true }));
  route('/team', guarded(teamView, { managersOnly: true }));
  route('/reports', guarded(reportsView, { managersOnly: true }));
  route('/blocks', guarded(blocksView, { managersOnly: true }));
  route('/new-task', guarded(async (container) => {
    await taskBoardView(container, {});
    openTaskEditor(null, () => resolve());
  }, { managersOnly: true }));

  setNotFound(() => navigate(isManager() ? '/dashboard' : '/today', { replace: true }));
}

/* ---------------------------------------------------------------- realtime */
function watchLive() {
  realtimeChannel?.unsubscribe();
  let pending = null;
  const bump = () => {
    clearTimeout(pending);
    pending = setTimeout(() => {
      const { path } = parse();
      if (['/dashboard', '/review', '/today', '/tasks'].includes(path)) resolve();
    }, 1200);
  };
  try {
    realtimeChannel = sb()
      .channel('tasks-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, bump)
      .subscribe();
  } catch { /* realtime is a nicety, never a blocker */ }
}

/* -------------------------------------------------------------------- boot */
async function onSignedIn(session) {
  setState({ session });
  if (mountedUserId === session.user.id && shell) return;   // token refresh, not a new sign-in

  let identity;
  try {
    identity = await data.waitForMe();
  } catch (err) {
    return errorView(root(), friendlyError(err), () => location.reload());
  }

  if (!identity?.member) {
    return errorView(
      root(),
      'Your account was created but its record is missing. Re-run the setup SQL in Supabase, then try again.',
      () => location.reload()
    );
  }
  setState({ me: identity.member, team: identity.team });

  if (identity.member.status === 'disabled') return disabledView(root());

  // Signed up but not on a team yet: create one or join with a code.
  if (!identity.member.team_id) {
    mountedUserId = null;
    return teamSetupView(root(), identity.member, (joined) => {
      setState({ me: joined.member, team: joined.team });
      mountShell(session);
    });
  }

  mountShell(session);
}

async function mountShell(session) {
  shell = buildShell();
  mountedUserId = session.user.id;
  registerRoutes();
  watchLive();
  data.touchLastSeen();

  const { path } = parse();
  const home = isManager() ? '/dashboard' : '/today';
  if (!path || path === '/') navigate(home, { replace: true });
  await startRouter();
  paintChrome();
}

function onSignedOut() {
  realtimeChannel?.unsubscribe();
  realtimeChannel = null;
  setState({ session: null, me: null, team: null });
  shell = null;
  mountedUserId = null;
  signInView(root());
}

async function boot() {
  if (!isConfigured()) {
    setupView(root());
    return;
  }

  let client;
  try {
    client = sb();
  } catch {
    return setupView(root());
  }

  client.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || !session) {
      if (event === 'SIGNED_OUT') onSignedOut();
      return;
    }
    setState({ session });
    if (!shell && !['pending', 'disabled'].includes(state.me?.status)) onSignedIn(session);
  });

  const { data: { session }, error } = await client.auth.getSession();
  if (error) console.warn(error);
  if (session) await onSignedIn(session);
  else onSignedOut();
}

/* ------------------------------------------------------------ app plumbing */
window.addEventListener('online', () => { setState({ online: true }); paintChrome(); resolve(); });
window.addEventListener('offline', () => { setState({ online: false }); paintChrome(); });

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  setState({ installEvent: e });
});
window.addEventListener('appinstalled', () => {
  setState({ installEvent: null });
  toast('Installed — open it from your home screen', 'ok');
});

// Keep "last seen" fresh while the app is open, so managers see who's working.
setInterval(() => { if (shell && state.me?.status === 'active') data.touchLastSeen(); }, 5 * 60_000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && shell && state.me?.status === 'active') resolve();
});

subscribe(paintChrome);

/* Keeping the installed app up to date.
   A home-screen app can sit on a cached shell for days, so a deploy looks like
   nothing happened. Reload as soon as a new service worker takes over, and go
   looking for one whenever the app is reopened. */
if ('serviceWorker' in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;   // first install: nothing to replace
    reloading = true;
    location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .then((registration) => {
        registration.update().catch(() => {});
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden) registration.update().catch(() => {});
        });
        setInterval(() => registration.update().catch(() => {}), 30 * 60_000);
      })
      .catch(() => {});
  });
}

boot().catch((err) => {
  console.error(err);
  errorView(root(), friendlyError(err), () => location.reload());
});
