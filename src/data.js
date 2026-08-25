/* Every read and write the app makes. Row-level security in Postgres decides
   what each person can actually see, so these queries stay simple. */

import { sb, friendlyError } from './supabase.js';
import { PHOTO_BUCKET } from './config.js';

export function todayStr(d = new Date()) {
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

export function shiftDate(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return todayStr(dt);
}

function unwrap({ data, error }) {
  if (error) throw new Error(friendlyError(error));
  return data;
}

const TASK_FIELDS = `
  id, team_id, title, description, location, status, priority, requires_photo,
  work_date, due_date, notes, review_note, minutes_spent,
  block_id, block_item_id, completed_by,
  created_at, started_at, completed_at, reviewed_at,
  assigned_to, created_by, reviewed_by,
  assignee:members!tasks_assigned_to_fkey (id, name),
  reviewer:members!tasks_reviewed_by_fkey (id, name),
  finisher:members!tasks_completed_by_fkey (id, name),
  block:blocks (id, name, starts_at, ends_at, position),
  photos:task_photos (id, storage_path, thumb_path, caption, latitude, longitude, created_at, member_id)
`;

/* ----------------------------------------------------- who am I / my team */

/** { member, team } for the signed-in device, or null before sign-up finishes. */
export async function whoami() {
  const data = unwrap(await sb().rpc('whoami'));
  return data || null;
}

/** The signup trigger writes the member row; on a brand-new account it can lag
    the first session by a few hundred milliseconds. */
export async function waitForMe(tries = 6) {
  for (let i = 0; i < tries; i += 1) {
    const identity = await whoami();
    if (identity?.member) return identity;
    await new Promise((r) => setTimeout(r, 300 + i * 250));
  }
  return null;
}

export const setMyName = (name) => sb().rpc('set_my_name', { p_name: name }).then(unwrap);

/* ---------------------------------------------------------------- sign in */
export async function signUp({ name, email, password }) {
  const { data, error } = await sb().auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: { data: { full_name: name.trim() } },
  });
  if (error) throw new Error(friendlyError(error));
  if (!data.session) {
    throw new Error(
      'Account created, but email confirmation is still switched on in Supabase. ' +
      'Turn off "Confirm email" under Authentication → Sign In / Providers → Email.'
    );
  }
  return data;
}

export async function signIn({ email, password }) {
  const { data, error } = await sb().auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) throw new Error(friendlyError(error));
  return data;
}

export const changePassword = async (password) => {
  const { error } = await sb().auth.updateUser({ password });
  if (error) throw new Error(friendlyError(error));
};

export const sendPasswordReset = async (email) => {
  const { error } = await sb().auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: window.location.origin,
  });
  if (error) throw new Error(friendlyError(error));
};

export const createTeam = (teamName, yourName) =>
  sb().rpc('create_team', { p_team_name: teamName, p_your_name: yourName || '' }).then(unwrap);

export const joinTeam = (code, yourName) =>
  sb().rpc('join_team', { p_code: code, p_your_name: yourName || '' }).then(unwrap);

export const leaveTeam = () => sb().rpc('leave_team').then(unwrap);

export const rotateTeamCode = (which = 'join') =>
  sb().rpc('rotate_team_code', { p_which: which }).then(unwrap);

export const renameTeam = (name) => sb().rpc('rename_team', { p_name: name }).then(unwrap);

export async function updateMyProfile(patch) {
  const { data: { user } } = await sb().auth.getUser();
  return unwrap(await sb().from('members').update(patch).eq('id', user.id).select().single());
}

export const touchLastSeen = () => sb().rpc('touch_last_seen').then(() => {}, () => {});

/* -------------------------------------------------------------------- tasks */
export const ensureTodaysTasks = (date = todayStr()) =>
  sb().rpc('ensure_todays_tasks', { p_date: date }).then(({ data }) => data || 0, () => 0);

