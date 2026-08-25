/* Team roster and the codes people use to join it. */

import { el, esc, toast, busy, sheet, confirmSheet, timeAgo, initials } from '../ui.js';
import * as data from '../data.js';
import { state, setState } from '../store.js';
import { emptyState, skeletonList, sectionHead } from './components.js';
import { navigate } from '../router.js';

export async function teamView(container) {
  container.innerHTML = '';
  const shell = el('<div></div>');
  shell.appendChild(skeletonList(4));
  container.appendChild(shell);

  const refresh = () => teamView(container);
  const [team, todayStats] = await Promise.all([
    data.listTeam(),
    data.employeeDayStats(data.todayStr()).catch(() => []),
  ]);
  const statsById = new Map(todayStats.map((s) => [s.id, s]));

  shell.innerHTML = '';
  shell.appendChild(codeCard(refresh));

  const active = team.filter((p) => p.status === 'active');
  const paused = team.filter((p) => p.status === 'disabled');

  const renderPerson = (p) => {
    const s = statsById.get(p.id);
    const row = el(`
      <div class="list-row" style="cursor:pointer">
        <span class="avatar">${esc(initials(p.name || p.email))}</span>
        <span class="grow">
          <span style="font-weight:650;display:block">${esc(p.name || p.email)}
            ${p.role === 'manager' ? '<span class="chip brand" style="margin-left:6px">Manager</span>' : ''}</span>
          <span class="small muted">${esc(p.job_title || p.email)}</span>
          <span class="small muted" style="display:block">
            ${s ? `${s.completed}/${s.assigned} done today` : 'No tasks today'} ·
            ${p.last_seen_at ? `seen ${esc(timeAgo(p.last_seen_at))}` : 'not opened yet'}
          </span>
        </span>
        <span class="icon-btn">›</span>
      </div>`);
    row.onclick = () => openMemberSheet(p, refresh);
    return row;
  };

  const sec = el(`<div class="section">${sectionHead('Your team', active.length)}</div>`);
  if (active.length <= 1) {
    sec.appendChild(emptyState('👷', 'Nobody has joined yet',
      'Send your crew the app link and the code above. They enter their name, verify their email, then type the code.'));
  }
  active.forEach((p) => sec.appendChild(renderPerson(p)));
  shell.appendChild(sec);

  if (paused.length) {
    const off = el(`<div class="section">${sectionHead('Turned off', paused.length)}</div>`);
    paused.forEach((p) => off.appendChild(renderPerson(p)));
    shell.appendChild(off);
  }
}

