/* Employee home: everything on the crew member's plate for the day. */

import { el, esc, fmtDate } from '../ui.js';
import * as data from '../data.js';
import { state } from '../store.js';
import { taskCard, progressRing, statTile, emptyState, skeletonList, blockHeading } from './components.js';
import { openTaskSheet } from './taskSheet.js';

export async function todayView(container) {
  container.innerHTML = '';
  const shell = el('<div></div>');
  shell.appendChild(skeletonList(4));
  container.appendChild(shell);

  const today = data.todayStr();
  await data.ensureTodaysTasks(today);

  let tasks;
  try {
    tasks = data.sortTasks(await data.listTasks({ date: today }));
  } catch (err) {
    // A background repaint that fails must not put an error where the list was;
    // hand it up to be thrown away, and the next one will bring us up to date.
    if (state.quietRefresh) throw err;
    shell.innerHTML = '';
    shell.appendChild(emptyState('⚠️', 'Could not load your tasks', err.message));
    return;
  }

  const refresh = () => todayView(container);
  const doneCount = tasks.filter((t) => t.isDone).length;
  // Finished work drops off the crew's list — a shared list only shows what is
  // still outstanding, so nobody redoes a job someone else already did.
  const todo = tasks.filter((t) => ['open', 'in_progress', 'rejected'].includes(t.status));
  const mineDone = tasks.filter((t) => t.completed_by === state.me.id);
  const photos = tasks.reduce((n, t) => n + (t.photos?.length || 0), 0);

  const firstName = (state.me.name || '').split(' ')[0] || 'there';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  shell.innerHTML = '';
  const hero = el(`
    <div class="hero">
      <div class="hero-text">
        <h2>${greeting}, ${esc(firstName)}</h2>
        <p>${doneCount} of ${tasks.length || 0} done today · ${esc(fmtDate(today))}</p>

      </div>
    </div>`);
  hero.appendChild(progressRing(doneCount, tasks.length));
  shell.appendChild(hero);

  shell.appendChild(el(`
    <div class="stats mt">
      ${statTile(todo.length, 'Left to do', todo.length ? 'brand' : '')}
      ${statTile(doneCount, 'Done', doneCount ? 'ok' : '')}
      ${statTile(mineDone.length, 'By you', 'brand')}
      ${statTile(photos, 'Photos')}
    </div>`));

  const sentBack = todo.filter((t) => t.status === 'rejected');
  if (sentBack.length) {
    shell.appendChild(el(`
      <div class="banner danger mt">
        <span class="ic">↩︎</span>
        <div><strong>${sentBack.length} task${sentBack.length === 1 ? '' : 's'} sent back</strong><br>
        A manager asked for these to be redone — they're back on the list below.</div>
      </div>`));
  }

  for (const group of data.groupByBlock(todo)) {
    const sec = el(`<div class="section">${blockHeading(group)}</div>`);
    for (const task of group.tasks) {
      sec.appendChild(taskCard(task, (t) => openTaskSheet(t, { onChange: refresh }), { showAssignee: true }));
    }
    shell.appendChild(sec);
  }

  if (!tasks.length) {
    shell.appendChild(
      emptyState('📋', 'Nothing on the list yet',
        "When your manager sets up the day's blocks, the list shows up here.")
    );
  } else if (!todo.length) {
    shell.appendChild(
      emptyState('🎉', "That's the whole list done",
        `All ${doneCount} task${doneCount === 1 ? '' : 's'} are finished and with your manager. Nice work.`)
    );
  }
}
