/* Team roster: invite, approve, pause, promote. */

import { el, esc, toast, busy, sheet, confirmSheet, timeAgo, initials } from '../ui.js';
import * as data from '../data.js';
import { state } from '../store.js';
import { emptyState, skeletonList, sectionHead } from './components.js';
import { navigate } from '../router.js';

export async function teamView(container) {
  container.innerHTML = '';
  const shell = el('<div></div>');
  shell.appendChild(skeletonList(4));
  container.appendChild(shell);

  const refresh = () => teamView(container);
  const [team, invites, todayStats] = await Promise.all([
    data.listTeam(),
    data.listInvites().catch(() => []),
    data.employeeDayStats(data.todayStr()).catch(() => []),
  ]);
  const statsById = new Map(todayStats.map((s) => [s.id, s]));

  shell.innerHTML = '';

  const add = el('<button class="btn block">＋ Add a team member</button>');
  add.onclick = () => openInviteSheet(refresh);
  shell.appendChild(add);

  const pending = team.filter((p) => p.status === 'pending');
  if (pending.length) {
    const sec = el(`<div class="section">${sectionHead('Waiting for approval', pending.length)}</div>`);
    for (const p of pending) {
      const row = el(`
        <div class="list-row">
          <span class="avatar">${esc(initials(p.full_name || p.email))}</span>
          <span class="grow">
            <span style="font-weight:650;display:block">${esc(p.full_name || p.email)}</span>
            <span class="small muted">${esc(p.email)} · asked ${esc(timeAgo(p.created_at))}</span>
          </span>
          <button class="btn sm" data-approve>Approve</button>
          <button class="icon-btn" data-deny title="Decline">✕</button>
        </div>`);
      row.querySelector('[data-approve]').onclick = async (e) => {
        busy(e.currentTarget);
        try {
          await data.updateMember(p.id, { status: 'active' });
          toast(`${p.full_name || p.email} can now log tasks`, 'ok');
          refresh();
        } catch (err) { toast(err.message, 'error'); busy(e.currentTarget, false); }
      };
      row.querySelector('[data-deny]').onclick = async () => {
        const yes = await confirmSheet({
          title: 'Decline this request?', message: `${p.email} will not be able to use the app.`,
          confirmLabel: 'Decline', danger: true,
        });
        if (!yes) return;
        try { await data.updateMember(p.id, { status: 'disabled' }); refresh(); }
        catch (err) { toast(err.message, 'error'); }
      };
      sec.appendChild(row);
    }
    shell.appendChild(sec);
  }

  if (invites.length) {
    const sec = el(`<div class="section">${sectionHead('Invited — waiting for first sign-in', invites.length)}</div>`);
    for (const i of invites) {
      const row = el(`
        <div class="list-row">
          <span class="avatar sm">✉️</span>
          <span class="grow">
            <span style="font-weight:650;display:block">${esc(i.email)}</span>
            <span class="small muted">${esc(i.role === 'admin' ? 'Manager' : 'Crew')} · invited ${esc(timeAgo(i.created_at))}</span>
          </span>
          <button class="icon-btn" data-cancel title="Cancel invite">✕</button>
        </div>`);
      row.querySelector('[data-cancel]').onclick = async () => {
        try { await data.cancelInvite(i.email); refresh(); }
        catch (err) { toast(err.message, 'error'); }
      };
      sec.appendChild(row);
    }
    shell.appendChild(sec);
  }

  const active = team.filter((p) => p.status === 'active');
  const paused = team.filter((p) => p.status === 'disabled');

  const renderPerson = (p) => {
    const s = statsById.get(p.id);
    const row = el(`
      <div class="list-row" style="cursor:pointer">
        <span class="avatar">${esc(initials(p.full_name || p.email))}</span>
        <span class="grow">
          <span style="font-weight:650;display:block">${esc(p.full_name || p.email)}
            ${p.role === 'admin' ? '<span class="chip brand" style="margin-left:6px">Manager</span>' : ''}</span>
          <span class="small muted">${esc(p.job_title || p.email)}</span>
          <span class="small muted" style="display:block">
            ${s ? `${s.completed}/${s.assigned} done today` : 'No tasks today'} ·
            ${p.last_seen_at ? `seen ${esc(timeAgo(p.last_seen_at))}` : 'never signed in'}
          </span>
        </span>
        <span class="icon-btn">›</span>
      </div>`);
    row.onclick = () => openMemberSheet(p, refresh);
    return row;
  };

  const sec = el(`<div class="section">${sectionHead('Your team', active.length)}</div>`);
  if (!active.length) {
    sec.appendChild(emptyState('👷', 'No one on the roster yet', 'Add your crew by email — they sign in with a code and stay signed in.'));
  }
  active.forEach((p) => sec.appendChild(renderPerson(p)));
  shell.appendChild(sec);

  if (paused.length) {
    const off = el(`<div class="section">${sectionHead('Turned off', paused.length)}</div>`);
    paused.forEach((p) => off.appendChild(renderPerson(p)));
    shell.appendChild(off);
  }
}

