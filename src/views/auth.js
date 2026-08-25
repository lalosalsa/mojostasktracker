/* Sign-in: one email, one code, then the phone stays signed in for good. */

import { el, esc, toast, busy } from '../ui.js';
import { sb, resetClient, friendlyError } from '../supabase.js';
import { saveSupabaseConfig, APP_NAME } from '../config.js';
import { setState } from '../store.js';
import { loadProfile } from '../data.js';

/* ------------------------------------------------------------ first-run setup */
export function setupView(root) {
  root.innerHTML = '';
  const wrap = el(`
    <div class="auth">
      <div class="brand-mark">🔧</div>
      <h1>Connect your database</h1>
      <p class="lede">This app stores its data in your own Supabase project. Paste the project URL and the <strong>anon public</strong> key from
        Supabase → Project Settings → API.</p>
      <div class="field">
        <label for="cfg-url">Project URL</label>
        <input class="input" id="cfg-url" placeholder="https://xxxxxxxx.supabase.co" autocapitalize="none" spellcheck="false">
      </div>
      <div class="field">
        <label for="cfg-key">Anon public key</label>
        <textarea class="textarea" id="cfg-key" placeholder="eyJhbGciOi…" autocapitalize="none" spellcheck="false"></textarea>
      </div>
      <button class="btn block" data-save>Connect</button>
      <p class="foot">Set <code>SUPABASE_URL</code> and <code>SUPABASE_ANON_KEY</code> in your Vercel project to skip this screen for everyone.</p>
    </div>`);

  wrap.querySelector('[data-save]').onclick = async (e) => {
    const url = wrap.querySelector('#cfg-url').value.trim().replace(/\/+$/, '');
    const key = wrap.querySelector('#cfg-key').value.trim();
    if (!/^https:\/\/.+/.test(url) || key.length < 20) {
      toast('Check the URL and key and try again', 'error');
      return;
    }
    busy(e.currentTarget);
    saveSupabaseConfig(url, key);
    resetClient();
    try {
      const { error } = await sb().auth.getSession();
      if (error) throw error;
      location.reload();
    } catch (err) {
      toast(friendlyError(err), 'error');
      busy(e.currentTarget, false);
    }
  };
  root.appendChild(wrap);
}

