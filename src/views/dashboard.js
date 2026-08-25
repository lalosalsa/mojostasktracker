/* Manager home: who is working, what's done, what needs a look. */

import { el, esc, fmtDate, fmtTime, timeAgo, initials } from '../ui.js';
import * as data from '../data.js';
import { navigate } from '../router.js';
import { statTile, emptyState, skeletonList, sectionHead, trendBars, activityLine, progressRing, taskCard } from './components.js';
import { hydrateThumbs, openLightbox } from '../photos.js';
import { openTaskSheet } from './taskSheet.js';

export async function dashboardView(container, params = {}) {
  container.innerHTML = '';
  const shell = el('<div></div>');
  shell.appendChild(skeletonList(4));
  container.appendChild(shell);

  const date = params.date || data.todayStr();
  await data.ensureTodaysTasks(date);
  data.touchLastSeen();

  // One fetch, one source of truth. The tiles used to come from a server-side
  // aggregate while the screen listed something else, so a count could claim
  // work that nothing on the page could show you.
  const [dayTasks, people, trend, activity] = await Promise.all([
    data.listTasks({ date, limit: 300 }),
    data.employeeDayStats(date),
    data.dailyTrend(data.shiftDate(date, -13), date),
    data.listActivity(25),
  ]);

  const openTasks = dayTasks.filter((t) => ['open', 'in_progress', 'rejected'].includes(t.status));
  const finished = dayTasks.filter((t) => t.isDone);
  const stats = {
    total: dayTasks.length,
    open: openTasks.length,
    submitted: dayTasks.filter((t) => t.status === 'submitted').length,
    verified: dayTasks.filter((t) => t.status === 'verified').length,
    completed: finished.length,
    photos: dayTasks.reduce((n, t) => n + (t.photos?.length || 0), 0),
  };

  shell.innerHTML = '';

  const hero = el(`
    <div class="hero">
      <div class="hero-text">
        <h2>${esc(fmtDate(date))}</h2>
        <p>${stats.completed} of ${stats.total} task${stats.total === 1 ? '' : 's'} finished across the crew</p>
      </div>
    </div>`);
  hero.appendChild(progressRing(Number(stats.completed), Number(stats.total)));
  shell.appendChild(hero);

  shell.appendChild(el(`
    <div class="stats mt">
      ${statTile(stats.open, 'Open', Number(stats.open) ? 'warn' : '')}
      ${statTile(stats.submitted, 'To review', Number(stats.submitted) ? 'brand' : '')}
      ${statTile(stats.verified, 'Verified', 'ok')}
      ${statTile(stats.photos, 'Photos')}
    </div>`));

  if (Number(stats.submitted) > 0) {
    const banner = el(`
      <div class="banner warn mt" style="cursor:pointer">
        <span class="ic">🔍</span>
        <div><strong>${stats.submitted} task${Number(stats.submitted) === 1 ? '' : 's'} waiting on you</strong><br>
        Check the photos and sign off.</div>
      </div>`);
    banner.onclick = () => navigate('/review');
    shell.appendChild(banner);
  }

  /* ---- crew scoreboard ---- */
  const crew = el(`<div class="section">${sectionHead('Crew today', people.length)}</div>`);
  if (!people.length) {
    crew.appendChild(emptyState('👷', 'No crew yet',
      'Share your team code from the Team tab — as soon as someone joins they show up here.'));
  }
  for (const p of people) {
    const total = Number(p.assigned);
    const done = Number(p.completed);
    const pct = total ? Math.round((done / total) * 100) : 0;
    const row = el(`
      <div class="list-row" style="cursor:pointer">
        <span class="avatar">${esc(initials(p.name || p.email))}</span>
        <span class="grow">
          <span class="name" style="font-weight:650;display:block">${esc(p.name || p.email)}</span>
          <span class="small muted">${done}/${total} done · ${p.photos} photo${Number(p.photos) === 1 ? '' : 's'}${
            p.last_completed_at ? ` · last ${esc(timeAgo(p.last_completed_at))}` : ''}</span>
          <span style="display:block;height:6px;border-radius:99px;background:var(--line);margin-top:7px;overflow:hidden">
            <span style="display:block;height:100%;width:${pct}%;background:linear-gradient(90deg,var(--brand),var(--accent))"></span>
          </span>
        </span>
        ${Number(p.awaiting_review) ? `<span class="chip warn">${p.awaiting_review} to review</span>` : ''}
      </div>`);
    row.onclick = () => navigate(`/tasks?assignee=${p.id}&date=${date}`);
    crew.appendChild(row);
  }
  shell.appendChild(crew);

  /* ---- what is still outstanding: the number above, made visible ---- */
  if (openTasks.length) {
    const still = el(`<div class="section">${sectionHead('Still open', openTasks.length)}</div>`);
    for (const task of data.sortTasks(openTasks)) {
      still.appendChild(taskCard(task, (t) => openTaskSheet(t, {
        onChange: () => dashboardView(container, params),
      }), { showAssignee: true }));
    }
    shell.appendChild(still);
  }

  /* ---- what got finished, with the proof ---- */
  const feed = el(`<div class="section">${sectionHead('Finished today', finished.length)}</div>`);
  if (!finished.length) {
    feed.appendChild(emptyState('📷', 'Nothing finished yet',
      'As the crew mark jobs done, the photo proof lands here.'));
  }

  const byNewest = [...finished].sort(
    (a, b) => String(b.completed_at || '').localeCompare(String(a.completed_at || ''))
  );
  for (const task of byNewest) {
    const shots = (task.photos || []).slice(0, 4).map((p) =>
      `<img data-path="${esc(p.thumb_path || p.storage_path)}" alt="" loading="lazy"
            style="width:64px;height:64px;border-radius:10px;object-fit:cover;
                   border:1px solid var(--line);cursor:zoom-in;flex:none">`).join('');

    const card = el(`
      <div class="card card-tight" style="cursor:pointer">
        <div style="display:flex;gap:10px;align-items:flex-start">
          <div style="flex:1;min-width:0">
            <div style="font-weight:650;font-size:14.5px">${esc(task.title)}</div>
            <div class="small" style="margin-top:4px">
              <strong style="color:var(--ok)">✓ ${esc(task.finisher?.name || task.assignee?.name || 'Someone')}</strong>
              <span class="muted"> · ${esc(fmtTime(task.completed_at))}${task.block ? ` · ${esc(task.block.name)}` : ''}</span>
            </div>
          </div>
          <span class="chip ${task.status === 'verified' ? 'ok' : 'warn'}">
            ${task.status === 'verified' ? '✓ verified' : 'to review'}</span>
        </div>
        ${task.photos?.length
          ? `<div style="display:flex;gap:6px;margin-top:9px;overflow-x:auto">${shots}
             ${task.photos.length > 4 ? `<span class="chip" style="align-self:center">+${task.photos.length - 4}</span>` : ''}</div>`
          : '<p class="small mt" style="color:var(--danger)">No photo attached</p>'}
      </div>`);

    card.querySelectorAll('img[data-path]').forEach((img, i) => {
      img.onclick = (e) => { e.stopPropagation(); openLightbox(task.photos, i); };
    });
    card.onclick = () => openTaskSheet(task, { onChange: () => dashboardView(container, params) });
    hydrateThumbs(card);
    feed.appendChild(card);
  }
  shell.appendChild(feed);

  /* ---- trend ---- */
  if (trend.length) {
    const card = el(`<div class="card mt-lg"><h2 style="font-size:15px">Last 14 days</h2></div>`);
    card.appendChild(trendBars(trend));
    card.appendChild(el('<p class="small muted mt">Bar height is tasks logged; the solid part is what got finished.</p>'));
    shell.appendChild(card);
  }

  /* ---- activity ---- */
  const log = el(`<div class="section">${sectionHead('Everything that happened')}<div class="card"></div></div>`);
  const list = log.querySelector('.card');
  if (!activity.length) {
    list.appendChild(el('<p class="small muted">Nothing has happened yet today.</p>'));
  } else {
    list.appendChild(el(`<ul class="timeline">${activity.map(activityLine).join('')}</ul>`));
  }
  shell.appendChild(log);
}
