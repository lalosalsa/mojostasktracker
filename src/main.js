/* Boot, session handling, chrome (header + tabs), and routing. */

import './ui.js';
import { el, esc, toast, initials } from './ui.js';
import { isConfigured, APP_NAME } from './config.js';
import { sb, friendlyError } from './supabase.js';
import { state, setState, subscribe, isManager, canCreateTeam } from './store.js';
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
import { openTeamSwitcher } from './views/teamSwitcher.js';
import { startLiveSync, stopLiveSync, wakeLiveSync } from './live.js';

/** Always resolve the live root — the shell is swapped out on sign-in/out, so
    a cached reference goes stale and later renders land in a detached tree. */
const root = () => document.getElementById('app');
let shell = null;
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
        <button class="appbar-btn" data-refresh title="Refresh">
          <span class="livedot" data-live></span>⟳
        </button>
        <button class="appbar-btn team" data-teams title="Switch location">
          <span class="name" data-teamname>${esc(state.team?.name || 'Location')}</span>
          <span class="caret" aria-hidden="true">▾</span>
        </button>
        <button class="appbar-btn" data-profile title="Your account">
          ${esc(initials(state.me?.name || state.account?.name || state.account?.email))}
        </button>
      </header>
      <div class="offline-bar" hidden data-offline>Offline — changes will need a connection to save</div>
      <main class="view" id="view"></main>
      <nav class="tabbar">
        ${tabs.map((t) => `<button data-tab="${t.path}"><span class="ic">${t.icon}</span><span>${esc(t.label)}</span></button>`).join('')}
      </nav>
    </div>`);

  node.querySelector('[data-refresh]').onclick = () => resolve();
  node.querySelector('[data-teams]').onclick = () => openTeamSwitcher({
    onSwitched: () => {
      // a different location means different tabs, blocks and crew
      shell = buildShell();
      registerRoutes();
      paintChrome();
      watchLive();                       // re-subscribe to the team just opened
      navigate(isManager() ? '/dashboard' : '/today', { replace: true });
      resolve();
    },
  });
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
  const name = state.me?.name || state.account?.name || '';
  shell.querySelector('[data-sub]').textContent =
    isManager() ? `${name} · Manager` : `${name}${state.team ? ` · ${state.team.name}` : ''}`;

  const dot = shell.querySelector('[data-live]');
  if (dot) {
    const status = state.live?.status || 'idle';
    dot.className = `livedot ${status}`;
    dot.title = status === 'connected' ? 'Live — updates arrive on their own'
      : status === 'connecting' ? 'Connecting…'
        : 'Not live right now — checking every few seconds';
  }

  const teamBtn = shell.querySelector('[data-teams]');
  if (teamBtn) {
    teamBtn.querySelector('[data-teamname]').textContent = state.team?.name || 'Location';
    // only worth showing once there is somewhere to switch to, or something to add
    teamBtn.hidden = (state.teams?.length || 0) < 2 && !canCreateTeam();
  }
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

    // Views fetch before they paint, so tapping two tabs quickly can let the
    // slower first one finish last and paint over the screen you asked for.
    const startedAt = parse().path;
    try {
      await view(container, params);
      if (parse().path !== startedAt) return resolve();   // repaint what's current
    } catch (err) {
      // A background repaint that fails — a dropped signal, a request cancelled
      // by navigation — must not throw a banner over what someone is reading.
      // Leave the screen as it is; the next poll will bring it up to date.
      if (state.quietRefresh) return;
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

/* ---------------------------------------------------------------- live sync */

/** Repaints the current screen without the loading skeletons flashing. */
function liveRefresh({ quiet = true } = {}) {
  const { path } = parse();
  if (!shell || !path || path === '/') return;
  if (quiet) setState({ quietRefresh: true });
  return Promise.resolve(resolve()).finally(() => setState({ quietRefresh: false }));
}

function watchLive() {
  startLiveSync(liveRefresh);
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

  if (!identity?.account) {
    return errorView(
      root(),
      'Your account was created but its record is missing. Re-run the setup SQL in Supabase, then try again.',
      () => location.reload()
    );
  }
  setState({
    account: identity.account,
    me: identity.member,
    team: identity.team,
    teams: identity.teams || [],
  });

  if (identity.member?.status === 'disabled') return disabledView(root());

  // Signed up but not on a team yet: create one or join with a code.
  if (!identity.member?.team_id) {
    mountedUserId = null;
    return teamSetupView(root(), identity.account, (joined) => {
      setState({
        account: joined.account,
        me: joined.member,
        team: joined.team,
        teams: joined.teams || [],
      });
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
  stopLiveSync();
  setState({ session: null, account: null, me: null, team: null, teams: [] });
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
window.addEventListener('online', () => { setState({ online: true }); paintChrome(); wakeLiveSync(); });
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
  if (!document.hidden && shell && state.me?.status === 'active') wakeLiveSync();
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
