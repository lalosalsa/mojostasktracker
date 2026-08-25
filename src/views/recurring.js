/* Recurring checklists — the tasks that come back every day or every week. */

import { el, esc, toast, busy, sheet, confirmSheet } from '../ui.js';
import * as data from '../data.js';
import { state } from '../store.js';
import { emptyState, skeletonList, sectionHead } from './components.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const describe = (t) =>
  t.recurrence === 'daily' ? 'Every day'
    : t.recurrence === 'weekdays' ? 'Monday to Friday'
      : `Every ${DAYS[t.weekday ?? 1]}`;

export async function recurringView(container) {
  container.innerHTML = '';
  const shell = el('<div></div>');
  shell.appendChild(skeletonList(3));
  container.appendChild(shell);

  const refresh = () => recurringView(container);
  const [templates, employees] = await Promise.all([data.listTemplates(), data.listActiveEmployees()]);

  shell.innerHTML = '';
  shell.appendChild(el(`
    <div class="banner info">
      <span class="ic">🔁</span>
      <div>These create a fresh task automatically each work day, so the crew opens the app and the checklist is already there.</div>
    </div>`));

  const add = el('<button class="btn block mt">＋ New recurring task</button>');
  add.onclick = () => openTemplateEditor(null, employees, refresh);
  shell.appendChild(add);

  const active = templates.filter((t) => t.active);
  const paused = templates.filter((t) => !t.active);

  const render = (list, title) => {
    if (!list.length) return;
    const sec = el(`<div class="section">${sectionHead(title, list.length)}</div>`);
    for (const t of list) {
      const row = el(`
        <div class="list-row" style="cursor:pointer">
          <span class="grow">
            <span style="font-weight:650;display:block">${esc(t.title)}</span>
            <span class="small muted">${esc(describe(t))} · ${esc(t.assignee?.name || 'anyone on the crew')}${t.requires_photo ? ' · 📷 photo required' : ''}</span>
          </span>
          <span class="icon-btn">›</span>
        </div>`);
      row.onclick = () => openTemplateEditor(t, employees, refresh);
      sec.appendChild(row);
    }
    shell.appendChild(sec);
  };

  render(active, 'Running');
  render(paused, 'Paused');

  if (!templates.length) {
    shell.appendChild(emptyState('🔁', 'No recurring tasks yet',
      'Add the jobs that happen every day — opening checks, closing checks, daily cleaning — and they appear automatically.'));
  }
}

function openTemplateEditor(existing, employees, onDone) {
  const t = existing || { recurrence: 'daily', weekday: 1, requires_photo: true, priority: 'normal' };
  const body = el(`
    <div>
      <div class="field">
        <label for="r-title">Task</label>
        <input class="input" id="r-title" maxlength="160" value="${esc(t.title || '')}" placeholder="e.g. Opening checklist — front of house">
      </div>
      <div class="field">
        <label for="r-desc">Instructions</label>
        <textarea class="textarea" id="r-desc">${esc(t.description || '')}</textarea>
      </div>
      <div class="row">
        <div class="field">
          <label for="r-rec">Repeats</label>
          <select class="select" id="r-rec">
            <option value="daily" ${t.recurrence === 'daily' ? 'selected' : ''}>Every day</option>
            <option value="weekdays" ${t.recurrence === 'weekdays' ? 'selected' : ''}>Weekdays only</option>
            <option value="weekly" ${t.recurrence === 'weekly' ? 'selected' : ''}>Once a week</option>
          </select>
        </div>
        <div class="field" id="r-day-wrap" style="${t.recurrence === 'weekly' ? '' : 'display:none'}">
          <label for="r-day">On</label>
          <select class="select" id="r-day">
            ${DAYS.map((d, i) => `<option value="${i}" ${Number(t.weekday ?? 1) === i ? 'selected' : ''}>${d}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label for="r-who">Assign to</label>
          <select class="select" id="r-who">
            <option value="">Anyone on the crew</option>
            ${employees.map((e) => `<option value="${esc(e.id)}" ${e.id === t.assigned_to ? 'selected' : ''}>${esc(e.name || e.email)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="r-loc">Location</label>
          <input class="input" id="r-loc" maxlength="120" value="${esc(t.location || '')}">
        </div>
      </div>
      <label class="switch">
        <input type="checkbox" id="r-photo" ${t.requires_photo === false ? '' : 'checked'}>
        <span>Require a photo</span>
      </label>
      ${existing ? `<label class="switch">
        <input type="checkbox" id="r-active" ${t.active ? 'checked' : ''}>
        <span>Running (uncheck to pause)</span>
      </label>` : ''}
    </div>`);

  body.querySelector('#r-rec').onchange = (e) => {
    body.querySelector('#r-day-wrap').style.display = e.target.value === 'weekly' ? '' : 'none';
  };

  const foot = el(`<div style="display:flex;gap:10px;width:100%">
    ${existing ? '<button class="btn ghost" style="flex:0 0 52px" data-del title="Delete">🗑</button>' : ''}
    <button class="btn ghost" style="flex:1" data-close>Cancel</button>
    <button class="btn" style="flex:2" data-save>${existing ? 'Save' : 'Create'}</button>
  </div>`);
  const s = sheet({ title: existing ? 'Recurring task' : 'New recurring task', body, footer: foot });

  foot.querySelector('[data-del]')?.addEventListener('click', async () => {
    const yes = await confirmSheet({
      title: 'Delete this recurring task?',
      message: 'It stops creating new tasks. Tasks already created stay put.',
      confirmLabel: 'Delete', danger: true,
    });
    if (!yes) return;
    try { await data.deleteTemplate(existing.id); s.close(); toast('Deleted'); onDone?.(); }
    catch (err) { toast(err.message, 'error'); }
  });

  foot.querySelector('[data-save]').onclick = async (e) => {
    const title = body.querySelector('#r-title').value.trim();
    if (!title) { toast('Give it a title', 'error'); return; }
    busy(e.currentTarget);
    const fields = {
      title,
      description: body.querySelector('#r-desc').value.trim(),
      location: body.querySelector('#r-loc').value.trim(),
      assignedTo: body.querySelector('#r-who').value || null,
      recurrence: body.querySelector('#r-rec').value,
      weekday: Number(body.querySelector('#r-day').value),
      requiresPhoto: body.querySelector('#r-photo').checked,
    };
    try {
      if (existing) {
        await data.updateTemplate(existing.id, {
          title: fields.title,
          description: fields.description,
          location: fields.location,
          assigned_to: fields.assignedTo,
          recurrence: fields.recurrence,
          weekday: fields.recurrence === 'weekly' ? fields.weekday : null,
          requires_photo: fields.requiresPhoto,
          active: body.querySelector('#r-active')?.checked ?? true,
        });
      } else {
        await data.createTemplate(fields, state.team?.id);
      }
      await data.ensureTodaysTasks();
      s.close();
      toast('Saved', 'ok');
      onDone?.();
    } catch (err) {
      toast(err.message, 'error');
      busy(e.currentTarget, false);
    }
  };
}
