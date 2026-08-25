/**
 * Browser smoke test: boots the built app against a mocked Supabase and walks
 * the crew and manager screens. Run with:  node test/smoke.mjs
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const PORT = 4321;
const SUPA = 'https://demo.supabase.co';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.map': 'application/json' };

const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const failures = [];
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${!ok && extra ? ` — ${extra}` : ''}`);
  if (!ok) failures.push(name);
};

/* ------------------------------------------------------------ static server */
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  let file = path.join(PUBLIC, url === '/' ? 'index.html' : url);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));

/* ------------------------------------------------------------- fake backend */
const USER_ID = '11111111-1111-1111-1111-111111111111';
const TEAM = { id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Mojo Downtown',
  join_code: 'K7P2QX', manager_code: 'M4RT9B', created_at: '2026-01-01T00:00:00Z' };
const TEAM2 = { id: 'aaaaaaaa-0000-0000-0000-000000000002', name: 'Mojo Airport',
  join_code: 'H3N8VD', manager_code: 'Q9WKTM', created_at: '2026-01-01T00:00:00Z' };
const ACCOUNT = { id: USER_ID, email: 'boss@mojo.test', name: 'Sam Boss',
  active_team_id: TEAM.id, created_at: '2026-01-01T00:00:00Z' };
const MEMBER_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const profile = {
  id: MEMBER_ID, account_id: USER_ID, team_id: TEAM.id, email: 'boss@mojo.test',
  name: 'Sam Boss', role: 'manager',
  status: 'active', job_title: 'Manager', phone: '', created_at: '2026-01-01T00:00:00Z',
  last_seen_at: new Date().toISOString(),
};
const employee = { ...profile, id: 'bbbbbbbb-0000-0000-0000-000000000002',
  account_id: '22222222-2222-2222-2222-222222222222',
  email: 'jose@mojo.test', name: 'Jose P', role: 'employee' };
const BLOCKS = [
  { id: 1, team_id: TEAM.id, name: 'Morning Prep', starts_at: '07:00:00', ends_at: '11:00:00',
    position: 0, active: true, items: [
      { id: 11, title: 'Unlock and light up', description: '', location: '', priority: 'normal',
        requires_photo: true, assigned_to: null, position: 0, active: true },
      { id: 12, title: 'Stock the front cooler', description: '', location: '', priority: 'normal',
        requires_photo: true, assigned_to: null, weekdays: [1, 2, 3, 4, 5], position: 1, active: true },
    ] },
  { id: 2, team_id: TEAM.id, name: 'Closing', starts_at: null, ends_at: null,
    position: 1, active: true, items: [
      { id: 21, title: 'Mop the floor', description: '', location: '', priority: 'normal',
        requires_photo: true, assigned_to: null, position: 0, active: true },
    ] },
];

const tasks = [
  { id: 1, title: 'Sweep the shop floor', description: 'Front to back', location: 'Bay 2',
    status: 'submitted', priority: 'high', requires_photo: true, work_date: today, due_date: today,
    notes: 'Found a broken pallet', review_note: '', minutes_spent: 25, template_id: null,
    team_id: TEAM.id,
    created_at: `${today}T14:00:00Z`, started_at: `${today}T15:00:00Z`, completed_at: `${today}T16:00:00Z`,
    reviewed_at: null, assigned_to: employee.id, created_by: USER_ID, reviewed_by: null,
    completed_by: employee.id, block_id: 1, block_item_id: 11,
    assignee: { id: employee.id, name: 'Jose P' }, reviewer: null,
    finisher: { id: employee.id, name: 'Jose P' },
    block: { id: 1, name: 'Morning Prep', starts_at: '07:00:00', ends_at: '11:00:00', position: 0 },
    photos: [{ id: 7, storage_path: `${employee.id}/1/a.jpg`, thumb_path: null, caption: '',
               latitude: null, longitude: null, created_at: `${today}T16:00:00Z`, member_id: employee.id }] },
  { id: 2, title: 'Restock the van', description: '', location: '', status: 'open', priority: 'normal',
    requires_photo: true, work_date: today, due_date: today, notes: '', review_note: '', minutes_spent: null,
    template_id: null, team_id: TEAM.id, created_at: `${today}T14:00:00Z`, started_at: null, completed_at: null,
    reviewed_at: null, assigned_to: null, created_by: USER_ID, reviewed_by: null,
    completed_by: null, block_id: 2, block_item_id: 21,
    assignee: null, reviewer: null, finisher: null,
    block: { id: 2, name: 'Closing', starts_at: null, ends_at: null, position: 1 }, photos: [] },
];

