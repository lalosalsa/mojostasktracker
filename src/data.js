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
  id, title, description, location, status, priority, requires_photo,
  work_date, due_date, notes, review_note, minutes_spent, template_id,
  created_at, started_at, completed_at, reviewed_at,
  assigned_to, created_by, reviewed_by,
  assignee:profiles!tasks_assigned_to_fkey (id, full_name, email),
  reviewer:profiles!tasks_reviewed_by_fkey (id, full_name),
  photos:task_photos (id, storage_path, thumb_path, caption, latitude, longitude, created_at, user_id)
`;

/* ------------------------------------------------------------------ profile */
export async function loadProfile(userId) {
  const { data, error } = await sb().from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw new Error(friendlyError(error));
  return data;
}

export async function waitForProfile(userId, tries = 6) {
  // The signup trigger writes the profile; on a brand-new account it can lag
  // the first session by a few hundred milliseconds.
  for (let i = 0; i < tries; i += 1) {
    const profile = await loadProfile(userId);
    if (profile) return profile;
    await new Promise((r) => setTimeout(r, 300 + i * 250));
  }
  return null;
}

export async function updateMyProfile(patch) {
  const { data: { user } } = await sb().auth.getUser();
  return unwrap(await sb().from('profiles').update(patch).eq('id', user.id).select().single());
}

export const touchLastSeen = () => sb().rpc('touch_last_seen').then(() => {}, () => {});

/* -------------------------------------------------------------------- tasks */
export const ensureTodaysTasks = (date = todayStr()) =>
  sb().rpc('ensure_todays_tasks', { p_date: date }).then(({ data }) => data || 0, () => 0);

export async function listTasks({
  date, from, to, status, assignedTo, search, unassigned, limit = 300,
} = {}) {
  let q = sb().from('tasks').select(TASK_FIELDS);

  if (date) q = q.eq('work_date', date);
  if (from) q = q.gte('work_date', from);
  if (to) q = q.lte('work_date', to);
  if (status === 'open') q = q.in('status', ['open', 'in_progress', 'rejected']);
  else if (status === 'done') q = q.in('status', ['submitted', 'verified']);
  else if (status && status !== 'all') q = q.eq('status', status);
  if (assignedTo) q = q.eq('assigned_to', assignedTo);
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
      b.id - a.id
  );
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
  if (up.error) throw new Error(friendlyError(up.error));

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
        user_id: user.id,
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
  unwrap(await sb().from('profiles').select('*').order('status').order('full_name')) || [];

export const listActiveEmployees = async () =>
  unwrap(
    await sb().from('profiles').select('id, full_name, email, job_title')
      .eq('status', 'active').order('full_name')
  ) || [];

export const updateMember = (id, patch) =>
  sb().from('profiles').update(patch).eq('id', id).select().single().then(unwrap);

export const removeMember = (id) => sb().from('profiles').delete().eq('id', id).then(unwrap);

export const listInvites = async () =>
  unwrap(await sb().from('invites').select('*').order('created_at', { ascending: false })) || [];

export async function inviteMember({ email, fullName = '', jobTitle = '', role = 'employee' }) {
  const { data: { user } } = await sb().auth.getUser();
  return unwrap(
    await sb().from('invites').upsert({
      email: email.trim().toLowerCase(),
      full_name: fullName,
      job_title: jobTitle,
      role,
      invited_by: user.id,
    }).select().single()
  );
}

export const cancelInvite = (email) => sb().from('invites').delete().eq('email', email).then(unwrap);

/* ---------------------------------------------------------------- templates */
export const listTemplates = async () =>
  unwrap(
    await sb().from('task_templates')
      .select('*, assignee:profiles!task_templates_assigned_to_fkey (id, full_name)')
      .order('active', { ascending: false }).order('title')
  ) || [];

export async function createTemplate(fields) {
  const { data: { user } } = await sb().auth.getUser();
  return unwrap(
    await sb().from('task_templates').insert({
      title: fields.title,
      description: fields.description || '',
      location: fields.location || '',
      priority: fields.priority || 'normal',
      requires_photo: fields.requiresPhoto !== false,
      assigned_to: fields.assignedTo || null,
      recurrence: fields.recurrence || 'daily',
      weekday: fields.recurrence === 'weekly' ? Number(fields.weekday ?? 1) : null,
      created_by: user.id,
    }).select().single()
  );
}

export const updateTemplate = (id, patch) =>
  sb().from('task_templates').update(patch).eq('id', id).select().single().then(unwrap);

export const deleteTemplate = (id) => sb().from('task_templates').delete().eq('id', id).then(unwrap);

/* ---------------------------------------------------------------- dashboard */
export const employeeDayStats = async (date = todayStr()) =>
  unwrap(await sb().rpc('employee_day_stats', { p_date: date })) || [];

export const dailyTrend = async (from, to) =>
  unwrap(await sb().rpc('daily_trend', { p_from: from, p_to: to })) || [];

export async function rangeStats(from, to, userId = null) {
  const rows = unwrap(await sb().rpc('range_stats', { p_from: from, p_to: to, p_user: userId }));
  return rows?.[0] || { total: 0, open: 0, submitted: 0, verified: 0, rejected: 0, completed: 0, photos: 0 };
}

export const listActivity = async (limit = 40) =>
  unwrap(await sb().from('activity').select('*').order('id', { ascending: false }).limit(limit)) || [];

export const pendingMembers = async () =>
  unwrap(await sb().from('profiles').select('*').eq('status', 'pending').order('created_at')) || [];