function openInviteSheet(onDone) {
  const body = el(`
    <div>
      <div class="field">
        <label for="inv-email">Work email</label>
        <input class="input" id="inv-email" type="email" inputmode="email" autocapitalize="none"
               autocomplete="off" placeholder="name@company.com">
        <div class="hint">They sign in with this email — no password to remember.</div>
      </div>
      <div class="row">
        <div class="field">
          <label for="inv-name">Name</label>
          <input class="input" id="inv-name" placeholder="Optional" maxlength="80">
        </div>
        <div class="field">
          <label for="inv-title">Job title</label>
          <input class="input" id="inv-title" placeholder="Optional" maxlength="60">
        </div>
      </div>
      <div class="field">
        <label for="inv-role">Role</label>
        <select class="select" id="inv-role">
          <option value="employee">Crew — logs their own tasks</option>
          <option value="admin">Manager — sees everyone and signs off work</option>
        </select>
      </div>
      <div class="banner info">
        <span class="ic">💡</span>
        <div>Send them the app link. The first time they open it they enter this email, type the code we email them, and they're in — for good on that phone.</div>
      </div>
    </div>`);
  const foot = el(`<div style="display:flex;gap:10px;width:100%">
    <button class="btn ghost" style="flex:1" data-close>Cancel</button>
    <button class="btn" style="flex:2" data-save>Add to team</button>
  </div>`);
  const s = sheet({ title: 'Add a team member', body, footer: foot });
  setTimeout(() => body.querySelector('#inv-email').focus(), 90);

  foot.querySelector('[data-save]').onclick = async (e) => {
    const email = body.querySelector('#inv-email').value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      toast('Enter a valid email address', 'error');
      return;
    }
    busy(e.currentTarget);
    try {
      await data.inviteMember({
        email,
        fullName: body.querySelector('#inv-name').value.trim(),
        jobTitle: body.querySelector('#inv-title').value.trim(),
        role: body.querySelector('#inv-role').value,
      });
      s.close();
      toast('Added — share the app link with them', 'ok');
      onDone?.();
    } catch (err) {
      toast(err.message, 'error');
      busy(e.currentTarget, false);
    }
  };
}

function openMemberSheet(person, onDone) {
  const self = person.id === state.profile.id;
  const body = el(`
    <div>
      <div class="person">
        <span class="avatar">${esc(initials(person.full_name || person.email))}</span>
        <span class="who">
          <span class="name">${esc(person.full_name || person.email)}</span>
          <span class="sub">${esc(person.email)}</span>
        </span>
      </div>
      <div class="row mt-lg">
        <div class="field">
          <label for="mem-name">Name</label>
          <input class="input" id="mem-name" value="${esc(person.full_name || '')}" maxlength="80">
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
          <option value="admin" ${person.role === 'admin' ? 'selected' : ''}>Manager</option>
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
        message: `${person.full_name || person.email} will be signed out and cannot log tasks until you turn it back on.`,
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
        full_name: body.querySelector('#mem-name').value.trim(),
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
