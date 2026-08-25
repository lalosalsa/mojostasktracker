/* The manager's schedule: import shifts, see who's on, and hand out the
   time-boxed work. */

import { el, esc, toast, busy, sheet, confirmSheet, fmtDate, initials } from '../ui.js';
import * as data from '../data.js';
import { state } from '../store.js';
import { navigate } from '../router.js';
import { emptyState, skeletonList, sectionHead, statTile } from './components.js';
import { readSpreadsheet, detectColumns, rowsToShifts, looksLikeHeader } from '../spreadsheet.js';

const fmtClock = (t) => {
  if (!t) return '';
  const [h, m] = String(t).split(':').map(Number);
  const suffix = h < 12 ? 'am' : 'pm';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hour}:${String(m).padStart(2, '0')}${suffix}` : `${hour}${suffix}`;
};
export { fmtClock };

export async function scheduleView(container, params = {}) {
  container.innerHTML = '';
  const shell = el('<div></div>');
  shell.appendChild(skeletonList(3));
  container.appendChild(shell);

  const date = params.date || data.todayStr();
  const refresh = () => scheduleView(container, { date });

  const [shifts, windows, team] = await Promise.all([
    data.daySchedule(date),
    data.listWindows(),
    data.listTeam(),
  ]);
  const activeTeam = team.filter((m) => m.status === 'active');

  shell.innerHTML = '';

  const picker = el(`
    <div class="card card-tight">
      <div class="field" style="margin-bottom:0">
        <label for="sc-date">Day</label>
        <input class="input" id="sc-date" type="date" value="${esc(date)}">
      </div>
      <div class="btn-row mt">
        <button class="btn sm" data-import>⬆ Import schedule</button>
        <button class="btn ghost sm" data-windows>⏱ Time blocks</button>
      </div>
    </div>`);
  picker.querySelector('#sc-date').onchange = (e) => scheduleView(container, { date: e.target.value });
  picker.querySelector('[data-import]').onclick = () => openImportSheet(refresh);
  picker.querySelector('[data-windows]').onclick = () => navigate('/windows');
  shell.appendChild(picker);

  const onShift = shifts.length;
  const unmatched = shifts.filter((s) => !s.matched);
  const assigned = shifts.reduce((n, s) => n + Number(s.task_count || 0), 0);

  shell.appendChild(el(`
    <div class="stats mt">
      ${statTile(onShift, 'On shift', onShift ? 'brand' : '')}
      ${statTile(assigned, 'Tasks out')}
      ${statTile(windows.filter((w) => w.active).length, 'Time blocks')}
      ${statTile(unmatched.length, 'Unmatched', unmatched.length ? 'danger' : '')}
    </div>`));

  if (unmatched.length) {
    const warn = el(`
      <div class="banner warn mt">
        <span class="ic">⚠︎</span>
        <div><strong>${unmatched.length} name${unmatched.length === 1 ? '' : 's'} on the schedule
        ${unmatched.length === 1 ? "doesn't" : "don't"} match anyone on your team</strong><br>
        They won't get tasks until you link them. Tap a name below.</div>
      </div>`);
    shell.appendChild(warn);
  }

  const generate = el(`<button class="btn block mt">⚡ Hand out tasks for ${esc(fmtDate(date))}</button>`);
  generate.onclick = async () => {
    busy(generate);
    try {
      const made = await data.generateScheduledTasks(date);
      toast(made ? `Assigned ${made} task${made === 1 ? '' : 's'}` : 'Everyone already has their tasks', 'ok');
      refresh();
    } catch (err) {
      toast(err.message, 'error');
      busy(generate, false);
    }
  };
  shell.appendChild(generate);

  if (!windows.filter((w) => w.active).length) {
    shell.appendChild(el(`
      <div class="banner info mt">
        <span class="ic">💡</span>
        <div>Set up <strong>time blocks</strong> first — "sweep the floor between 2 and 4" — and this
        button hands them to whoever is on shift then.</div>
      </div>`));
  }

  /* ---- the day's shifts ---- */
  const sec = el(`<div class="section">${sectionHead("Who's working", shifts.length)}</div>`);
  if (!shifts.length) {
    sec.appendChild(emptyState('🗓', 'No shifts for this day',
      'Import your Square schedule, or add shifts by hand from the import screen.'));
  }
  for (const s of shifts) {
    const row = el(`
      <div class="list-row" ${s.matched ? '' : 'style="cursor:pointer;border-color:var(--warn)"'}>
        <span class="avatar">${esc(initials(s.person_name))}</span>
        <span class="grow">
          <span style="font-weight:650;display:block">${esc(s.person_name)}
            ${s.matched ? '' : '<span class="chip warn" style="margin-left:6px">not linked</span>'}</span>
          <span class="small muted">${esc(fmtClock(s.starts_at))} – ${esc(fmtClock(s.ends_at))}
            ${s.matched ? ` · ${s.done_count}/${s.task_count} done` : ''}</span>
        </span>
        ${s.matched ? `<span class="chip ${Number(s.task_count) ? '' : 'info'}">${s.task_count} task${Number(s.task_count) === 1 ? '' : 's'}</span>` : '<span class="icon-btn">›</span>'}
      </div>`);
    if (!s.matched) row.onclick = () => openLinkSheet(s.person_name, activeTeam, refresh);
    sec.appendChild(row);
  }
  shell.appendChild(sec);
}

/** Point a schedule spelling at a real team member. */
function openLinkSheet(personName, team, onDone) {
  const body = el(`
    <div>
      <p class="small muted">The schedule says <strong>${esc(personName)}</strong>. Who is that?</p>
      <div class="field mt">
        <label for="lk-member">Team member</label>
        <select class="select" id="lk-member">
          <option value="">Choose…</option>
          ${team.map((m) => `<option value="${esc(m.id)}">${esc(m.name || m.email)}</option>`).join('')}
        </select>
        <div class="hint">We'll remember this spelling for future imports.</div>
      </div>
    </div>`);
  const foot = el(`<div style="display:flex;gap:10px;width:100%">
    <button class="btn ghost" style="flex:1" data-close>Cancel</button>
    <button class="btn" style="flex:1" data-save>Link</button>
  </div>`);
  const s = sheet({ title: 'Link this name', body, footer: foot });

  foot.querySelector('[data-save]').onclick = async (e) => {
    const memberId = body.querySelector('#lk-member').value;
    if (!memberId) return toast('Pick who it is', 'error');
    busy(e.currentTarget);
    try {
      await data.linkScheduleName(memberId, personName);
      s.close();
      toast('Linked', 'ok');
      onDone?.();
    } catch (err) { toast(err.message, 'error'); busy(e.currentTarget, false); }
  };
}

/* ============================================================ the importer */

/**
 * Upload → confirm the columns → preview → save.
 * The preview matters: Square's export layout varies, so the manager sees
 * exactly what we read before anything is written.
 */
export function openImportSheet(onDone) {
  const body = el(`
    <div>
      <div class="banner info">
        <span class="ic">📄</span>
        <div>Export your schedule from Square as <strong>.xlsx</strong> or <strong>.csv</strong>,
        then pick the file here. One row per shift.</div>
      </div>
      <button class="btn block mt" data-pick>Choose file</button>
      <div data-stage></div>
    </div>`);
  const foot = el(`<div style="display:flex;gap:10px;width:100%">
    <button class="btn ghost" style="flex:1" data-close>Cancel</button>
  </div>`);
  const s = sheet({ title: 'Import a schedule', body, footer: foot });
  const stage = body.querySelector('[data-stage]');

  body.querySelector('[data-pick]').onclick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xlsm,.csv,.txt,text/csv';
    input.onchange = async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      stage.innerHTML = '<p class="small muted mt">Reading…</p>';
      try {
        const rows = await readSpreadsheet(file);
        if (rows.length < 2) throw new Error('That file has no rows in it');
        showMapping(rows, file.name);
      } catch (err) {
        stage.innerHTML = '';
        stage.appendChild(el(`<div class="banner danger mt"><span class="ic">⚠︎</span><div>${esc(err.message)}</div></div>`));
      }
    };
    document.body.appendChild(input);
    input.click();
  };

  function showMapping(rows, fileName) {
    const headerRow = looksLikeHeader(rows[0]) ? 0 : -1;
    const header = headerRow === 0 ? rows[0] : rows[0].map((_, i) => `Column ${i + 1}`);
    let mapping = headerRow === 0 ? detectColumns(rows[0]) : { name: 0, date: 1, start: 2, end: 3 };
    let dayFirst = false;

    const options = (selected) =>
      header.map((h, i) =>
        `<option value="${i}" ${Number(selected) === i ? 'selected' : ''}>${esc(String(h || `Column ${i + 1}`).slice(0, 40))}</option>`
      ).join('');

    stage.innerHTML = '';
    const ui = el(`
      <div class="mt">
        <p class="small muted">${esc(fileName)} · ${rows.length - (headerRow + 1)} rows</p>
        <div class="row mt">
          <div class="field">
            <label for="mp-name">Employee column</label>
            <select class="select" id="mp-name">${options(mapping.name)}</select>
          </div>
          <div class="field">
            <label for="mp-date">Date column</label>
            <select class="select" id="mp-date">${options(mapping.date)}</select>
          </div>
        </div>
        <div class="row">
          <div class="field">
            <label for="mp-start">Start time</label>
            <select class="select" id="mp-start">${options(mapping.start)}</select>
          </div>
          <div class="field">
            <label for="mp-end">End time</label>
            <select class="select" id="mp-end">${options(mapping.end)}</select>
          </div>
        </div>
        <label class="switch">
          <input type="checkbox" id="mp-dayfirst">
          <span>Dates are day/month (not month/day)</span>
        </label>
        <div data-preview></div>
      </div>`);
    stage.appendChild(ui);

    const preview = ui.querySelector('[data-preview]');
    const readMapping = () => ({
      name: Number(ui.querySelector('#mp-name').value),
      date: Number(ui.querySelector('#mp-date').value),
      start: Number(ui.querySelector('#mp-start').value),
      end: Number(ui.querySelector('#mp-end').value),
    });

    const render = () => {
      mapping = readMapping();
      dayFirst = ui.querySelector('#mp-dayfirst').checked;
      const { shifts, skipped } = rowsToShifts(rows, mapping, { dayFirst, headerRow });

      preview.innerHTML = '';
      if (!shifts.length) {
        preview.appendChild(el(`
          <div class="banner danger mt"><span class="ic">⚠︎</span>
          <div>Nothing readable with those columns. Check the dropdowns above.</div></div>`));
        return;
      }

      const days = [...new Set(shifts.map((x) => x.date))].sort();
      const people = [...new Set(shifts.map((x) => x.person))];
      preview.appendChild(el(`
        <div class="banner ok mt"><span class="ic">✓</span>
        <div><strong>${shifts.length} shifts</strong> · ${people.length} people ·
        ${days.length} day${days.length === 1 ? '' : 's'}
        (${esc(fmtDate(days[0], { weekday: false }))}${days.length > 1 ? ` – ${esc(fmtDate(days[days.length - 1], { weekday: false }))}` : ''})</div></div>`));

      const table = el('<div class="card card-tight mt"></div>');
      for (const row of shifts.slice(0, 6)) {
        table.appendChild(el(`
          <div style="display:flex;gap:8px;padding:5px 0;font-size:13px;border-bottom:1px solid var(--line)">
            <span style="flex:1;font-weight:600">${esc(row.person)}</span>
            <span class="muted">${esc(fmtDate(row.date, { weekday: false }))}</span>
            <span>${esc(fmtClock(row.start))}–${esc(fmtClock(row.end))}</span>
          </div>`));
      }
      if (shifts.length > 6) {
        table.appendChild(el(`<p class="small muted" style="padding-top:6px">…and ${shifts.length - 6} more</p>`));
      }
      preview.appendChild(table);

      if (skipped.length) {
        const list = skipped.slice(0, 5)
          .map((k) => `<li style="padding:3px 0">Row ${k.row}: ${esc(k.reason)} — <span class="muted">${esc(k.raw.slice(0, 60))}</span></li>`)
          .join('');
        preview.appendChild(el(`
          <div class="banner warn mt"><span class="ic">⚠︎</span>
          <div><strong>${skipped.length} row${skipped.length === 1 ? '' : 's'} skipped</strong>
          <ul style="margin:6px 0 0;padding-left:16px;font-size:12.5px">${list}</ul>
          ${skipped.length > 5 ? `<p class="small">…and ${skipped.length - 5} more</p>` : ''}</div></div>`));
      }

      foot.innerHTML = '';
      const cancel = el('<button class="btn ghost" style="flex:1" data-close>Cancel</button>');
      const save = el(`<button class="btn" style="flex:2">Import ${shifts.length} shifts</button>`);
      save.onclick = async () => {
        busy(save);
        const { saved, failures } = await data.importShifts(shifts, (done, total) => {
          save.innerHTML = `<span class="spinner"></span> ${done}/${total}`;
        });
        s.close();
        if (failures.length) {
          toast(`Imported ${saved}, ${failures.length} failed — ${failures[0].message}`, 'error');
        } else {
          toast(`Imported ${saved} shifts`, 'ok');
        }
        onDone?.();
      };
      foot.append(cancel, save);
    };

    ui.querySelectorAll('select, #mp-dayfirst').forEach((n) => { n.onchange = render; });
    render();
  }
}

/* ========================================================== time blocks */

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export async function windowsView(container) {
  container.innerHTML = '';
  const shell = el('<div></div>');
  shell.appendChild(skeletonList(3));
  container.appendChild(shell);

  const refresh = () => windowsView(container);
  const windows = await data.listWindows();

  shell.innerHTML = '';
  shell.appendChild(el(`
    <div class="banner info">
      <span class="ic">⏱</span>
      <div>A time block is a job that has to happen inside a window — "restock between 2 and 4".
      When you hand out tasks, whoever is on shift then gets it.</div>
    </div>`));

  const add = el('<button class="btn block mt">＋ New time block</button>');
  add.onclick = () => openWindowEditor(null, refresh);
  shell.appendChild(add);

  const active = windows.filter((w) => w.active);
  const paused = windows.filter((w) => !w.active);

  const render = (list, title) => {
    if (!list.length) return;
    const sec = el(`<div class="section">${sectionHead(title, list.length)}</div>`);
    for (const w of list) {
      const when = w.recurrence === 'daily' ? 'every day'
        : w.recurrence === 'weekdays' ? 'Mon–Fri'
          : `every ${DAYS[w.weekday ?? 1]}`;
      const row = el(`
        <div class="list-row" style="cursor:pointer">
          <span class="grow">
            <span style="font-weight:650;display:block">${esc(w.title)}</span>
            <span class="small muted">${esc(fmtClock(w.starts_at))} – ${esc(fmtClock(w.ends_at))} · ${esc(when)} ·
              ${w.assign_mode === 'one' ? 'one person' : 'everyone on shift'}${w.requires_photo ? ' · 📷' : ''}</span>
          </span>
          <span class="icon-btn">›</span>
        </div>`);
      row.onclick = () => openWindowEditor(w, refresh);
      sec.appendChild(row);
    }
    shell.appendChild(sec);
  };

  render(active, 'Running');
  render(paused, 'Paused');

  if (!windows.length) {
    shell.appendChild(emptyState('⏱', 'No time blocks yet',
      'Add the jobs that have to happen at a certain hour, and the app will match them to whoever is working.'));
  }
}

function openWindowEditor(existing, onDone) {
  const w = existing || {
    starts_at: '09:00', ends_at: '11:00', recurrence: 'daily', weekday: 1,
    assign_mode: 'everyone', requires_photo: true, priority: 'normal',
  };
  const body = el(`
    <div>
      <div class="field">
        <label for="w-title">What needs doing</label>
        <input class="input" id="w-title" maxlength="160" value="${esc(w.title || '')}"
               placeholder="e.g. Restock the front cooler">
      </div>
      <div class="field">
        <label for="w-desc">Instructions</label>
        <textarea class="textarea" id="w-desc">${esc(w.description || '')}</textarea>
      </div>
      <div class="row">
        <div class="field">
          <label for="w-start">Between</label>
          <input class="input" id="w-start" type="time" value="${esc(String(w.starts_at).slice(0, 5))}">
        </div>
        <div class="field">
          <label for="w-end">and</label>
          <input class="input" id="w-end" type="time" value="${esc(String(w.ends_at).slice(0, 5))}">
        </div>
      </div>
      <div class="field">
        <label for="w-mode">Who gets it</label>
        <select class="select" id="w-mode">
          <option value="everyone" ${w.assign_mode === 'everyone' ? 'selected' : ''}>Everyone on shift in that window</option>
          <option value="one" ${w.assign_mode === 'one' ? 'selected' : ''}>Just one person (whoever covers it best)</option>
        </select>
      </div>
      <div class="row">
        <div class="field">
          <label for="w-rec">Repeats</label>
          <select class="select" id="w-rec">
            <option value="daily" ${w.recurrence === 'daily' ? 'selected' : ''}>Every day</option>
            <option value="weekdays" ${w.recurrence === 'weekdays' ? 'selected' : ''}>Weekdays only</option>
            <option value="weekly" ${w.recurrence === 'weekly' ? 'selected' : ''}>Once a week</option>
          </select>
        </div>
        <div class="field" id="w-day-wrap" style="${w.recurrence === 'weekly' ? '' : 'display:none'}">
          <label for="w-day">On</label>
          <select class="select" id="w-day">
            ${DAYS.map((d, i) => `<option value="${i}" ${Number(w.weekday ?? 1) === i ? 'selected' : ''}>${d}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="field">
        <label for="w-loc">Location</label>
        <input class="input" id="w-loc" maxlength="120" value="${esc(w.location || '')}">
      </div>
      <label class="switch">
        <input type="checkbox" id="w-photo" ${w.requires_photo === false ? '' : 'checked'}>
        <span>Require a photo</span>
      </label>
      ${existing ? `<label class="switch">
        <input type="checkbox" id="w-active" ${w.active ? 'checked' : ''}>
        <span>Running (uncheck to pause)</span>
      </label>` : ''}
    </div>`);

  body.querySelector('#w-rec').onchange = (e) => {
    body.querySelector('#w-day-wrap').style.display = e.target.value === 'weekly' ? '' : 'none';
  };

  const foot = el(`<div style="display:flex;gap:10px;width:100%">
    ${existing ? '<button class="btn ghost" style="flex:0 0 52px" data-del title="Delete">🗑</button>' : ''}
    <button class="btn ghost" style="flex:1" data-close>Cancel</button>
    <button class="btn" style="flex:2" data-save>${existing ? 'Save' : 'Create'}</button>
  </div>`);
  const s = sheet({ title: existing ? 'Time block' : 'New time block', body, footer: foot });

  foot.querySelector('[data-del]')?.addEventListener('click', async () => {
    const yes = await confirmSheet({
      title: 'Delete this time block?',
      message: 'It stops creating new tasks. Tasks already handed out stay put.',
      confirmLabel: 'Delete', danger: true,
    });
    if (!yes) return;
    try { await data.deleteWindow(existing.id); s.close(); toast('Deleted'); onDone?.(); }
    catch (err) { toast(err.message, 'error'); }
  });

  foot.querySelector('[data-save]').onclick = async (e) => {
    const title = body.querySelector('#w-title').value.trim();
    const startsAt = body.querySelector('#w-start').value;
    const endsAt = body.querySelector('#w-end').value;
    if (!title) return toast('Give it a title', 'error');
    if (!startsAt || !endsAt) return toast('Set both times', 'error');
    if (endsAt <= startsAt) return toast('The end time has to be after the start time', 'error');

    busy(e.currentTarget);
    const fields = {
      title,
      description: body.querySelector('#w-desc').value.trim(),
      location: body.querySelector('#w-loc').value.trim(),
      startsAt, endsAt,
      recurrence: body.querySelector('#w-rec').value,
      weekday: Number(body.querySelector('#w-day').value),
      assignMode: body.querySelector('#w-mode').value,
      requiresPhoto: body.querySelector('#w-photo').checked,
    };
    try {
      if (existing) {
        await data.updateWindow(existing.id, {
          title: fields.title,
          description: fields.description,
          location: fields.location,
          starts_at: fields.startsAt,
          ends_at: fields.endsAt,
          recurrence: fields.recurrence,
          weekday: fields.recurrence === 'weekly' ? fields.weekday : null,
          assign_mode: fields.assignMode,
          requires_photo: fields.requiresPhoto,
          active: body.querySelector('#w-active')?.checked ?? true,
        });
      } else {
        await data.createWindow(fields, state.team?.id);
      }
      s.close();
      toast('Saved', 'ok');
      onDone?.();
    } catch (err) {
      toast(err.message, 'error');
      busy(e.currentTarget, false);
    }
  };
}