let signedUp = false;
let signedUpName = '';
const signedUpFlag = () => signedUp;

const json = (route, body, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body),
    headers: { 'access-control-allow-origin': '*' } });

const browser = await chromium.launch(
  fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {}
);
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
});

let addedItem = null;
let switchedTo = null;
let taskFetches = 0;
let verifiedTask = null;
let rejectedNote = null;
let identity = 'manager';
let hasTeam = true;
let createdTeamName = '';
let joinedWithCode = '';
let uploadedPath = '';
let uploadedBytes = 0;
let uploadedRows = 0;
const who = () => {
  const base = identity === 'manager' ? profile : { ...employee, account_id: USER_ID };
  return hasTeam ? base : { ...base, team_id: null, role: 'employee' };
};
const activeTeam = () => (switchedTo === TEAM2.id ? TEAM2 : TEAM);
const identityPayload = () => ({
  account: { ...ACCOUNT, active_team_id: hasTeam ? activeTeam().id : null },
  member: who(),
  team: hasTeam ? activeTeam() : null,
  teams: hasTeam ? [
    { team_id: TEAM.id, name: TEAM.name, role: identity === 'manager' ? 'manager' : 'employee',
      is_active: activeTeam().id === TEAM.id, join_code: TEAM.join_code,
      manager_code: TEAM.manager_code, crew_count: 3 },
    { team_id: TEAM2.id, name: TEAM2.name, role: identity === 'manager' ? 'manager' : 'employee',
      is_active: activeTeam().id === TEAM2.id,
      join_code: identity === 'manager' ? TEAM2.join_code : null,
      manager_code: identity === 'manager' ? TEAM2.manager_code : null, crew_count: 1 },
  ] : [],
});
await context.route(`${SUPA}/**`, async (route) => {
  const url = route.request().url();
  const method = route.request().method();
  if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });

  if (url.includes('/auth/v1/signup')) {
    const payload = JSON.parse(route.request().postData() || '{}');
    signedUp = true;
    signedUpName = payload?.data?.full_name || '';
    return json(route, { access_token: 'fake', refresh_token: 'fake', token_type: 'bearer',
      expires_in: 999999, expires_at: Math.floor(Date.now() / 1000) + 999999,
      user: { id: USER_ID, email: 'boss@mojo.test', aud: 'authenticated', role: 'authenticated',
              app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } });
  }
  if (url.includes('/auth/v1/token')) {
    return json(route, { access_token: 'fake', refresh_token: 'fake', token_type: 'bearer',
      expires_in: 999999, expires_at: Math.floor(Date.now() / 1000) + 999999,
      user: { id: USER_ID, email: 'boss@mojo.test', aud: 'authenticated', role: 'authenticated',
              app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } });
  }
  if (url.includes('/auth/v1/user')) return json(route, profile);
  if (url.includes('/rest/v1/rpc/whoami')) return json(route, identityPayload());
  if (url.includes('/rest/v1/rpc/my_teams')) return json(route, identityPayload().teams);
  if (url.includes('/rest/v1/rpc/switch_team')) {
    switchedTo = JSON.parse(route.request().postData() || '{}').p_team_id;
    return json(route, identityPayload());
  }
  if (url.includes('/rest/v1/blocks')) return json(route, BLOCKS);
  if (url.includes('/rest/v1/block_items')) {
    if (method === 'POST') {
      addedItem = JSON.parse(route.request().postData() || '{}');
      return json(route, { id: 99, ...addedItem });
    }
    return json(route, BLOCKS.flatMap((b) => b.items));
  }
  if (url.includes('/rest/v1/rpc/set_my_name')) return json(route, identityPayload());
  if (url.includes('/rest/v1/rpc/create_team')) {
    createdTeamName = JSON.parse(route.request().postData() || '{}').p_team_name || '';
    hasTeam = true;
    return json(route, identityPayload());
  }
  if (url.includes('/rest/v1/accounts')) return json(route, ACCOUNT);
  if (url.includes('/rest/v1/rpc/join_team')) {
    joinedWithCode = JSON.parse(route.request().postData() || '{}').p_code || '';
    hasTeam = true;
    return json(route, identityPayload());
  }
  if (url.includes('/rest/v1/rpc/employee_day_stats')) {
    return json(route, [{ id: employee.id, name: 'Jose P', job_title: 'Tech',
      last_seen_at: new Date().toISOString(), assigned: 3, completed: 2, remaining: 1, awaiting_review: 1,
      photos: 4, last_completed_at: `${today}T16:00:00Z` }]);
  }
  if (url.includes('/rest/v1/rpc/daily_trend')) {
    const body = JSON.parse(route.request().postData() || '{}');
    const days = [];
    const start = new Date(`${body.p_from || today}T00:00:00`);
    const end = new Date(`${body.p_to || today}T00:00:00`);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const iso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      days.push({ day: iso, total: 4, completed: iso === today ? 1 : 4 });
    }
    return json(route, days);
  }
  if (url.includes('/rest/v1/rpc/range_stats')) {
    return json(route, [{ total: 8, open: 2, submitted: 1, verified: 5, rejected: 0, completed: 6, photos: 12 }]);
  }
  if (url.includes('/rest/v1/rpc/ensure_todays_tasks')) return json(route, 0);
  if (url.includes('/rest/v1/rpc/touch_last_seen')) return json(route, null);
  if (url.includes('/rest/v1/members')) {
    if (url.includes(`id=eq.${MEMBER_ID}`) || url.includes(`id=eq.${who().id}`)) return json(route, who());
    return json(route, [profile, employee]);
  }
  if (url.includes('/rest/v1/teams')) return json(route, [TEAM]);
  if (url.includes('/rest/v1/task_photos')) {
    uploadedRows += 1;
    return json(route, { id: 99, task_id: 2, member_id: who().id, storage_path: uploadedPath,
      thumb_path: null, caption: '', latitude: null, longitude: null,
      created_at: new Date().toISOString() });
  }
  if (url.includes('/storage/v1/object/task-photos/')) {
    uploadedPath = url.split('/storage/v1/object/task-photos/')[1];
    uploadedBytes = (route.request().postDataBuffer() || Buffer.alloc(0)).length;
    return json(route, { Key: `task-photos/${uploadedPath}` });
  }
  if (url.includes('/rest/v1/tasks')) {
    if (method === 'GET') taskFetches += 1;
    if (method === 'PATCH') {
      const patch = JSON.parse(route.request().postData() || '{}');
      if (patch.status === 'verified') verifiedTask = patch;
      if (patch.status === 'rejected') rejectedNote = patch.review_note;
      return json(route, { ...tasks[0], ...patch });
    }
    if (url.includes('status=eq.submitted')) return json(route, tasks.filter((t) => t.status === 'submitted'));
    return json(route, tasks);
  }
  if (url.includes('/rest/v1/activity')) {
    return json(route, [{ id: 1, type: 'task.completed', actor_name: 'Jose P', detail: 'Sweep the shop floor', created_at: new Date().toISOString() }]);
  }

  if (url.includes('/rest/v1/task_templates')) return json(route, []);
  // storage-js asks for signed paths, then builds the full URL itself
  if (url.includes('/storage/v1/object/sign/') && method === 'POST') {
    return json(route, [{ error: null, path: `${employee.id}/1/a.jpg`,
      signedURL: `/object/sign/task-photos/${employee.id}/1/a.jpg?token=demo` }]);
  }
  if (url.includes('/storage/v1/object/sign/') && method === 'GET') {
    return route.fulfill({ status: 200, contentType: 'image/png',
      headers: { 'access-control-allow-origin': '*' },
      body: fs.readFileSync(path.join(PUBLIC, 'icons', 'icon-192.png')) });
  }
  if (url.includes('/realtime/')) return route.abort();
  return json(route, []);
});