/** The big shareable code, plus manager-only controls. */
export function codeCard(onChange) {
  const team = state.team;
  if (!team) return el('<div></div>');

  const card = el(`
    <div class="card center">
      <div style="font-size:11.5px;font-weight:700;letter-spacing:.08em;color:var(--muted)">CREW CODE</div>
      <div style="font-size:36px;font-weight:800;letter-spacing:.16em;margin:6px 0 2px">${esc(team.join_code)}</div>
      <p class="small muted">Anyone with this code can join <strong>${esc(team.name)}</strong> as crew.</p>
      <div class="btn-row mt">
        <button class="btn soft sm" data-share>Share</button>
        <button class="btn ghost sm" data-copy>Copy code</button>
      </div>
      <div class="btn-row mt">
        <button class="btn ghost sm" data-manager>Manager code</button>
        <button class="btn ghost sm" data-rotate>New code</button>
      </div>
    </div>`);

  const shareText = `Join ${team.name} on the task tracker:\n${location.origin}\n\nTeam code: ${team.join_code}`;

  card.querySelector('[data-share]').onclick = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: team.name, text: shareText });
        return;
      } catch { /* cancelled */ }
    }
    try {
      await navigator.clipboard.writeText(shareText);
      toast('Invite copied — paste it into a text', 'ok');
    } catch {
      toast(`Team code: ${team.join_code}`);
    }
  };

  card.querySelector('[data-copy]').onclick = async () => {
    try {
      await navigator.clipboard.writeText(team.join_code);
      toast('Code copied', 'ok');
    } catch {
      toast(`Team code: ${team.join_code}`);
    }
  };

  card.querySelector('[data-manager]').onclick = () => {
    sheet({
      title: 'Manager code',
      body: `
        <p class="small muted">Someone who joins with this code becomes a <strong>manager</strong> —
        they can see everyone's work, assign tasks and sign off on photos. Only share it with people
        who should run the crew.</p>
        <div class="card center mt">
          <div style="font-size:32px;font-weight:800;letter-spacing:.16em">${esc(team.manager_code)}</div>
        </div>`,
      footer: el('<button class="btn ghost" style="flex:1" data-close>Close</button>'),
    });
  };

  card.querySelector('[data-rotate]').onclick = async () => {
    const yes = await confirmSheet({
      title: 'Get a new crew code?',
      message: 'The old code stops working right away. People already on the team stay on it.',
      confirmLabel: 'New code',
    });
    if (!yes) return;
    try {
      const team2 = await data.rotateTeamCode('join');
      setState({ team: team2 });
      toast('New code ready', 'ok');
      onChange?.();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return card;
}

function openMemberSheet(person, onDone) {
  const self = person.id === state.me.id;
  const body = el(`
    <div>
      <div class="person">
        <span class="avatar">${esc(initials(person.name || person.email))}</span>
        <span class="who">
          <span class="name">${esc(person.name || person.email)}</span>
          <span class="sub">${esc(person.email)}</span>
        </span>
      </div>
      <div class="row mt-lg">
        <div class="field">
          <label for="mem-name">Name</label>
          <input class="input" id="mem-name" value="${esc(person.name || '')}" maxlength="80">
        </div>
        <div class="field">
          <label for="mem-title">Job title</label>
          <input class="input" id="mem-title" value="${esc(person.job_title || '')}" maxlength="60">
        </div>
      </div>
      <div class="field">
        <label for="mem-role">Role</label>
        <select class="select" id="mem-role" ${self ? 'disabled' : ''}>
          <option value="employee" ${person.role === 'employee' ? 'selected' : ''}>Crew</option>
          <option value="manager" ${person.role === 'manager' ? 'selected' : ''}>Manager</option>
        </select>
        ${self ? '<div class="hint">You cannot change your own role.</div>' : ''}
      </div>
      <div class="btn-row mt">
        <button class="btn ghost" data-tasks>See their tasks</button>
        ${!self ? `<button class="btn ghost" data-toggle>${person.status === 'active' ? 'Turn off access' : 'Turn access back on'}</button>` : ''}
      </div>
    </div>`);

  const foot = el(`<div style="display:flex;gap:10px;width:100%">
    <button class="btn ghost" style="flex:1" data-close>Close</button>
    <button class="btn" style="flex:1" data-save>Save</button>
  </div>`);
  const s = sheet({ title: 'Team member', body, footer: foot });

  body.querySelector('[data-tasks]').onclick = () => {
    s.close();
    navigate(`/tasks?assignee=${person.id}`);
  };

  body.querySelector('[data-toggle]')?.addEventListener('click', async (e) => {
    const turningOff = person.status === 'active';
    if (turningOff) {
      const yes = await confirmSheet({
        title: 'Turn off access?',
        message: `${person.name || person.email} will not be able to log tasks until you turn it back on.`,
        confirmLabel: 'Turn off',
        danger: true,
      });
      if (!yes) return;
    }
    busy(e.currentTarget);
    try {
      await data.updateMember(person.id, { status: turningOff ? 'disabled' : 'active' });
      s.close();
      toast(turningOff ? 'Access turned off' : 'Access restored', 'ok');
      onDone?.();
    } catch (err) { toast(err.message, 'error'); busy(e.currentTarget, false); }
  });

  foot.querySelector('[data-save]').onclick = async (e) => {
    busy(e.currentTarget);
    try {
      const patch = {
        name: body.querySelector('#mem-name').value.trim(),
        job_title: body.querySelector('#mem-title').value.trim(),
      };
      if (!self) patch.role = body.querySelector('#mem-role').value;
      await data.updateMember(person.id, patch);
      s.close();
      toast('Saved', 'ok');
      onDone?.();
    } catch (err) { toast(err.message, 'error'); busy(e.currentTarget, false); }
  };
}
