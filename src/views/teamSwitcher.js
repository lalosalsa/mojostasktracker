/* The location switcher that lives next to the profile icon. */

import { el, esc, toast, busy, sheet, initials } from '../ui.js';
import * as data from '../data.js';
import { state, setState, canCreateTeam } from '../store.js';
import { friendlyError } from '../supabase.js';

/** Opens the list of places this person works, with a way to add another. */
export function openTeamSwitcher({ onSwitched } = {}) {
  const teams = state.teams || [];
  const body = el('<div></div>');

  const list = el('<div></div>');
  for (const team of teams) {
    const row = el(`
      <div class="list-row" style="cursor:pointer${team.is_active ? ';border-color:var(--brand)' : ''}">
        <span class="avatar sm" style="${team.is_active ? '' : 'background:var(--line);color:var(--muted)'}">
          ${esc(initials(team.name))}</span>
        <span class="grow">
          <span style="font-weight:650;display:block">${esc(team.name)}</span>
          <span class="small muted">${esc(team.role === 'manager' ? 'Manager' : 'Crew')} ·
            ${team.crew_count} ${Number(team.crew_count) === 1 ? 'person' : 'people'}</span>
        </span>
        ${team.is_active ? '<span class="chip brand">Here now</span>' : '<span class="icon-btn">›</span>'}
      </div>`);

    if (!team.is_active) {
      row.onclick = async () => {
        row.style.opacity = '.5';
        try {
          const identity = await data.switchTeam(team.team_id);
          setState({
            account: identity.account,
            me: identity.member,
            team: identity.team,
            teams: identity.teams || [],
          });
          s.close();
          toast(`Now at ${identity.team.name}`, 'ok');
          onSwitched?.();
        } catch (err) {
          toast(friendlyError(err), 'error');
          row.style.opacity = '';
        }
      };
    }
    list.appendChild(row);
  }
  body.appendChild(list);

  if (canCreateTeam()) {
    const add = el('<button class="btn ghost block mt">＋ Add another location</button>');
    add.onclick = () => { s.close(); openNewTeamSheet(onSwitched); };
    body.appendChild(add);
  }

  const join = el('<button class="btn ghost block mt">Join a team with a code</button>');
  join.onclick = () => { s.close(); openJoinSheet(onSwitched); };
  body.appendChild(join);

  body.appendChild(el(`
    <p class="small muted center mt">Each location keeps its own crew, blocks and history.</p>`));

  const s = sheet({ title: 'Your locations', body });
  return s;
}

/** Managers only — starting another location. */
export function openNewTeamSheet(onDone) {
  const body = el(`
    <div class="field" style="margin-bottom:0">
      <label for="nt-name">Location name</label>
      <input class="input" id="nt-name" maxlength="60" placeholder="e.g. Mojo Airport">
      <div class="hint">You'll be its manager, with a fresh crew code to share.</div>
    </div>`);
  const foot = el(`<div style="display:flex;gap:10px;width:100%">
    <button class="btn ghost" style="flex:1" data-close>Cancel</button>
    <button class="btn" style="flex:2" data-save>Create location</button>
  </div>`);
  const s = sheet({ title: 'Add a location', body, footer: foot });
  setTimeout(() => body.querySelector('#nt-name').focus(), 90);

  foot.querySelector('[data-save]').onclick = async (e) => {
    const name = body.querySelector('#nt-name').value.trim();
    if (name.length < 2) return toast('Give the location a name', 'error');
    busy(e.currentTarget);
    try {
      const identity = await data.createTeam(name, state.account?.name || '');
      setState({
        account: identity.account,
        me: identity.member,
        team: identity.team,
        teams: identity.teams || [],
      });
      s.close();
      toast(`${identity.team.name} is ready — share the crew code from Team`, 'ok');
      onDone?.();
    } catch (err) {
      toast(friendlyError(err), 'error');
      busy(e.currentTarget, false);
    }
  };
}

/** Anyone — joining another team with the code its manager shared. */
export function openJoinSheet(onDone) {
  const body = el(`
    <div class="field" style="margin-bottom:0">
      <label for="jt-code">Team code</label>
      <input class="input code-input" id="jt-code" maxlength="7" autocapitalize="characters"
             autocomplete="off" spellcheck="false" placeholder="ABC123"
             style="letter-spacing:.3em;font-size:22px">
      <div class="hint">The 6-character code from that location's manager.</div>
    </div>`);
  const foot = el(`<div style="display:flex;gap:10px;width:100%">
    <button class="btn ghost" style="flex:1" data-close>Cancel</button>
    <button class="btn" style="flex:2" data-save>Join</button>
  </div>`);
  const s = sheet({ title: 'Join a team', body, footer: foot });

  const input = body.querySelector('#jt-code');
  input.oninput = () => { input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); };
  setTimeout(() => input.focus(), 90);

  foot.querySelector('[data-save]').onclick = async (e) => {
    const code = input.value.trim();
    if (code.length < 4) return toast('Enter the code you were given', 'error');
    busy(e.currentTarget);
    try {
      const identity = await data.joinTeam(code, state.account?.name || '');
      setState({
        account: identity.account,
        me: identity.member,
        team: identity.team,
        teams: identity.teams || [],
      });
      s.close();
      toast(`You're on ${identity.team.name}`, 'ok');
      onDone?.();
    } catch (err) {
      toast(friendlyError(err), 'error');
      busy(e.currentTarget, false);
      input.select();
    }
  };
}