const errors = [];
const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

console.log('\nSetup screen');
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
check('shows the connect-your-database screen', await page.locator('text=Connect your database').isVisible());
await page.screenshot({ path: 'test/shots/01-setup.png' });

console.log('\nSign up');
await page.evaluate(([url, key]) => {
  localStorage.setItem('mtt.supabaseUrl', url);
  localStorage.setItem('mtt.supabaseKey', key);
}, [SUPA, 'a'.repeat(40)]);
await page.reload({ waitUntil: 'networkidle' });
check('offers create-account and log-in', await page.locator('text=Create an account').isVisible()
  && await page.locator('text=I already have an account').isVisible());

await page.click('[data-signup]');
await page.waitForSelector('#si-name', { timeout: 5000 });
check('sign-up asks for name, email and password',
  await page.locator('#si-name').isVisible()
  && await page.locator('#si-email').isVisible()
  && await page.locator('#si-pass').isVisible());
check('no verification-code field anywhere', (await page.locator('#si-code').count()) === 0);

await page.fill('#si-name', 'Sam Boss');
await page.fill('#si-email', 'boss@mojo.test');
await page.fill('#si-pass', 'short');
await page.click('button[type=submit]');
check('a too-short password is refused', !signedUp);

await page.fill('#si-pass', 'longenoughpw');
await page.check('[data-show]');
check('show-password reveals it', (await page.getAttribute('#si-pass', 'type')) === 'text');
await page.screenshot({ path: 'test/shots/02-signup.png' });
await page.click('button[type=submit]');
await page.waitForFunction(() => true);
for (let i = 0; i < 20 && !signedUpFlag(); i += 1) await page.waitForTimeout(100);
check('sign-up posts to Supabase with the name attached', signedUp && signedUpName === 'Sam Boss');

