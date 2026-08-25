/* Reports: pick a range, see the totals, download the spreadsheet. */

import { el, esc, toast, busy, fmtDate } from '../ui.js';
import * as data from '../data.js';
import { statTile, skeletonList, sectionHead, trendBars } from './components.js';

export async function reportsView(container, params = {}) {
  container.innerHTML = '';
  const shell = el('<div></div>');
  shell.appendChild(skeletonList(3));
  container.appendChild(shell);

  const to = params.to || data.todayStr();
  const from = params.from || data.shiftDate(to, -29);

  const [stats, people, trend] = await Promise.all([
    data.rangeStats(from, to),
    data.employeeDayStats(to),
    data.dailyTrend(from, to),
  ]);

  shell.innerHTML = '';

  const controls = el(`
    <div class="card card-tight">
      <div class="row">
        <div class="field" style="margin-bottom:0">
          <label for="rp-from">From</label>
          <input class="input" id="rp-from" type="date" value="${esc(from)}">
        </div>
        <div class="field" style="margin-bottom:0">
          <label for="rp-to">To</label>
          <input class="input" id="rp-to" type="date" value="${esc(to)}">
        </div>
      </div>
      <div class="btn-row mt">
        <button class="btn ghost sm" data-range="7">Last 7 days</button>
        <button class="btn ghost sm" data-range="30">Last 30 days</button>
        <button class="btn ghost sm" data-range="90">Last 90 days</button>
      </div>
    </div>`);
  const reload = (f, t) => reportsView(container, { from: f, to: t });
  controls.querySelector('#rp-from').onchange = (e) => reload(e.target.value, to);
  controls.querySelector('#rp-to').onchange = (e) => reload(from, e.target.value);
  controls.querySelectorAll('[data-range]').forEach((b) => {
    b.onclick = () => {
      const today = data.todayStr();
      reload(data.shiftDate(today, -(Number(b.dataset.range) - 1)), today);
    };
  });
  shell.appendChild(controls);

  shell.appendChild(el(`
    <div class="card mt">
      <div class="section-head" style="margin-bottom:10px">
        <h2>${esc(fmtDate(from, { weekday: false }))} – ${esc(fmtDate(to, { weekday: false }))}</h2>
      </div>
      <div class="stats">
        ${statTile(stats.total, 'Tasks')}
        ${statTile(stats.completed, 'Completed', 'ok')}
        ${statTile(stats.verified, 'Verified', 'brand')}
        ${statTile(stats.rejected, 'Sent back', Number(stats.rejected) ? 'danger' : '')}
        ${statTile(stats.photos, 'Photos')}
      </div>
    </div>`));

  if (trend.length) {
    const card = el('<div class="card mt"><h2 style="font-size:15px">Daily completion</h2></div>');
    card.appendChild(trendBars(trend.slice(-30)));
    shell.appendChild(card);
  }

  if (people.length) {
    const sec = el(`<div class="section">${sectionHead('Today by person', people.length)}<div class="card"></div></div>`);
    const table = sec.querySelector('.card');
    for (const p of people) {
      table.appendChild(el(`
        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line)">
          <span style="flex:1;font-size:14px;font-weight:600">${esc(p.name || p.email)}</span>
          <span class="chip ok">${p.completed} done</span>
          <span class="chip">${p.photos} 📷</span>
        </div>`));
    }
    shell.appendChild(sec);
  }

  const dl = el('<button class="btn block mt-lg">⬇ Download CSV</button>');
  dl.onclick = async () => {
    busy(dl);
    try {
      const tasks = await data.listTasks({ from, to, limit: 5000 });
      downloadCsv(tasks, from, to);
      toast('Downloaded', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      busy(dl, false);
    }
  };
  shell.appendChild(dl);
  shell.appendChild(el('<p class="small muted center mt">Opens in Excel, Numbers or Google Sheets.</p>'));
}

function downloadCsv(tasks, from, to) {
  const head = ['Task ID', 'Day', 'Title', 'Location', 'Status', 'Priority', 'Assigned to', 'Email',
    'Photos', 'Notes', 'Manager note', 'Minutes', 'Started', 'Completed', 'Reviewed'];
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = tasks.map((t) => [
    t.id, t.work_date, t.title, t.location, t.status, t.priority,
    t.assignee?.name || '', t.assignee?.email || '',
    t.photos?.length || 0, t.notes, t.review_note, t.minutes_spent ?? '',
    t.started_at || '', t.completed_at || '', t.reviewed_at || '',
  ].map(cell).join(','));

  const blob = new Blob([[head.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tasks-${from}-to-${to}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
