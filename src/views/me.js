/* Profile, install help, and (for managers) workspace settings. */

import { el, esc, toast, busy, confirmSheet, initials } from '../ui.js';
import * as data from '../data.js';
import { state, isAdmin, setState } from '../store.js';
import { sb } from '../supabase.js';
import { clearSupabaseConfig, getSupabaseConfig, APP_NAME } from '../config.js';
import { navigate } from '../router.js';

export async function meView(container) {
  container.innerHTML = '';
  const profile = state.profile;
  const admin = isAdmin();

  const card = el(`
    <div class="card">
      <div class="person">
        <span class="avatar">${esc(initials(profile.full_name || profile.email))}</span>
        <span class="who">
          <span class="name" style="font-size:16px">${esc(profile.full_name || 'Your name')}</span>
          <span class="sub">${esc(profile.email)}</span>
        </span>
        <span class="chip ${admin ? 'brand' : ''}">${admin ? 'Manager' : 'Crew'}</span>
      </div>
      <div class="field mt-lg">
        <label for="me-name">Your name</label>
        <input class="input" id="me-name" value="${esc(profile.full_name || '')}" maxlength="80" autocomplete="name">
      </div>
      <div class="row">
        <div class="field">
          <label for="me-title">Job title</label>
          <input class="input" id="me-title" value="${esc(profile.job_title || '')}" maxlength="60">
        </div>
        <div class="field">
          <label for="me-phone">Phone</label>
          <input class="input" id="me-phone" value="${esc(profile.phone || '')}" maxlength="30" inputmode="tel" autocomplete="tel">
        </div>
      </div>
      <button class="btn block" data-save>Save details</button>
    </div>`);

  card.querySelector('[data-save]').onclick = async (e) => {
    const btn = e.currentTarget;
    busy(btn);
    try {
      const updated = await data.updateMyProfile({
        full_name: card.querySelector('#me-name').value.trim(),
        job_title: card.querySelector('#me-title').value.trim(),
        phone: card.querySelector('#me-phone').value.trim(),
      });
      setState({ profile: updated });
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
      <p class="small muted mt">Signed in as ${esc(profile.email)}. This device stays signed in until you sign out.</p>
      <button class="btn ghost block mt" data-signout>Sign out</button>
    </div>`);
  account.querySelector('[data-signout]').onclick = async () => {
    const yes = await confirmSheet({
      title: 'Sign out?',
      message: 'You will need your email code to get back in on this device.',
      confirmLabel: 'Sign out',
      danger: true,
    });
    if (!yes) return;
    await sb().auth.signOut();
  };
  container.appendChild(account);

  const cfg = getSupabaseConfig();
  container.appendChild(el(`
    <p class="small muted center mt-lg">${esc(APP_NAME)} · connected to ${esc(new URL(cfg.url).hostname)}</p>`));

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
