/* Reusable pieces of UI shared across views. */

import { el, esc, fmtDate, timeAgo, initials, STATUS_LABELS, STATUS_CHIP, PRIORITY_CHIP } from '../ui.js';
import { hydrateThumbs } from '../photos.js';
import { state } from '../store.js';

const CHECK = { verified: 'done', submitted: 'pending', in_progress: 'progress' };

/** Heading for one block of the day, with its optional clock range. */
export function blockHeading(group) {
  const when = group.startsAt && group.endsAt
    ? `${clock(group.startsAt)} – ${clock(group.endsAt)}`
    : group.startsAt ? `from ${clock(group.startsAt)}`
      : group.endsAt ? `until ${clock(group.endsAt)}` : '';
  const done = group.tasks.filter((t) => t.isDone).length;
  return `<div class="section-head">
    <h2>${esc(group.name)}</h2>
    ${when ? `<span class="count">${esc(when)}</span>` : ''}
    <span class="spacer"></span>
    <span class="chip ${done === group.tasks.length ? 'ok' : ''}">${done}/${group.tasks.length}</span>
  </div>`;
}

const clock = (t) => {
  if (!t) return '';
  const [h, m] = String(t).split(':').map(Number);
  const suffix = h < 12 ? 'am' : 'pm';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hour}:${String(m).padStart(2, '0')}${suffix}` : `${hour}${suffix}`;
};

export function taskCard(task, onOpen, { showAssignee = false } = {}) {
  const photos = task.photos || [];
  const thumbs = photos.slice(0, 3)
    .map((p) => `<img data-path="${esc(p.thumb_path || p.storage_path)}" alt="" loading="lazy">`)
    .join('');
  const more = photos.length > 3 ? `<div class="more">+${photos.length - 3}</div>` : '';

  const node = el(`
    <button class="task ${task.isDone ? 'is-done' : ''} ${task.status === 'rejected' ? 'is-rejected' : ''}">
      <span class="checkbox ${CHECK[task.status] || ''}">✓</span>
      <span class="body">
        <span class="title">${esc(task.title)}</span>
        ${task.description ? `<span class="desc">${esc(task.description)}</span>` : ''}
        <span class="meta">
          <span class="chip ${STATUS_CHIP[task.status] || ''}">${esc(STATUS_LABELS[task.status])}</span>
          ${task.priority !== 'normal' ? `<span class="chip ${PRIORITY_CHIP[task.priority]}">${esc(task.priority)}</span>` : ''}
          ${task.location ? `<span class="chip">📍 ${esc(task.location)}</span>` : ''}
          ${task.requires_photo && !photos.length ? '<span class="chip info">📷 needs photo</span>' : ''}
          ${photos.length ? `<span class="chip">📷 ${photos.length}</span>` : ''}
          ${task.finisher ? `<span class="chip ok">✓ ${esc(task.finisher.name)}</span>`
            : showAssignee ? `<span class="chip">${esc(task.assignee?.name || 'Anyone')}</span>` : ''}
        </span>
        ${photos.length ? `<span class="thumbs">${thumbs}${more}</span>` : ''}
      </span>
    </button>`);

  node.onclick = () => onOpen(task);
  hydrateThumbs(node);
  return node;
}

export function progressRing(done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  const r = 32;
  const c = 2 * Math.PI * r;
  // 100% is the widest the number ever gets — drop a point of type so it keeps
  // clear of the stroke.
  return el(`
    <div class="ring ${pct === 100 ? 'is-full' : ''}" role="img" aria-label="${pct}% of today's tasks complete">
      <svg width="78" height="78" viewBox="0 0 78 78">
        <defs>
          <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="var(--brand)"/>
            <stop offset="100%" stop-color="var(--accent)"/>
          </linearGradient>
        </defs>
        <circle class="track" cx="39" cy="39" r="${r}" fill="none" stroke-width="7"/>
        <circle class="value" cx="39" cy="39" r="${r}" fill="none" stroke-width="7"
                stroke-dasharray="${c}" stroke-dashoffset="${c - (c * pct) / 100}"/>
      </svg>
      <div class="label"><span class="pct">${pct}%</span><span class="cap">DONE</span></div>
    </div>`);
}

export function statTile(n, label, kind = '') {
  return `<div class="stat ${kind}"><div class="n">${n}</div><div class="k">${esc(label)}</div></div>`;
}

export function emptyState(icon, title, message) {
  return el(`
    <div class="empty">
      <span class="ic">${icon}</span>
      <h3>${esc(title)}</h3>
      <p>${esc(message)}</p>
    </div>`);
}

export function skeletonList(n = 3) {
  // a live repaint should not flash loading bars over what someone is reading
  if (state.quietRefresh) return el('<div></div>');
  return el(`<div>${'<div class="skeleton"></div>'.repeat(n)}</div>`);
}

export function sectionHead(title, count, extra = '') {
  return `<div class="section-head">
    <h2>${esc(title)}</h2>
    ${count != null ? `<span class="count">${count}</span>` : ''}
    <span class="spacer"></span>${extra}
  </div>`;
}

export function personRow(person, { sub, right = '' } = {}) {
  return el(`
    <div class="list-row">
      <span class="avatar sm">${esc(initials(person.name || person.email))}</span>
      <span class="grow">
        <span class="who" style="display:block">
          <span class="name" style="display:block">${esc(person.name || person.email)}</span>
          <span class="sub" style="display:block">${esc(sub ?? person.email)}</span>
        </span>
      </span>
      ${right}
    </div>`);
}

export function trendBars(rows) {
  const max = Math.max(1, ...rows.map((r) => Number(r.total) || 0));
  const bars = rows.map((r) => {
    const total = Number(r.total) || 0;
    const done = Number(r.completed) || 0;
    const h = Math.round((total / max) * 100);
    const fill = total ? Math.round((done / total) * 100) : 0;
    return `<div class="bar" style="height:${Math.max(h, 4)}%" title="${esc(r.day)}: ${done}/${total} done">
              <div class="fill" style="height:${fill}%"></div>
            </div>`;
  }).join('');
  const labels = rows.map((r, i) =>
    `<span>${i % 2 === 0 ? esc(fmtDate(r.day, { weekday: false }).replace(/\s/, ' ')) : ''}</span>`
  ).join('');
  return el(`<div><div class="bars">${bars}</div><div class="bars-x">${labels}</div></div>`);
}

/**
 * The last seven days as tappable chips, each showing how much of that day got
 * finished. This is how a manager checks back that yesterday actually got done.
 */
export function weekStrip(days, selected, onPick) {
  const wrap = el('<div class="weekstrip"></div>');
  for (const day of days) {
    const total = Number(day.total) || 0;
    const done = Number(day.completed) || 0;
    const complete = total > 0 && done === total;
    const [y, m, d] = day.day.split('-').map(Number);
    const date = new Date(y, m - 1, d);

    const chip = el(`
      <button class="wday ${day.day === selected ? 'on' : ''} ${complete ? 'complete' : ''}"
              aria-pressed="${day.day === selected}">
        <span class="dow">${date.toLocaleDateString(undefined, { weekday: 'narrow' })}</span>
        <span class="num">${date.getDate()}</span>
        <span class="tally">${total ? `${done}/${total}` : '–'}</span>
      </button>`);
    chip.onclick = () => onPick(day.day);
    wrap.appendChild(chip);
  }
  return wrap;
}

export function activityLine(row) {
  const verbs = {
    'task.created': 'added',
    'task.started': 'started',
    'task.completed': 'finished',
    'task.verified': 'verified',
    'task.rejected': 'sent back',
    'task.reopened': 'reopened',
    'photo.added': 'added a photo to',
  };
  return `<li>
    <span class="dot" style="background:${row.type === 'task.completed' ? 'var(--ok)' : row.type === 'task.rejected' ? 'var(--danger)' : 'var(--brand)'}"></span>
    <div><strong>${esc(row.actor_name || 'Someone')}</strong> ${verbs[row.type] || row.type} ${esc(row.detail || 'a task')}
      <div class="when">${esc(timeAgo(row.created_at))}</div>
    </div>
  </li>`;
}
