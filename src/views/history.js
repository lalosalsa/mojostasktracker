/* Everything this person has logged, day by day. */

import { el, esc, fmtDate } from '../ui.js';
import * as data from '../data.js';
import { state } from '../store.js';
import { taskCard, statTile, emptyState, skeletonList, sectionHead } from './components.js';
import { openTaskSheet } from './taskSheet.js';

export async function historyView(container, params = {}) {
  container.innerHTML = '';
  const shell = el('<div></div>');
  shell.appendChild(skeletonList(3));
  container.appendChild(shell);

  const to = params.to || data.todayStr();
  const from = params.from || data.shiftDate(to, -13);

  const [tasks, stats] = await Promise.all([
    data.listTasks({ from, to, assignedTo: state.profile.id }),
    data.rangeStats(from, to, state.profile.id),
  ]);

  shell.innerHTML = '';
  shell.appendChild(el(`
    <div class="card">
      <div class="section-head" style="margin-bottom:10px">
        <h2>Last 14 days</h2><span class="spacer"></span>
        <span class="small muted">${esc(fmtDate(from, { weekday: false }))} – ${esc(fmtDate(to, { weekday: false }))}</span>
      </div>
      <div class="stats">
        ${statTile(stats.completed, 'Completed', 'ok')}
        ${statTile(stats.verified, 'Verified', 'brand')}
        ${statTile(stats.open, 'Still open', stats.open ? 'warn' : '')}
        ${statTile(stats.photos, 'Photos')}
      </div>
    </div>`));

  if (!tasks.length) {
    shell.appendChild(emptyState('🗓', 'Nothing logged yet', 'Tasks you finish will build up here so you have a record of your work.'));
    return;
  }

  const byDay = new Map();
  for (const t of tasks) {
    if (!byDay.has(t.work_date)) byDay.set(t.work_date, []);
    byDay.get(t.work_date).push(t);
  }

  for (const [day, list] of byDay) {
    const done = list.filter((t) => t.isDone).length;
    const sec = el(`<div class="section">${sectionHead(fmtDate(day), null,
      `<span class="chip ${done === list.length ? 'ok' : ''}">${done}/${list.length} done</span>`)}</div>`);
    for (const task of data.sortTasks(list)) {
      sec.appendChild(taskCard(task, (t) => openTaskSheet(t, { onChange: () => historyView(container, params) })));
    }
    shell.appendChild(sec);
  }
}
