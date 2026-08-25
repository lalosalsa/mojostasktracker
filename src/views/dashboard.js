/* Manager home: who is working, what's done, what needs a look. */

import { el, esc, fmtDate, timeAgo, initials } from '../ui.js';
import * as data from '../data.js';
import { navigate } from '../router.js';
import { statTile, emptyState, skeletonList, sectionHead, trendBars, activityLine, progressRing } from './components.js';

export async function dashboardView(container, params = {}) {
  container.innerHTML = '';
  const shell = el('<div></div>');
  shell.appendChild(skeletonList(4));
  container.appendChild(shell);

  const date = params.date || data.todayStr();
  await data.ensureTodaysTasks(date);
  data.touchLastSeen();

  const [stats, people, trend, activity, pending] = await Promise.all([
    data.rangeStats(date, date),
    data.employeeDayStats(date),
    data.dailyTrend(data.shiftDate(date, -13), date),
    data.listActivity(25),
    data.pendingMembers(),
  ]);

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

  if (pending.length) {
    const banner = el(`
      <div class="banner info mt" style="cursor:pointer">
        <span class="ic">👋</span>
        <div><strong>${pending.length} person${pending.length === 1 ? '' : 's'} waiting to join</strong><br>
        ${esc(pending.map((p) => p.email).slice(0, 3).join(', '))}</div>
      </div>`);
    banner.onclick = () => navigate('/team');
    shell.appendChild(banner);
  }

  /* ---- crew scoreboard ---- */
  const crew = el(`<div class="section">${sectionHead('Crew today', people.length)}</div>`);
  if (!people.length) {
    crew.appendChild(emptyState('👷', 'No crew yet', 'Add your team from the Team tab and they can start logging work today.'));
  }
  for (const p of people) {
    const total = Number(p.assigned);
    const done = Number(p.completed);
    const pct = total ? Math.round((done / total) * 100) : 0;
    const row = el(`
      <div class="list-row" style="cursor:pointer">
        <span class="avatar">${esc(initials(p.full_name || p.email))}</span>
        <span class="grow">
          <span class="name" style="font-weight:650;display:block">${esc(p.full_name || p.email)}</span>
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

  /* ---- trend ---- */
  if (trend.length) {
    const card = el(`<div class="card mt-lg"><h2 style="font-size:15px">Last 14 days</h2></div>`);
    card.appendChild(trendBars(trend));
    card.appendChild(el('<p class="small muted mt">Bar height is tasks logged; the solid part is what got finished.</p>'));
    shell.appendChild(card);
  }

  /* ---- activity ---- */
  const feed = el(`<div class="section">${sectionHead('Live activity')}<div class="card"></div></div>`);
  const list = feed.querySelector('.card');
  if (!activity.length) {
    list.appendChild(el('<p class="small muted">Nothing has happened yet today.</p>'));
  } else {
    list.appendChild(el(`<ul class="timeline">${activity.map(activityLine).join('')}</ul>`));
  }
  shell.appendChild(feed);
}