export async function listTasks({
  date, from, to, status, assignedTo, completedBy, search, unassigned, limit = 300,
} = {}) {
  let q = sb().from('tasks').select(TASK_FIELDS);

  if (date) q = q.eq('work_date', date);
  if (from) q = q.gte('work_date', from);
  if (to) q = q.lte('work_date', to);
  if (status === 'open') q = q.in('status', ['open', 'in_progress', 'rejected']);
  else if (status === 'done') q = q.in('status', ['submitted', 'verified']);
  else if (status && status !== 'all') q = q.eq('status', status);
  if (assignedTo) q = q.eq('assigned_to', assignedTo);
  if (completedBy) q = q.eq('completed_by', completedBy);
  if (unassigned) q = q.is('assigned_to', null);
  if (search) q = q.or(`title.ilike.%${search}%,description.ilike.%${search}%,location.ilike.%${search}%`);

  const data = unwrap(await q.order('work_date', { ascending: false }).order('id', { ascending: false }).limit(limit));
  return (data || []).map(decorate);
}

export async function getTask(id) {
  const data = unwrap(await sb().from('tasks').select(TASK_FIELDS).eq('id', id).single());
  return decorate(data);
}

const STATUS_RANK = { rejected: 0, in_progress: 1, open: 2, submitted: 3, verified: 4 };
const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2, low: 3 };

function decorate(row) {
  if (!row) return row;
  row.photos = (row.photos || []).sort((a, b) => a.id - b.id);
  row.photoCount = row.photos.length;
  row.isDone = row.status === 'submitted' || row.status === 'verified';
  return row;
}

export function sortTasks(tasks) {
  return [...tasks].sort(
    (a, b) =>
      (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) ||
      (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) ||
      a.id - b.id
  );
}

/** Groups a day's tasks under their block, in the order the day runs. */
export function groupByBlock(tasks) {
  const groups = new Map();
  for (const task of tasks) {
    const key = task.block?.id ?? 'none';
    if (!groups.has(key)) {
      groups.set(key, {
        id: key,
        name: task.block?.name || 'Anything else',
        startsAt: task.block?.starts_at || null,
        endsAt: task.block?.ends_at || null,
        position: task.block?.position ?? 999,
        tasks: [],
      });
    }
    groups.get(key).tasks.push(task);
  }
  return [...groups.values()]
    .sort((a, b) => a.position - b.position || String(a.name).localeCompare(String(b.name)))
    .map((g) => ({ ...g, tasks: g.tasks.sort((a, b) => a.id - b.id) }));
}

export async function createTask(fields) {
  const { data: { user } } = await sb().auth.getUser();
  const row = {
    title: fields.title,
    description: fields.description || '',
    location: fields.location || '',
    priority: fields.priority || 'normal',
    requires_photo: fields.requiresPhoto !== false,
    work_date: fields.workDate || todayStr(),
    due_date: fields.dueDate || fields.workDate || todayStr(),
    status: fields.status || 'open',
    created_by: user.id,
  };
  if (fields.assignedTo !== undefined) row.assigned_to = fields.assignedTo || null;
  return decorate(unwrap(await sb().from('tasks').insert(row).select(TASK_FIELDS).single()));
}

export const updateTask = async (id, patch) =>
  decorate(unwrap(await sb().from('tasks').update(patch).eq('id', id).select(TASK_FIELDS).single()));

export async function startTask(id) {
  const { data: { user } } = await sb().auth.getUser();
  return updateTask(id, { status: 'in_progress', assigned_to: user.id, started_at: new Date().toISOString() });
}

export async function completeTask(id, { notes = '', minutes = null } = {}) {
  const { error } = await sb().rpc('complete_task', {
    p_task_id: id,
    p_notes: notes,
    p_minutes: minutes,
  });
  if (error) throw new Error(friendlyError(error));
  return getTask(id);
}

export const reopenTask = (id) =>
  updateTask(id, { status: 'in_progress', completed_at: null, reviewed_at: null, reviewed_by: null, review_note: '' });

export const verifyTask = (id, note = '') => updateTask(id, { status: 'verified', review_note: note });
export const rejectTask = (id, note) => updateTask(id, { status: 'rejected', review_note: note });

