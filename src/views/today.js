/* Employee home: everything on the crew member's plate for the day. */

import { el, esc, sheet, toast, busy, fmtDate } from '../ui.js';
import * as data from '../data.js';
import { state } from '../store.js';
import { taskCard, progressRing, statTile, emptyState, skeletonList, sectionHead } from './components.js';
import { openTaskSheet } from './taskSheet.js';
import { pickPhotos, uploadFiles } from '../photos.js';

export async function todayView(container) {
  container.innerHTML = '';
  const shell = el('<div></div>');
  shell.appendChild(skeletonList(4));
  container.appendChild(shell);

  const fab = el('<button class="fab">＋ Log a task</button>');
  fab.onclick = () => openLogSheet(() => todayView(container));
  container.appendChild(fab);

  const today = data.todayStr();
  await data.ensureTodaysTasks(today);
  data.touchLastSeen();

  let tasks;
  try {
    tasks = data.sortTasks(await data.listTasks({ date: today }));
  } catch (err) {
    shell.innerHTML = '';
    shell.appendChild(emptyState('⚠️', 'Could not load your tasks', err.message));
    return;
  }

  const refresh = () => todayView(container);
  const mine = tasks.filter((t) => t.assigned_to === state.me.id);
  const upForGrabs = tasks.filter((t) => !t.assigned_to);
  const doneCount = mine.filter((t) => t.isDone).length;
  const todo = mine.filter((t) => ['open', 'in_progress', 'rejected'].includes(t.status));
  const waiting = mine.filter((t) => t.status === 'submitted');
  const verified = mine.filter((t) => t.status === 'verified');
  const photos = mine.reduce((n, t) => n + (t.photos?.length || 0), 0);

  const firstName = (state.me.name || '').split(' ')[0] || 'there';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  shell.innerHTML = '';
  const hero = el(`
    <div class="hero">
      <div class="hero-text">
        <h2>${greeting}, ${esc(firstName)}</h2>
        <p>${doneCount} of ${mine.length || 0} task${mine.length === 1 ? '' : 's'} done · ${esc(fmtDate(today))}</p>
      </div>
    </div>`);
  hero.appendChild(progressRing(doneCount, mine.length));
  shell.appendChild(hero);

  shell.appendChild(el(`
    <div class="stats mt">
      ${statTile(todo.length, 'To do', todo.length ? 'brand' : '')}
      ${statTile(waiting.length, 'In review', waiting.length ? 'warn' : '')}
      ${statTile(verified.length, 'Verified', 'ok')}
      ${statTile(photos, 'Photos')}
    </div>`));

  const rejected = todo.filter((t) => t.status === 'rejected');
  if (rejected.length) {
    shell.appendChild(el(`
      <div class="banner danger mt">
        <span class="ic">↩︎</span>
        <div><strong>${rejected.length} task${rejected.length === 1 ? '' : 's'} sent back</strong><br>
        Your manager asked for a redo — open ${rejected.length === 1 ? 'it' : 'them'} below for details.</div>
      </div>`));
  }

  const addSection = (title, list, opts = {}) => {
    if (!list.length) return;
    const sec = el(`<div class="section">${sectionHead(title, list.length)}</div>`);
    for (const task of list) sec.appendChild(taskCard(task, (t) => openTaskSheet(t, { onChange: refresh }), opts));
    shell.appendChild(sec);
  };

  addSection('To do', todo);
  addSection('Waiting on your manager', waiting);
  addSection('Up for grabs', upForGrabs);
  addSection('Signed off', verified);

  if (!tasks.length) {
    shell.appendChild(
      emptyState('🎉', 'Nothing assigned yet', 'When your manager adds tasks they show up here. You can also log work you finished with the button below.')
    );
  }
}

/** Quick "I did this" flow: name it, snap the proof, done. */
export function openLogSheet(onDone) {
  const body = el(`
    <div>
      <div class="field">
        <label for="log-title">What did you do?</label>
        <input class="input" id="log-title" placeholder="e.g. Replaced filters in unit 3" maxlength="160" autocomplete="off">
      </div>
      <div class="row">
        <div class="field">
          <label for="log-location">Where</label>
          <input class="input" id="log-location" placeholder="Site / room" maxlength="120" autocomplete="off">
        </div>
        <div class="field">
          <label for="log-minutes">Minutes</label>
          <input class="input" id="log-minutes" type="number" min="0" max="1440" inputmode="numeric" placeholder="30">
        </div>
      </div>
      <div class="field">
        <label for="log-notes">Notes (optional)</label>
        <textarea class="textarea" id="log-notes" placeholder="Anything your manager should know"></textarea>
      </div>
      <div class="banner info">
        <span class="ic">📷</span>
        <div>Next you'll take the photos that prove the work is finished.</div>
      </div>
    </div>`);

  const foot = el(`<div style="display:flex;gap:10px;width:100%">
    <button class="btn ghost" style="flex:1" data-close>Cancel</button>
    <button class="btn" style="flex:2" data-go>📷 Add photos</button>
  </div>`);

  const s = sheet({ title: 'Log a finished task', body, footer: foot });
  setTimeout(() => body.querySelector('#log-title').focus(), 90);

  foot.querySelector('[data-go]').onclick = async (e) => {
    const btn = e.currentTarget;
    const title = body.querySelector('#log-title').value.trim();
    if (!title) {
      toast('Give the task a name first', 'error');
      body.querySelector('#log-title').focus();
      return;
    }
    busy(btn);
    try {
      const task = await data.createTask({
        title,
        location: body.querySelector('#log-location').value.trim(),
        description: body.querySelector('#log-notes').value.trim(),
        status: 'in_progress',
        requiresPhoto: true,
      });
      const minutes = Number(body.querySelector('#log-minutes').value) || null;
      if (minutes) await data.updateTask(task.id, { minutes_spent: minutes });
      s.close();

      const files = await pickPhotos({ camera: true });
      if (files.length) {
        toast('Uploading photos…');
        const added = await uploadFiles(task, files);
        task.photos = added;
        task.photoCount = added.length;
      }
      const fresh = await data.getTask(task.id);
      openTaskSheet(fresh, { onChange: onDone });
      onDone?.();
    } catch (err) {
      toast(err.message, 'error');
      busy(btn, false);
    }
  };
  return s;
}