/* ---------------------------------------------------------------- sign in */
export function signInView(root, { appName = APP_NAME } = {}) {
  root.innerHTML = '';
  let email = '';
  let cooldown = 0;
  let timer = null;

  const wrap = el(`
    <div class="auth">
      <div class="brand-mark">✓</div>
      <h1>${esc(appName)}</h1>
      <p class="lede">Sign in with your work email. We'll text a 6-digit code to your inbox — after that this phone stays signed in.</p>
      <div data-step></div>
      <p class="foot">Trouble getting in? Ask your manager to check you're on the team roster.</p>
    </div>`);
  const step = wrap.querySelector('[data-step]');

  const emailStep = () => {
    step.innerHTML = '';
    const form = el(`
      <form novalidate>
        <div class="field">
          <label for="si-email">Work email</label>
          <input class="input" id="si-email" type="email" inputmode="email" autocomplete="email"
                 autocapitalize="none" spellcheck="false" placeholder="you@company.com" value="${esc(email)}">
        </div>
        <button class="btn block" type="submit">Send my code</button>
      </form>`);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button');
      email = form.querySelector('#si-email').value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        toast('Enter a valid email address', 'error');
        return;
      }
      busy(btn);
      try {
        const { error } = await sb().auth.signInWithOtp({
          email,
          options: { shouldCreateUser: true, emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        codeStep();
      } catch (err) {
        toast(friendlyError(err), 'error');
        busy(btn, false);
      }
    };
    step.appendChild(form);
    setTimeout(() => form.querySelector('#si-email').focus(), 120);
  };

  const codeStep = () => {
    step.innerHTML = '';
    cooldown = 45;
    const form = el(`
      <form novalidate>
        <div class="banner ok" style="margin-bottom:16px">
          <span class="ic">✉️</span>
          <div>Code sent to <strong>${esc(email)}</strong>. It expires in about an hour.</div>
        </div>
        <div class="field">
          <label for="si-code">6-digit code</label>
          <input class="input code-input" id="si-code" inputmode="numeric" autocomplete="one-time-code"
                 maxlength="6" pattern="[0-9]*" placeholder="······">
        </div>
        <button class="btn block" type="submit">Sign in</button>
        <div class="btn-row mt">
          <button class="btn link" type="button" data-back>← Different email</button>
          <button class="btn link" type="button" data-resend disabled>Resend in 45s</button>
        </div>
      </form>`);

    const input = form.querySelector('#si-code');
    const resend = form.querySelector('[data-resend]');

    clearInterval(timer);
    timer = setInterval(() => {
      cooldown -= 1;
      if (cooldown <= 0) {
        clearInterval(timer);
        resend.disabled = false;
        resend.textContent = 'Resend code';
      } else {
        resend.textContent = `Resend in ${cooldown}s`;
      }
    }, 1000);

    const submit = async () => {
      const token = input.value.replace(/\D/g, '');
      if (token.length !== 6) return;
      const btn = form.querySelector('button[type=submit]');
      busy(btn);
      try {
        const { error } = await sb().auth.verifyOtp({ email, token, type: 'email' });
        if (error) throw error;
        clearInterval(timer);
        // onAuthStateChange in main.js takes it from here
      } catch (err) {
        toast(friendlyError(err), 'error');
        busy(btn, false);
        input.select();
      }
    };

    input.oninput = () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 6);
      if (input.value.length === 6) submit();
    };
    form.onsubmit = (e) => { e.preventDefault(); submit(); };
    form.querySelector('[data-back]').onclick = () => { clearInterval(timer); emailStep(); };
    resend.onclick = async () => {
      resend.disabled = true;
      try {
        const { error } = await sb().auth.signInWithOtp({
          email,
          options: { shouldCreateUser: true, emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast('New code sent', 'ok');
        codeStep();
      } catch (err) {
        toast(friendlyError(err), 'error');
        resend.disabled = false;
      }
    };

    step.appendChild(form);
    setTimeout(() => input.focus(), 120);
  };

  emailStep();
  root.appendChild(wrap);
}

/* ------------------------------------------------------------ waiting room */
export function pendingView(root, profile) {
  root.innerHTML = '';
  const wrap = el(`
    <div class="auth">
      <div class="brand-mark">⏳</div>
      <h1>Almost there</h1>
      <p class="lede">Your manager needs to approve <strong>${esc(profile.email)}</strong> before you can start logging tasks.
         Once they tap approve, pull down here and you're in.</p>
      <button class="btn block" data-check>Check again</button>
      <button class="btn link block mt" data-out>Sign out</button>
      <p class="foot">Give your manager a nudge — approving takes them two taps in the Team tab.</p>
    </div>`);

  wrap.querySelector('[data-check]').onclick = async (e) => {
    busy(e.currentTarget);
    try {
      const fresh = await loadProfile(profile.id);
      setState({ profile: fresh });
      if (fresh?.status === 'active') toast('You are in!', 'ok');
      else toast('Not approved yet — check back in a minute');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      busy(e.currentTarget, false);
    }
  };
  wrap.querySelector('[data-out]').onclick = () => sb().auth.signOut();
  root.appendChild(wrap);
}

export function disabledView(root) {
  root.innerHTML = '';
  const wrap = el(`
    <div class="auth">
      <div class="brand-mark">🚫</div>
      <h1>Access turned off</h1>
      <p class="lede">This account can't log tasks right now. Talk to your manager if you think that's a mistake.</p>
      <button class="btn ghost block" data-out>Sign out</button>
    </div>`);
  wrap.querySelector('[data-out]').onclick = () => sb().auth.signOut();
  root.appendChild(wrap);
}

export function errorView(root, message, onRetry) {
  root.innerHTML = '';
  const wrap = el(`
    <div class="auth">
      <div class="brand-mark">⚠️</div>
      <h1>Something went wrong</h1>
      <p class="lede">${esc(message)}</p>
      <button class="btn block" data-retry>Try again</button>
      <button class="btn link block mt" data-out>Sign out</button>
    </div>`);
  wrap.querySelector('[data-retry]').onclick = () => onRetry?.();
  wrap.querySelector('[data-out]').onclick = () => sb().auth.signOut().then(() => location.reload());
  root.appendChild(wrap);
}