export async function deleteTask(id) {
  const photos = unwrap(await sb().from('task_photos').select('storage_path, thumb_path').eq('task_id', id));
  const paths = (photos || []).flatMap((p) => [p.storage_path, p.thumb_path]).filter(Boolean);
  if (paths.length) await sb().storage.from(PHOTO_BUCKET).remove(paths);
  unwrap(await sb().from('tasks').delete().eq('id', id));
}

/* ------------------------------------------------------------------- photos */

/** Storage failures have their own causes, and "no permission" is rarely the
    user's fault — it usually means the bucket or its policies are missing. */
function storageError(error) {
  const message = String(error?.message || error);
  if (/row-level security|not authorized|Unauthorized|403/i.test(message)) {
    return 'The photo could not be saved: this Supabase project is missing the '
      + 'task-photos storage rules. A manager needs to re-run supabase/schema.sql, '
      + 'or add the policies under Storage → Policies (see SETUP.md).';
  }
  if (/Bucket not found|not found/i.test(message)) {
    return 'The photo could not be saved: there is no "task-photos" bucket in this '
      + 'Supabase project yet. A manager needs to run supabase/schema.sql.';
  }
  if (/mime|content type/i.test(message)) {
    return "That file type isn't allowed. Take the photo with the camera button instead.";
  }
  if (/exceeded the maximum|too large|Payload/i.test(message)) {
    return 'That photo is too big even after shrinking. Try taking it again.';
  }
  return friendlyError(error);
}
const urlCache = new Map();   // storagePath -> { url, expires }
const SIGNED_TTL = 3600;

export async function signedUrls(paths) {
  const wanted = [...new Set(paths.filter(Boolean))];
  const now = Date.now();
  const missing = wanted.filter((p) => {
    const hit = urlCache.get(p);
    return !hit || hit.expires < now + 60000;
  });

  if (missing.length) {
    const { data, error } = await sb().storage.from(PHOTO_BUCKET).createSignedUrls(missing, SIGNED_TTL);
    if (!error && data) {
      for (const row of data) {
        if (row.signedUrl && row.path) {
          urlCache.set(row.path, { url: row.signedUrl, expires: now + SIGNED_TTL * 1000 });
        }
      }
    }
  }
  const out = {};
  for (const p of wanted) out[p] = urlCache.get(p)?.url || '';
  return out;
}

export async function uploadPhoto(task, { photo, thumb, width, height, caption = '', location = null }) {
  const { data: { user } } = await sb().auth.getUser();
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const base = `${user.id}/${task.id}/${stamp}`;
  const contentType = photo.type && photo.type.startsWith('image/') ? photo.type : 'image/jpeg';
  const ext = contentType.split('/')[1].replace('jpeg', 'jpg');

  const mainPath = `${base}.${ext}`;
  const up = await sb().storage.from(PHOTO_BUCKET).upload(mainPath, photo, { contentType, upsert: false });
  if (up.error) throw new Error(storageError(up.error));

  let thumbPath = null;
  if (thumb) {
    const tPath = `${base}-thumb.jpg`;
    const tUp = await sb().storage.from(PHOTO_BUCKET).upload(tPath, thumb, { contentType: 'image/jpeg' });
    if (!tUp.error) thumbPath = tPath;
  }

  try {
    return unwrap(
      await sb().from('task_photos').insert({
        task_id: task.id,
        member_id: user.id,
        storage_path: mainPath,
        thumb_path: thumbPath,
        mime: contentType,
        bytes: photo.size || 0,
        width: width || null,
        height: height || null,
        caption,
        latitude: location?.latitude ?? null,
        longitude: location?.longitude ?? null,
        taken_at: new Date().toISOString(),
      }).select().single()
    );
  } catch (err) {
    // don't leave an orphan file behind if the row insert is rejected
    await sb().storage.from(PHOTO_BUCKET).remove([mainPath, thumbPath].filter(Boolean));
    throw err;
  }
}

export async function deletePhoto(photo) {
  unwrap(await sb().from('task_photos').delete().eq('id', photo.id));
  const paths = [photo.storage_path, photo.thumb_path].filter(Boolean);
  if (paths.length) await sb().storage.from(PHOTO_BUCKET).remove(paths);
}

export const updatePhotoCaption = (id, caption) =>
  sb().from('task_photos').update({ caption }).eq('id', id).then(unwrap);

