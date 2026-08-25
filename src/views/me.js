/* Profile, install help, and (for managers) workspace settings. */

import { el, esc, toast, busy, confirmSheet, sheet, initials } from '../ui.js';
import * as data from '../data.js';
import { state, isManager, setState } from '../store.js';
import { sb } from '../supabase.js';
import { clearSupabaseConfig, getSupabaseConfig, APP_NAME, BUILD_ID } from '../config.js';
import { navigate } from '../router.js';
import { codeCard } from './team.js';

export async function meView(container) {
  container.innerHTML = '';
  const me = state.me;
  const admin = isManager();

  const card = el(`
    <div class="card">
      <div class="person">
        <span class="avatar">${esc(initials(me.name || me.email))}</span>
        <span class="who">
          <span class="name" style="font-size:16px">${esc(me.name || 'Your name')}</span>
          <span class="sub">${esc(me.email)}</span>
        </span>
        <span class="chip ${admin ? 'brand' : ''}">${admin ? 'Manager' : 'Crew'}</span>
      </div>
      <div class="field mt-lg">
        <label for="me-name">Your name</label>
        <input class="input" id="me-name" value="${esc(me.name || '')}" maxlength="80" autocomplete="name">
      </div>
      <div class="row">
        <div class="field">
          <label for="me-title">Job title</label>
          <input class="input" id="me-title" value="${esc(me.job_title || '')}" maxlength="60">
        </div>
        <div class="field">
          <label for="me-phone">Phone</label>
          <input class="input" id="me-phone" value="${esc(me.phone || '')}" maxlength="30" inputmode="tel" autocomplete="tel">
        </div>
      </div>
      <button class="btn block" data-save>Save details</button>
    </div>`);

  card.querySelector('[data-save]').onclick = async (e) => {
    const btn = e.currentTarget;
    busy(btn);
    try {
      const updated = await data.updateMyProfile({
        name: card.querySelector('#me-name').value.trim(),
        job_title: card.querySelector('#me-title').value.trim(),
        phone: card.querySelector('#me-phone').value.trim(),
      });
      setState({ me: updated });
      toast('Saved', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      busy(btn, false);
    }
  };
  container.appendChild(card);

  /* ---- install to home screen ---- */
  const installed = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const install = el(`
    <div class="card mt">
      <h2 style="font-size:15px">📱 Put this on your home screen</h2>
      ${installed
        ? '<p class="small muted mt">You are running the installed app. Nice.</p>'
        : `<p class="small muted mt" style="line-height:1.6">
             <strong>iPhone:</strong> tap the Share button in Safari, then <em>Add to Home Screen</em>.<br>
             <strong>Android:</strong> tap the ⋮ menu in Chrome, then <em>Install app</em> or <em>Add to Home screen</em>.
           </p>`}
    </div>`);
  if (!installed && state.installEvent) {
    const btn = el('<button class="btn block mt">Install app</button>');
    btn.onclick = async () => {
      state.installEvent.prompt();
      const { outcome } = await state.installEvent.userChoice;
      if (outcome === 'accepted') toast('Installed — look for the icon on your home screen', 'ok');
      setState({ installEvent: null });
    };
    install.appendChild(btn);
  }
  container.appendChild(install);

  if (admin) {
    const manage = el(`
      <div class="card mt">
        <h2 style="font-size:15px">Manager tools</h2>
        <div class="btn-row mt">
          <button class="btn ghost" data-go="/schedule">🗓 Schedule</button>
          <button class="btn ghost" data-go="/windows">⏱ Time blocks</button>
          <button class="btn ghost" data-go="/tasks">📋 All tasks</button>
          <button class="btn ghost" data-go="/recurring">🔁 Recurring tasks</button>
          <button class="btn ghost" data-go="/reports">📊 Reports &amp; export</button>
        </div>
      </div>`);
    manage.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => navigate(b.dataset.go); });
    container.appendChild(manage);
  }

  /* ---- account ---- */
  const account = el(`
    <div class="card mt">
      <h2 style="font-size:15px">Account</h2>
      <p class="small muted mt">Signed in as ${esc(me.email)}${state.team ? ` on ${esc(state.team.name)}` : ''}.
         This device stays signed in until you sign out.</p>
      <button class="btn ghost block mt" data-password>Change password</button>
      <button class="btn ghost block mt" data-signout>Sign out</button>
    </div>`);
  account.querySelector('[data-password]').onclick = () => openPasswordSheet();
  account.querySelector('[data-signout]').onclick = async () => {
    const yes = await confirmSheet({
      title: 'Sign out?',
      message: 'You will need a fresh email code to get back in on this device.',
      confirmLabel: 'Sign out',
      danger: true,
    });
    if (!yes) return;
    await sb().auth.signOut();
  };
  container.appendChild(account);

  const cfg = getSupabaseConfig();
  const version = el(`
    <p class="small muted center mt-lg">${esc(APP_NAME)} · version ${esc(BUILD_ID)}<br>
    connected to ${esc(new URL(cfg.url).hostname)}</p>`);
  container.appendChild(version);

  const update = el('<button class="btn link block">Check for updates</button>');
  update.onclick = async () => {
    busy(update);
    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((r) => r.update()));
      }
      toast('Reloading the latest version…');
      setTimeout(() => location.reload(), 600);
    } catch {
      location.reload();
    }
  };
  container.appendChild(update);

  if (!cfg.fromBuild) {
    const reset = el('<button class="btn link block mt">Reset backend connection</button>');
    reset.onclick = async () => {
      const yes = await confirmSheet({
        title: 'Reset connection?',
        message: 'You will have to re-enter the Supabase project URL and key on this device.',
        confirmLabel: 'Reset',
        danger: true,
      });
      if (!yes) return;
      await sb().auth.signOut().catch(() => {});
      clearSupabaseConfig();
      location.reload();
    };
    container.appendChild(reset);
  }
}


/** Change your own password without leaving the app. */
function openPasswordSheet() {
  const body = el(`
    <div>
      <div class="field">
        <label for="pw-new">New password</label>
        <input class="input" id="pw-new" type="password" autocomplete="new-password"
               placeholder="At least 8 characters">
      </div>
      <div class="field" style="margin-bottom:0">
        <label for="pw-again">Type it again</label>
        <input class="input" id="pw-again" type="password" autocomplete="new-password">
      </div>
    </div>`);
  const foot = el(`<div style="display:flex;gap:10px;width:100%">
    <button class="btn ghost" style="flex:1" data-close>Cancel</button>
    <button class="btn" style="flex:1" data-save>Save</button>
  </div>`);
  const s = sheet({ title: 'Change password', body, footer: foot });

  foot.querySelector('[data-save]').onclick = async (e) => {
    const next = body.querySelector('#pw-new').value;
    const again = body.querySelector('#pw-again').value;
    if (next.length < 8) return toast('Use at least 8 characters', 'error');
    if (next !== again) return toast("Those don't match", 'error');
    busy(e.currentTarget);
    try {
      await data.changePassword(next);
      s.close();
      toast('Password changed', 'ok');
    } catch (err) { toast(err.message, 'error'); busy(e.currentTarget, false); }
  };
}