console.log('\nJoining a team');
hasTeam = false;
await page.evaluate(([id]) => {
  const session = {
    access_token: 'fake', refresh_token: 'fake', token_type: 'bearer',
    expires_in: 999999, expires_at: Math.floor(Date.now() / 1000) + 999999,
    user: { id, email: 'boss@mojo.test', aud: 'authenticated', role: 'authenticated',
            app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
  };
  localStorage.setItem('mtt.auth', JSON.stringify(session));
}, [USER_ID]);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('[data-join]', { timeout: 8000 });
check('a new account is asked to join or create a team',
  await page.locator('text=I have a team code').isVisible()
  && await page.locator('text=Create a new team').isVisible());
await page.screenshot({ path: 'test/shots/03-team-setup.png' });

await page.click('[data-create]');
await page.fill('#tc-name', 'Mojo Services');
await page.click('button[type=submit]');
await page.waitForSelector('text=CREW CODE', { timeout: 5000 });
check('creating a team sends the name to the server', createdTeamName === 'Mojo Services');
check('shows the crew code to share', (await page.locator('#app').innerText()).includes(TEAM.join_code));
await page.screenshot({ path: 'test/shots/04-team-code.png' });
await page.click('[data-go]');
await page.waitForSelector('.tabbar', { timeout: 8000 });
check('drops straight into the app afterwards', await page.locator('.tabbar').isVisible());

// and the join-with-a-code path
hasTeam = false;
await page.evaluate(() => { location.hash = ''; });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('[data-join]', { timeout: 8000 });
await page.click('[data-join]');
await page.fill('#tc-code', 'k7p2qx');
check('the code field upper-cases as you type',
  (await page.inputValue('#tc-code')) === 'K7P2QX');
await page.click('button[type=submit]');
await page.waitForSelector('.tabbar', { timeout: 8000 });
check('joining with a code sends it to the server', joinedWithCode === 'K7P2QX');

console.log('\nManager app');
hasTeam = true;
await page.evaluate(() => { location.hash = '#/dashboard'; });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.tabbar', { timeout: 8000 });
check('manager lands on the overview', await page.locator('text=Overview').first().isVisible());
check('shows the crew scoreboard', await page.locator('text=Jose P').first().isVisible());
check('flags work waiting on review', await page.locator('text=waiting on you').isVisible());

const feed = await page.locator('#view').innerText();
check('completed work forms a feed on the overview', feed.includes('Finished today'));
check('the feed names who completed each task', feed.includes('✓ Jose P'));
check('and the photo proof is right there in the feed',
  (await page.locator('#view img[data-path]').count()) > 0);
await page.waitForFunction(() => {
  const img = document.querySelector('#view img[data-path]');
  return img && img.complete && img.naturalWidth > 0;
}, null, { timeout: 5000 }).catch(() => {});
check('the feed photos actually load',
  await page.evaluate(() => {
    const img = document.querySelector('#view img[data-path]');
    return Boolean(img && img.naturalWidth > 0);
  }));
await page.screenshot({ path: 'test/shots/05-dashboard.png', fullPage: true });

await page.click('[data-tab="/review"]');
await page.waitForSelector('text=Waiting on your sign-off', { timeout: 5000 });
check('review queue lists the submitted task', await page.locator('text=Sweep the shop floor').first().isVisible());
await page.waitForFunction(() => {
  const img = document.querySelector('.card img[data-path]');
  return img && img.complete && img.naturalWidth > 0;
}, null, { timeout: 5000 }).catch(() => {});
check('photo proof thumbnails actually load',
  await page.evaluate(() => {
    const img = document.querySelector('.card img[data-path]');
    return Boolean(img && img.naturalWidth > 0);
  }));
await page.screenshot({ path: 'test/shots/06-review.png', fullPage: true });

// actually sign the work off — the manager's most-used button
await page.locator('.card button', { hasText: 'Verify' }).first().click();
for (let i = 0; i < 40 && !verifiedTask; i += 1) await page.waitForTimeout(100);
check('verifying a task sends the sign-off', verifiedTask?.status === 'verified');

await page.evaluate(() => { location.hash = '#/review'; });
await page.waitForSelector('.card', { timeout: 5000 });
await page.locator('.card button', { hasText: 'Send back' }).first().click();
await page.waitForSelector('.sheet textarea', { timeout: 5000 });
await page.fill('.sheet textarea', 'Missed the corners');
await page.locator('.sheet-foot button', { hasText: 'Send' }).click();
for (let i = 0; i < 40 && !rejectedNote; i += 1) await page.waitForTimeout(100);
check('sending a task back carries the manager\'s note',
  rejectedNote === 'Missed the corners', rejectedNote);
await page.waitForTimeout(600);   // let the review list settle before moving on

// tapping two screens quickly must land on the second one, not the first
await page.evaluate(() => { location.hash = '#/team'; location.hash = '#/tasks'; });
await page.waitForTimeout(1500);
check('fast navigation lands on the screen you asked for',
  (await page.locator('#view').innerText()).includes('last 7 days'));

await page.evaluate(() => { location.hash = '#/tasks'; });
await page.waitForSelector('.task', { timeout: 5000 });
check('task board renders task cards', (await page.locator('.task').count()) >= 2);
check('the manager gets a full week to look back over',
  (await page.locator('.weekstrip .wday').count()) === 7);
check('each day shows how much of it got finished',
  /\d+\/\d+/.test(await page.locator('.weekstrip').innerText()));
check('the manager still sees finished work, with its photo',
  (await page.locator('#view').innerText()).includes('Sweep the shop floor')
  && (await page.locator('.task .thumbs img').count()) > 0);
await page.screenshot({ path: 'test/shots/16-week.png', fullPage: true });

const otherDay = page.locator('.weekstrip .wday').nth(2);
await otherDay.click();
await page.waitForTimeout(900);
check('tapping a past day loads that day', (await page.locator('.weekstrip .wday.on').count()) === 1);
await page.evaluate(() => { location.hash = '#/tasks'; });
await page.waitForSelector('.task', { timeout: 5000 });
await page.locator('.task').first().click();
await page.waitForSelector('.sheet', { timeout: 5000 });
check('task detail sheet opens', await page.locator('.sheet-head h2').isVisible());
check('detail sheet shows the timeline', await page.locator('text=Timeline').isVisible());
await page.waitForTimeout(400);   // let the slide-up animation settle
check('sheet is fully opaque once open',
  await page.evaluate(() => getComputedStyle(document.querySelector('.sheet')).opacity === '1'));
await page.screenshot({ path: 'test/shots/07-task-detail.png' });
await page.click('.sheet-head [data-close]');

await page.click('[data-tab="/team"]');
await page.waitForSelector('text=CREW CODE', { timeout: 5000 });
check('team screen leads with the shareable code',
  (await page.locator('#view').innerText()).includes(TEAM.join_code));
check('team roster lists the crew', await page.locator('text=Jose P').first().isVisible());
await page.screenshot({ path: 'test/shots/08-team.png', fullPage: true });

await page.click('[data-tab="/me"]');
await page.waitForSelector('text=Put this on your home screen', { timeout: 5000 });
check('account screen explains home-screen install', true);
await page.screenshot({ path: 'test/shots/09-account.png', fullPage: true });

console.log('\nLive updates');
check('the app shows a live-status dot', (await page.locator('[data-live]').count()) === 1);

// realtime is unreachable in this harness, so the fallback is what must carry it.
// Wait for the refetches rather than assuming a fixed window — this runs on a
// machine that may be busy, and a fixed sleep here is how a test turns flaky.
await page.evaluate(() => { window.__LIVE_POLL_MS__ = 400; });
await page.evaluate(() => { location.hash = '#/today'; });
await page.waitForTimeout(300);
const before = taskFetches;
await page.evaluate(() => { location.hash = '#/dashboard'; });

const deadline = Date.now() + 15000;
while (taskFetches < before + 2 && Date.now() < deadline) await page.waitForTimeout(200);
check('it keeps refetching when realtime is down', taskFetches >= before + 2,
  `only ${taskFetches - before} refetches before the deadline`);

console.log('\nLocations');
const switcher = page.locator('[data-teams]');
check('the switcher sits in the top right, by the profile icon', await switcher.isVisible());
check('it shows which location you are looking at',
  (await switcher.innerText()).includes('Mojo Downtown'));

await switcher.click();
await page.waitForSelector('text=Your locations', { timeout: 5000 });
const sheetText = await page.locator('.sheet-body').innerText();
check('both locations are listed', sheetText.includes('Mojo Downtown') && sheetText.includes('Mojo Airport'));
check('the current one is marked', sheetText.includes('Here now'));
check('each shows your role and crew size', sheetText.includes('Manager') && sheetText.includes('3 people'));
check('a manager can add another location', sheetText.includes('Add another location'));
check('and can join one with a code', sheetText.includes('Join a team with a code'));
check('and can leave the one they are in', sheetText.includes('Leave Mojo Downtown'));

const bar = await page.evaluate(() => {
  const btn = document.querySelector('[data-teams]');
  const title = document.querySelector('[data-title]');
  return {
    oneLine: btn.getBoundingClientRect().height < 46,
    leavesRoomForTitle: title.getBoundingClientRect().width > 90,
  };
});
check('the switcher stays on one line', bar.oneLine);
check('and leaves the screen title room', bar.leavesRoomForTitle);
await page.waitForTimeout(400);
await page.screenshot({ path: 'test/shots/17-locations.png' });

await page.locator('.sheet-body .list-row', { hasText: 'Mojo Airport' }).click();
await page.waitForTimeout(1200);
check('tapping a location switches to it', switchedTo === TEAM2.id);
check('the header follows you there',
  (await page.locator('[data-teams]').innerText()).includes('Mojo Airport'));
await page.screenshot({ path: 'test/shots/18-switched.png', fullPage: true });

// back to the first one for the rest of the run
await page.locator('[data-teams]').click();
await page.waitForSelector('text=Your locations', { timeout: 5000 });
await page.locator('.sheet-body .list-row', { hasText: 'Mojo Downtown' }).click();
await page.waitForTimeout(1200);

console.log('\nBlocks');
await page.click('[data-tab="/blocks"]');
// the intro banner names the blocks too, so wait for a real block card
await page.waitForSelector('button:has-text("Add a task to")', { timeout: 8000 });
const blocksText = await page.locator('#view').innerText();
check('lists the named blocks of the day',
  blocksText.includes('Morning Prep') && blocksText.includes('Closing'));
check('shows each block\'s time range', blocksText.includes('7am – 11am'));
check('shows the tasks inside a block', blocksText.includes('Stock the front cooler'));
check('a weekday-limited task shows its days', blocksText.includes('Mon–Fri'));
check('a block with no times reads "any time"', blocksText.includes('any time'));
await page.screenshot({ path: 'test/shots/13-blocks.png', fullPage: true });

await page.locator('button', { hasText: 'Add a task to Morning Prep' }).first().click();
await page.waitForSelector('#i-title', { timeout: 5000 });
check('adding a task says which block it lands in',
  (await page.locator('.sheet-body').innerText()).includes('In Morning Prep'));
check('a task can be left open to anyone',
  (await page.locator('#i-who option').first().innerText()) === 'Anyone on the crew');
check('every weekday is on by default', (await page.locator('.daypick .day.on').count()) === 7);

// turn it into a Mon/Wed/Fri job
for (const day of [0, 2, 4, 6]) await page.locator(`.daypick .day[data-day="${day}"]`).click();
check('days can be toggled independently', (await page.locator('.daypick .day.on').count()) === 3);
check('it says in words which days it runs',
  (await page.locator('[data-dayhint]').innerText()).includes('Mon, Wed, Fri'));
await page.fill('#i-title', 'Wipe the counters');
await page.screenshot({ path: 'test/shots/14-add-task.png' });
await page.locator('.sheet-foot button', { hasText: 'Add task' }).click();
for (let i = 0; i < 40 && !addedItem; i += 1) await page.waitForTimeout(100);
check('the new task is saved into that block', addedItem?.title === 'Wipe the counters');
check('and it goes to the whole crew, not one person', addedItem?.assigned_to === null);
check('the chosen weekdays are saved',
  JSON.stringify(addedItem?.weekdays) === '[1,3,5]', JSON.stringify(addedItem?.weekdays));

await page.click('[data-tab="/blocks"]');
await page.waitForSelector('button:has-text("Add a task to")', { timeout: 8000 });
await page.locator('button', { hasText: 'New block' }).first().click();
await page.waitForSelector('#b-name', { timeout: 5000 });
check('a new block only needs a name',
  (await page.locator('.sheet-body').innerText()).includes("isn't tied to a clock"));
await page.click('.sheet-head [data-close]');

console.log('\nCrew app');
identity = 'employee';
await page.evaluate(() => { location.hash = '#/today'; });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.hero', { timeout: 8000 });
check('crew member lands on Today',
  (await page.locator('[data-tab="/today"]').getAttribute('class')).includes('active'));
check('crew sees only three tabs (no manager tools)',
  (await page.locator('[data-tab]').count()) === 3);
check('greeting names the person', /Good (morning|afternoon|evening), Jose/.test(await page.locator('.hero').innerText()));
check('the crew just works the manager\'s list (no ad-hoc logging)',
  (await page.locator('.fab').count()) === 0);

await page.locator('[data-teams]').click();
await page.waitForSelector('text=Your locations', { timeout: 5000 });
const crewSheet = await page.locator('.sheet-body').innerText();
check('crew can join another team with a code', crewSheet.includes('Join a team with a code'));
check('but crew cannot start a location', !crewSheet.includes('Add another location'));
await page.click('.sheet-head [data-close]');
const todayText = await page.locator('#view').innerText();
check('the list is grouped under the named blocks', todayText.includes('Closing'));
check('finished work drops off the crew list',
  !todayText.includes('Sweep the shop floor'), 'the done task is still showing');
check('the outstanding task is still there', todayText.includes('Restock the van'));
check('the day\'s progress still counts what was done', todayText.includes('1 of 2 done today'));

// the ring label has to sit inside the stroke at every value, 100% included
const ringFit = await page.evaluate(() => {
  const ring = document.querySelector('.ring');
  if (!ring) return null;
  const measure = () => {
    const box = ring.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const innerR = box.width / 2 - 7;              // inside the 7px stroke
    const reach = ['.pct', '.cap'].flatMap((sel) => {
      const t = ring.querySelector(sel).getBoundingClientRect();
      return [
        Math.hypot(t.left - cx, t.top - cy), Math.hypot(t.right - cx, t.top - cy),
        Math.hypot(t.left - cx, t.bottom - cy), Math.hypot(t.right - cx, t.bottom - cy),
      ];
    });
    return { fits: Math.max(...reach) <= innerR, reach: Math.max(...reach), innerR };
  };
  const asIs = measure();
  // now force the widest case it can ever show
  ring.classList.add('is-full');
  ring.querySelector('.pct').textContent = '100%';
  const full = measure();
  return { asIs, full };
});
check('the percentage sits inside the ring', ringFit?.asIs.fits,
  `text reaches ${ringFit?.asIs.reach.toFixed(1)}px of a ${ringFit?.asIs.innerR}px radius`);
check('and still fits at 100%', ringFit?.full.fits,
  `text reaches ${ringFit?.full.reach.toFixed(1)}px of a ${ringFit?.full.innerR}px radius`);
await page.screenshot({ path: 'test/shots/10-today.png', fullPage: true });

console.log('\nPhoto upload');
const openTask = page.locator('.task').filter({ hasText: 'Restock the van' }).first();
await openTask.click();
await page.waitForSelector('.sheet', { timeout: 5000 });
const chooser = page.waitForEvent('filechooser');
await page.locator('.add-shot').first().click();
const fc = await chooser;
await fc.setFiles(path.join(PUBLIC, 'icons', 'icon-512.png'));
// wait for the real round trip (resize -> storage -> row insert), not a placeholder
for (let i = 0; i < 60 && uploadedRows === 0; i += 1) await page.waitForTimeout(250);
await page.waitForFunction(() => document.querySelector('.gallery .shot img'), null, { timeout: 10000 })
  .catch(() => {});
check('photo uploaded under the membership folder, not the login id',
  uploadedPath.startsWith(`${who().id}/2/`) && !uploadedPath.startsWith(USER_ID), uploadedPath);
console.log(`      (${uploadedBytes} bytes after shrinking)`);
check('photo was compressed to JPEG before upload',
  uploadedPath.endsWith('.jpg') && uploadedBytes > 0 && uploadedBytes < 300_000, `${uploadedBytes} bytes`);
check('photo row written to the database', uploadedRows >= 1);
check('gallery shows the new photo', (await page.locator('.gallery .shot img').count()) >= 1);
await page.screenshot({ path: 'test/shots/11-photo.png' });
await page.click('.sheet-head [data-close]');

await page.click('[data-tab="/history"]');
await page.waitForSelector("text=What you've finished", { timeout: 5000 });
check('history shows what this person finished', true);

console.log('\nPWA plumbing');
const manifest = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'manifest.webmanifest'), 'utf8'));
check('manifest is standalone with maskable icons',
  manifest.display === 'standalone' && manifest.icons.some((i) => i.purpose === 'maskable'));
check('service worker is served', fs.existsSync(path.join(PUBLIC, 'sw.js')));
const swReady = await page.evaluate(() =>
  navigator.serviceWorker.ready.then(() => true).catch(() => false));
check('service worker registers and activates', swReady);
const cached = await page.evaluate(async () => {
  const keys = await caches.keys();
  const cache = await caches.open(keys.find((k) => k.startsWith('shell-')));
  return (await cache.keys()).length;
});
check('app shell is precached for offline launch', cached >= 4, `only ${cached} files`);

console.log('\nDark mode');
const dark = await context.newPage();
await dark.emulateMedia({ colorScheme: 'dark' });
await dark.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await dark.waitForSelector('.tabbar', { timeout: 8000 });
await dark.screenshot({ path: 'test/shots/12-dark.png', fullPage: true });
check('dark mode renders', true);

const realErrors = errors.filter((e) => !/realtime|websocket|Failed to load resource/i.test(e));
check('no JavaScript errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

await browser.close();
server.close();

console.log(failures.length ? `\n${failures.length} check(s) failed\n` : '\nAll checks passed\n');
process.exit(failures.length ? 1 : 0);
