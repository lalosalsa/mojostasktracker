/* The manager builds the day here: named blocks, each holding its own list of
   jobs. Whatever is in these blocks becomes the crew's shared list tomorrow
   morning — and today, the moment you add it. */

import { el, esc, toast, busy, sheet, confirmSheet } from '../ui.js';
import * as data from '../data.js';
import { state } from '../store.js';
import { emptyState, skeletonList, sectionHead } from './components.js';

export const fmtClock = (t) => {
  if (!t) return '';
  const [h, m] = String(t).split(':').map(Number);
  const suffix = h < 12 ? 'am' : 'pm';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hour}:${String(m).padStart(2, '0')}${suffix}` : `${hour}${suffix}`;
};

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "every day", "Mon–Fri", or the specific days chosen. */
export function weekdayLabel(weekdays) {
  if (!weekdays?.length || weekdays.length === 7) return 'every day';
  const set = [...weekdays].sort();
  if (set.join() === '1,2,3,4,5') return 'Mon–Fri';
  if (set.join() === '0,6') return 'weekends';
  return set.map((d) => DAY_NAMES[d].slice(0, 3)).join(', ');
}

export const blockWhen = (block) => {
  if (block.starts_at && block.ends_at) return `${fmtClock(block.starts_at)} – ${fmtClock(block.ends_at)}`;
  if (block.starts_at) return `from ${fmtClock(block.starts_at)}`;
  if (block.ends_at) return `until ${fmtClock(block.ends_at)}`;
  return 'any time';
};

export async function blocksView(container) {
  container.innerHTML = '';
  const shell = el('<div></div>');
  shell.appendChild(skeletonList(3));
  container.appendChild(shell);

  const refresh = () => blocksView(container);
  const blocks = await data.listBlocks();

  shell.innerHTML = '';
  shell.appendChild(el(`
    <div class="banner info">
      <span class="ic">🧱</span>
      <div>Break the day into blocks — <strong>Morning Prep</strong>, <strong>Lunch Rush</strong>,
      <strong>Closing</strong> — and fill each with what needs doing. The crew opens the app to
      that list every day; whoever does a job puts their name on it.</div>
    </div>`));

  const add = el('<button class="btn block mt">＋ New block</button>');
  add.onclick = () => openBlockEditor(null, refresh);
  shell.appendChild(add);

  const active = blocks.filter((b) => b.active);
  const paused = blocks.filter((b) => !b.active);

  const renderBlock = (block, index, list) => {
    const items = (block.items || []).filter((i) => i.active).sort((a, b) => a.position - b.position);
    const card = el(`
      <div class="card" style="padding:0;overflow:hidden">
        <div style="display:flex;align-items:center;gap:10px;padding:14px 14px 10px">
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:15.5px">${esc(block.name)}</div>
            <div class="small muted">${esc(blockWhen(block))} · ${items.length} task${items.length === 1 ? '' : 's'}</div>
          </div>
          <button class="icon-btn" data-up title="Move earlier" ${index === 0 ? 'disabled style="opacity:.35"' : ''}>↑</button>
          <button class="icon-btn" data-down title="Move later" ${index === list.length - 1 ? 'disabled style="opacity:.35"' : ''}>↓</button>
          <button class="icon-btn" data-edit title="Rename or set times">✎</button>
        </div>
        <div data-items style="padding:0 14px"></div>
        <div style="padding:10px 14px 14px">
          <button class="btn ghost sm block" data-add>＋ Add a task to ${esc(block.name)}</button>
        </div>
      </div>`);

    const itemList = card.querySelector('[data-items]');
    if (!items.length) {
      itemList.appendChild(el('<p class="small muted" style="padding-bottom:6px">Nothing in this block yet.</p>'));
    }
    for (const item of items) {
      const row = el(`
        <div style="display:flex;align-items:center;gap:8px;padding:9px 0;border-top:1px solid var(--line);cursor:pointer">
          <span style="flex:1;min-width:0;font-size:14px">${esc(item.title)}
            ${item.requires_photo ? '<span class="chip info" style="margin-left:6px">📷</span>' : ''}
            ${item.priority !== 'normal' ? `<span class="chip" style="margin-left:4px">${esc(item.priority)}</span>` : ''}
            ${item.weekdays?.length && item.weekdays.length < 7
              ? `<span class="chip warn" style="margin-left:4px">${esc(weekdayLabel(item.weekdays))}</span>` : ''}
          </span>
          <span class="icon-btn" style="width:28px;height:28px;font-size:14px">›</span>
        </div>`);
      row.onclick = () => openItemEditor(block, item, refresh);
      itemList.appendChild(row);
    }

    card.querySelector('[data-add]').onclick = () => openItemEditor(block, null, refresh);
    card.querySelector('[data-edit]').onclick = () => openBlockEditor(block, refresh);
    card.querySelector('[data-up]').onclick = async () => {
      await data.moveBlock(list, block.id, -1);
      refresh();
    };
    card.querySelector('[data-down]').onclick = async () => {
      await data.moveBlock(list, block.id, 1);
      refresh();
    };
    return card;
  };

  if (active.length) {
    const sec = el(`<div class="section">${sectionHead('The day', active.length)}</div>`);
    active.forEach((b, i) => sec.appendChild(renderBlock(b, i, active)));
    shell.appendChild(sec);
  }

  if (paused.length) {
    const sec = el(`<div class="section">${sectionHead('Paused', paused.length)}</div>`);
    paused.forEach((b, i) => sec.appendChild(renderBlock(b, i, paused)));
    shell.appendChild(sec);
  }

  if (!blocks.length) {
    shell.appendChild(emptyState('🧱', 'No blocks yet',
      'Start with something like "Opening" or "Morning Prep", then add the jobs that belong in it.'));
  }
}

/* ------------------------------------------------------------ block editor */
function openBlockEditor(existing, onDone) {
  const b = existing || { name: '', starts_at: '', ends_at: '', active: true };
  const body = el(`
    <div>
      <div class="field">
        <label for="b-name">Block name</label>
        <input class="input" id="b-name" maxlength="60" value="${esc(b.name || '')}"
               placeholder="e.g. Morning Prep">
        <div class="hint">This is the heading your crew sees.</div>
      </div>
      <div class="row">
        <div class="field">
          <label for="b-start">Starts (optional)</label>
          <input class="input" id="b-start" type="time" value="${esc(String(b.starts_at || '').slice(0, 5))}">
        </div>
        <div class="field">
          <label for="b-end">Ends (optional)</label>
          <input class="input" id="b-end" type="time" value="${esc(String(b.ends_at || '').slice(0, 5))}">
        </div>
      </div>
      <p class="small muted">Leave the times blank for a block that isn't tied to a clock.</p>
      ${existing ? `<label class="switch">
        <input type="checkbox" id="b-active" ${b.active ? 'checked' : ''}>
        <span>In use (uncheck to pause)</span>
      </label>` : ''}
    </div>`);

  const foot = el(`<div style="display:flex;gap:10px;width:100%">
    ${existing ? '<button class="btn ghost" style="flex:0 0 52px" data-del title="Delete">🗑</button>' : ''}
    <button class="btn ghost" style="flex:1" data-close>Cancel</button>
    <button class="btn" style="flex:2" data-save>${existing ? 'Save' : 'Create block'}</button>
  </div>`);
  const s = sheet({ title: existing ? 'Edit block' : 'New block', body, footer: foot });
  setTimeout(() => body.querySelector('#b-name').focus(), 90);

  foot.querySelector('[data-del]')?.addEventListener('click', async () => {
    const yes = await confirmSheet({
      title: `Delete "${existing.name}"?`,
      message: 'The block and its task list go away. Tasks already done stay in your records.',
      confirmLabel: 'Delete', danger: true,
    });
    if (!yes) return;
    try { await data.deleteBlock(existing.id); s.close(); toast('Deleted'); onDone?.(); }
    catch (err) { toast(err.message, 'error'); }
  });

  foot.querySelector('[data-save]').onclick = async (e) => {
    const name = body.querySelector('#b-name').value.trim();
    const startsAt = body.querySelector('#b-start').value;
    const endsAt = body.querySelector('#b-end').value;
    if (!name) return toast('Give the block a name', 'error');
    if (startsAt && endsAt && endsAt <= startsAt) {
      return toast('The end time has to be after the start time', 'error');
    }
    busy(e.currentTarget);
    try {
      if (existing) {
        await data.updateBlock(existing.id, {
          name,
          starts_at: startsAt || null,
          ends_at: endsAt || null,
          active: body.querySelector('#b-active')?.checked ?? true,
        });
      } else {
        await data.createBlock({ name, startsAt, endsAt }, state.team?.id);
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

/* ------------------------------------------------------------- item editor */
async function openItemEditor(block, existing, onDone) {
  const crew = await data.listActiveEmployees().catch(() => []);
  const i = existing || { title: '', description: '', location: '', priority: 'normal', requires_photo: true };

  const body = el(`
    <div>
      <p class="small muted">In <strong>${esc(block.name)}</strong></p>
      <div class="field mt">
        <label for="i-title">What needs doing</label>
        <input class="input" id="i-title" maxlength="160" value="${esc(i.title || '')}"
               placeholder="e.g. Stock the front cooler">
      </div>
      <div class="field">
        <label for="i-desc">Instructions (optional)</label>
        <textarea class="textarea" id="i-desc" placeholder="What good looks like, what to photograph…">${esc(i.description || '')}</textarea>
      </div>
      <div class="row">
        <div class="field">
          <label for="i-priority">Priority</label>
          <select class="select" id="i-priority">
            ${['low', 'normal', 'high', 'urgent'].map((p) =>
              `<option value="${p}" ${(i.priority || 'normal') === p ? 'selected' : ''}>${p[0].toUpperCase() + p.slice(1)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="i-loc">Location</label>
          <input class="input" id="i-loc" maxlength="120" value="${esc(i.location || '')}">
        </div>
      </div>
      <div class="field">
        <label for="i-who">Who does it</label>
        <select class="select" id="i-who">
          <option value="">Anyone on the crew</option>
          ${crew.map((m) => `<option value="${esc(m.id)}" ${m.id === i.assigned_to ? 'selected' : ''}>${esc(m.name || m.email)}</option>`).join('')}
        </select>
        <div class="hint">Leave it open and whoever gets to it puts their name on it.</div>
      </div>
      <div class="field">
        <label>Which days</label>
        <div class="daypick" id="i-days">
          ${DAY_LETTERS.map((letter, index) => {
            const on = !i.weekdays?.length || i.weekdays.includes(index);
            return `<button type="button" class="day ${on ? 'on' : ''}" data-day="${index}"
                      aria-pressed="${on}" title="${DAY_NAMES[index]}">${letter}</button>`;
          }).join('')}
        </div>
        <div class="hint" data-dayhint></div>
      </div>
      <label class="switch">
        <input type="checkbox" id="i-photo" ${i.requires_photo === false ? '' : 'checked'}>
        <span>Require a photo before it can be marked done</span>
      </label>
    </div>`);

  const dayPicker = body.querySelector('#i-days');
  const dayHint = body.querySelector('[data-dayhint]');
  const chosenDays = () =>
    [...dayPicker.querySelectorAll('.day.on')].map((b) => Number(b.dataset.day));
  const paintDays = () => {
    const days = chosenDays();
    dayHint.textContent = days.length
      ? `Shows up ${weekdayLabel(days)}.`
      : 'Pick at least one day, or it will never appear.';
  };
  dayPicker.querySelectorAll('.day').forEach((btn) => {
    btn.onclick = () => {
      const on = btn.classList.toggle('on');
      btn.setAttribute('aria-pressed', String(on));
      paintDays();
    };
  });
  paintDays();

  const foot = el(`<div style="display:flex;gap:10px;width:100%">
    ${existing ? '<button class="btn ghost" style="flex:0 0 52px" data-del title="Delete">🗑</button>' : ''}
    <button class="btn ghost" style="flex:1" data-close>Cancel</button>
    <button class="btn" style="flex:2" data-save>${existing ? 'Save' : 'Add task'}</button>
  </div>`);
  const s = sheet({ title: existing ? 'Edit task' : 'Add a task', body, footer: foot });
  setTimeout(() => body.querySelector('#i-title').focus(), 90);

  foot.querySelector('[data-del]')?.addEventListener('click', async () => {
    const yes = await confirmSheet({
      title: 'Delete this task?',
      message: `It stops appearing in ${block.name}. Anything already done stays in your records.`,
      confirmLabel: 'Delete', danger: true,
    });
    if (!yes) return;
    try { await data.deleteBlockItem(existing.id); s.close(); toast('Deleted'); onDone?.(); }
    catch (err) { toast(err.message, 'error'); }
  });

  foot.querySelector('[data-save]').onclick = async (e) => {
    const title = body.querySelector('#i-title').value.trim();
    if (!title) return toast('Give the task a name', 'error');
    busy(e.currentTarget);
    const days = chosenDays();
    if (!days.length) {
      busy(e.currentTarget, false);
      return toast('Pick at least one day', 'error');
    }
    const fields = {
      title,
      description: body.querySelector('#i-desc').value.trim(),
      location: body.querySelector('#i-loc').value.trim(),
      priority: body.querySelector('#i-priority').value,
      assignedTo: body.querySelector('#i-who').value || null,
      requiresPhoto: body.querySelector('#i-photo').checked,
      weekdays: days,
    };
    try {
      if (existing) {
        await data.updateBlockItem(existing.id, {
          title: fields.title,
          description: fields.description,
          location: fields.location,
          priority: fields.priority,
          assigned_to: fields.assignedTo,
          requires_photo: fields.requiresPhoto,
          weekdays: fields.weekdays.length === 7 ? null : fields.weekdays,
        });
      } else {
        await data.addBlockItem(block.id, state.team?.id, fields);
      }
      await data.ensureTodaysTasks();   // show up on today's list right away
      s.close();
      toast('Saved', 'ok');
      onDone?.();
    } catch (err) {
      toast(err.message, 'error');
      busy(e.currentTarget, false);
    }
  };
}
