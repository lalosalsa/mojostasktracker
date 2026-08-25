/* Manager task board: assign work, filter by person or day. */

import { el, esc, toast, busy, sheet, fmtDate } from '../ui.js';
import * as data from '../data.js';
import { navigate } from '../router.js';
import { taskCard, emptyState, skeletonList, sectionHead, statTile, blockHeading } from './components.js';
import { openTaskSheet } from './taskSheet.js';

export async function taskBoardView(container, params = {}) {
  container.innerHTML = '';
  const shell = el('<div></div>');
  shell.appendChild(skeletonList(4));
  container.appendChild(shell);

  const date = params.date || data.todayStr();
  const assignee = params.assignee || '';
  const status = params.status || 'all';

  const fab = el('<button class="fab">＋ New task</button>');
  fab.onclick = () => openTaskEditor(null, () => taskBoardView(container, params));
  container.appendChild(fab);

  await data.ensureTodaysTasks(date);
  const [employees, tasks] = await Promise.all([
    data.listActiveEmployees(),
    data.listTasks({
      date: params.all ? undefined : date,
      assignedTo: assignee || undefined,
      status,
      limit: 300,
    }),
  ]);

  const refresh = () => taskBoardView(container, params);
  const setParam = (patch) => {
    const next = { date, assignee, status, ...patch };
    const q = new URLSearchParams(
      Object.entries(next).filter(([, v]) => v && v !== 'all')
    ).toString();
    navigate(`/tasks${q ? `?${q}` : ''}`);
  };

  shell.innerHTML = '';

  const filters = el(`
    <div class="card card-tight">
      <div class="row">
        <div class="field" style="margin-bottom:0">
          <label for="f-date">Day</label>
          <input class="input" id="f-date" type="date" value="${esc(date)}">
        </div>
        <div class="field" style="margin-bottom:0">
          <label for="f-person">Person</label>
          <select class="select" id="f-person">
            <option value="">Everyone</option>
            ${employees.map((e) => `<option value="${esc(e.id)}" ${e.id === assignee ? 'selected' : ''}>${esc(e.name || e.email)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="field mt" style="margin-bottom:0">
        <label for="f-status">Show</label>
        <select class="select" id="f-status">
          <option value="all" ${status === 'all' ? 'selected' : ''}>Everything</option>
          <option value="open" ${status === 'open' ? 'selected' : ''}>Still open</option>
          <option value="submitted" ${status === 'submitted' ? 'selected' : ''}>Waiting on review</option>
          <option value="verified" ${status === 'verified' ? 'selected' : ''}>Verified</option>
          <option value="rejected" ${status === 'rejected' ? 'selected' : ''}>Sent back</option>
        </select>
      </div>
    </div>`);
  filters.querySelector('#f-date').onchange = (e) => setParam({ date: e.target.value });
  filters.querySelector('#f-person').onchange = (e) => setParam({ assignee: e.target.value });
  filters.querySelector('#f-status').onchange = (e) => setParam({ status: e.target.value });
  shell.appendChild(filters);

  const done = tasks.filter((t) => t.isDone).length;
  const needsReview = tasks.filter((t) => t.status === 'submitted').length;
  shell.appendChild(el(`
    <div class="stats mt">
      ${statTile(tasks.length, 'Tasks')}
      ${statTile(done, 'Done', 'ok')}
      ${statTile(needsReview, 'To review', needsReview ? 'warn' : '')}
      ${statTile(tasks.filter((t) => !t.assigned_to).length, 'Unassigned')}
    </div>`));

  if (!tasks.length) {
    shell.appendChild(emptyState('📋', 'No tasks for this filter', `Nothing on ${fmtDate(date)}. Use the button below to add one.`));
    return;
  }

  for (const group of data.groupByBlock(tasks)) {
    const sec = el(`<div class="section">${blockHeading(group)}</div>`);
    for (const task of group.tasks) {
      sec.appendChild(taskCard(task, (t) => openTaskSheet(t, { onChange: refresh }), { showAssignee: true }));
    }
    shell.appendChild(sec);
  }
}

/** Create / edit a task as a manager. */
export async function openTaskEditor(existing, onDone) {
  const employees = await data.listActiveEmployees();
  const t = existing || {};
  const body = el(`
    <div>
      <div class="field">
        <label for="t-title">Task</label>
        <input class="input" id="t-title" maxlength="160" value="${esc(t.title || '')}" placeholder="e.g. Deep clean the break room">
      </div>
      <div class="field">
        <label for="t-desc">Instructions</label>
        <textarea class="textarea" id="t-desc" placeholder="What good looks like, what to photograph…">${esc(t.description || '')}</textarea>
      </div>
      <div class="row">
        <div class="field">
          <label for="t-who">Assign to</label>
          <select class="select" id="t-who">
            <option value="">Anyone on the crew</option>
            ${employees.map((e) => `<option value="${esc(e.id)}" ${e.id === t.assigned_to ? 'selected' : ''}>${esc(e.name || e.email)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="t-date">Day</label>
          <input class="input" id="t-date" type="date" value="${esc(t.work_date || data.todayStr())}">
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label for="t-priority">Priority</label>
          <select class="select" id="t-priority">
            ${['low', 'normal', 'high', 'urgent'].map((p) =>
              `<option value="${p}" ${(t.priority || 'normal') === p ? 'selected' : ''}>${p[0].toUpperCase() + p.slice(1)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="t-loc">Location</label>
          <input class="input" id="t-loc" maxlength="120" value="${esc(t.location || '')}" placeholder="Site / room">
        </div>
      </div>
      <label class="switch">
        <input type="checkbox" id="t-photo" ${t.requires_photo === false ? '' : 'checked'}>
        <span>Require a photo before it can be marked done</span>
      </label>
    </div>`);

  const foot = el(`<div style="display:flex;gap:10px;width:100%">
    <button class="btn ghost" style="flex:1" data-close>Cancel</button>
    <button class="btn" style="flex:2" data-save>${existing ? 'Save changes' : 'Create task'}</button>
  </div>`);
  const s = sheet({ title: existing ? 'Edit task' : 'New task', body, footer: foot });
  setTimeout(() => body.querySelector('#t-title').focus(), 90);

  foot.querySelector('[data-save]').onclick = async (e) => {
    const title = body.querySelector('#t-title').value.trim();
    if (!title) { toast('Give the task a title', 'error'); return; }
    busy(e.currentTarget);
    const fields = {
      title,
      description: body.querySelector('#t-desc').value.trim(),
      location: body.querySelector('#t-loc').value.trim(),
      priority: body.querySelector('#t-priority').value,
      assignedTo: body.querySelector('#t-who').value || null,
      workDate: body.querySelector('#t-date').value || data.todayStr(),
      requiresPhoto: body.querySelector('#t-photo').checked,
    };
    try {
      if (existing) {
        await data.updateTask(existing.id, {
          title: fields.title,
          description: fields.description,
          location: fields.location,
          priority: fields.priority,
          assigned_to: fields.assignedTo,
          work_date: fields.workDate,
          requires_photo: fields.requiresPhoto,
        });
      } else {
        await data.createTask(fields);
      }
      s.close();
      toast(existing ? 'Task updated' : 'Task created', 'ok');
      onDone?.();
    } catch (err) {
      toast(err.message, 'error');
      busy(e.currentTarget, false);
    }
  };
}