/* --------------------------------------------------------------------- team */
export const listTeam = async () =>
  unwrap(await sb().from('members').select('*').order('status').order('name')) || [];

export const listActiveEmployees = async () =>
  unwrap(
    await sb().from('members').select('id, name, email, job_title')
      .eq('status', 'active').order('name')
  ) || [];

export const updateMember = (id, patch) =>
  sb().from('members').update(patch).eq('id', id).select().single().then(unwrap);

/** Takes someone off the team; their finished work and photos stay put. */
export const removeMember = (id) => sb().rpc('remove_member', { p_member_id: id }).then(unwrap);

export const restoreMember = (id) => sb().rpc('restore_member', { p_member_id: id }).then(unwrap);

/* -------------------------------------------------------- blocks & items */

/** The named parts of the day, each with its standing list of jobs. */
export const listBlocks = async () =>
  unwrap(
    await sb().from('blocks')
      .select('*, items:block_items (id, title, description, location, priority, requires_photo, assigned_to, weekdays, position, active)')
      .order('position')
  ) || [];

export async function createBlock(fields, teamId) {
  const { data: { user } } = await sb().auth.getUser();
  const existing = await listBlocks();
  return unwrap(await sb().from('blocks').insert({
    team_id: teamId,
    name: fields.name,
    starts_at: fields.startsAt || null,
    ends_at: fields.endsAt || null,
    position: existing.length,
    created_by: user.id,
  }).select().single());
}

export const updateBlock = (id, patch) =>
  sb().from('blocks').update(patch).eq('id', id).select().single().then(unwrap);

export const deleteBlock = (id) => sb().from('blocks').delete().eq('id', id).then(unwrap);

/** Moves a block earlier or later in the day. */
export async function moveBlock(blocks, id, direction) {
  const ordered = [...blocks].sort((a, b) => a.position - b.position);
  const from = ordered.findIndex((b) => b.id === id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= ordered.length) return;
  [ordered[from], ordered[to]] = [ordered[to], ordered[from]];
  for (let i = 0; i < ordered.length; i += 1) {
    if (ordered[i].position !== i) {
      await sb().from('blocks').update({ position: i }).eq('id', ordered[i].id);
    }
  }
}

export async function addBlockItem(blockId, teamId, fields) {
  const { data: { user } } = await sb().auth.getUser();
  const siblings = unwrap(await sb().from('block_items').select('id').eq('block_id', blockId)) || [];
  return unwrap(await sb().from('block_items').insert({
    block_id: blockId,
    team_id: teamId,
    title: fields.title,
    description: fields.description || '',
    location: fields.location || '',
    priority: fields.priority || 'normal',
    requires_photo: fields.requiresPhoto !== false,
    assigned_to: fields.assignedTo || null,
    weekdays: fields.weekdays?.length && fields.weekdays.length < 7 ? fields.weekdays : null,
    position: siblings.length,
    created_by: user.id,
  }).select().single());
}

export const updateBlockItem = (id, patch) =>
  sb().from('block_items').update(patch).eq('id', id).select().single().then(unwrap);

export const deleteBlockItem = (id) => sb().from('block_items').delete().eq('id', id).then(unwrap);

/* ---------------------------------------------------------------- dashboard */
export const employeeDayStats = async (date = todayStr()) =>
  unwrap(await sb().rpc('employee_day_stats', { p_date: date })) || [];

export const dailyTrend = async (from, to) =>
  unwrap(await sb().rpc('daily_trend', { p_from: from, p_to: to })) || [];

export async function rangeStats(from, to, userId = null) {
  const rows = unwrap(await sb().rpc('range_stats', { p_from: from, p_to: to, p_member: userId }));
  return rows?.[0] || { total: 0, open: 0, submitted: 0, verified: 0, rejected: 0, completed: 0, photos: 0 };
}

export const listActivity = async (limit = 40) =>
  unwrap(await sb().from('activity').select('*').order('id', { ascending: false }).limit(limit)) || [];

export const teamMemberCount = async () =>
  (unwrap(await sb().from('members').select('id').eq('status', 'active')) || []).length;
