/* Sign up, verify by emailed code, then create a team or join one with a code. */

import { el, esc, toast, busy } from '../ui.js';
import { sb, resetClient, friendlyError } from '../supabase.js';
import { saveSupabaseConfig, APP_NAME } from '../config.js';
import { setState } from '../store.js';
import * as data from '../data.js';

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

/* ================================================================== sign in */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Screens: welcome → (sign up | log in) → emailed code.
 * Verifying the code hands off to main.js, which decides whether the person
 * still needs a team.
 */
export function signInView(root, { appName = APP_NAME } = {}) {
  root.innerHTML = '';
  let name = '';
  let email = '';
  let mode = 'signup';
  let cooldown = 0;
  let timer = null;

  const wrap = el(`
    <div class="auth">
      <div class="brand-mark">✓</div>
      <h1 data-heading>${esc(appName)}</h1>
      <p class="lede" data-lede">Track the work your crew finishes, with photo proof.</p>
      <div data-step></div>
      <p class="foot" data-foot></p>
    </div>`);
  const step = wrap.querySelector('[data-step]');
  const heading = wrap.querySelector('[data-heading]');
  const lede = wrap.querySelector('.lede');
  const foot = wrap.querySelector('[data-foot]');

  /* ---- welcome ---- */
  const welcomeStep = () => {
    clearInterval(timer);
    step.innerHTML = '';
    heading.textContent = appName;
    lede.textContent = 'Track the work your crew finishes each day, with photo proof.';
    foot.textContent = '';

    const buttons = el(`
      <div>
        <button class="btn block" data-signup>Create an account</button>
        <button class="btn ghost block mt" data-login>I already have an account</button>
      </div>`);
    buttons.querySelector('[data-signup]').onclick = () => { mode = 'signup'; detailsStep(); };
    buttons.querySelector('[data-login]').onclick = () => { mode = 'login'; detailsStep(); };
    step.appendChild(buttons);
  };

  /* ---- name + email ---- */
  const detailsStep = () => {
    step.innerHTML = '';
    const signup = mode === 'signup';
    heading.textContent = signup ? 'Create your account' : 'Welcome back';
    lede.textContent = signup
      ? "We'll email you a 6-digit code to confirm it's you. No password to remember."
      : 'Enter the email you signed up with and we\'ll send you a code.';
    foot.textContent = '';

    const form = el(`
      <form novalidate>
        ${signup ? `
        <div class="field">
          <label for="si-name">Your name</label>
          <input class="input" id="si-name" autocomplete="name" placeholder="Jose Perez"
                 maxlength="80" value="${esc(name)}">
        </div>` : ''}
        <div class="field">
          <label for="si-email">Email</label>
          <input class="input" id="si-email" type="email" inputmode="email" autocomplete="email"
                 autocapitalize="none" spellcheck="false" placeholder="you@company.com" value="${esc(email)}">
        </div>
        <button class="btn block" type="submit">Send my code</button>
        <button class="btn link block mt" type="button" data-back>← Back</button>
      </form>`);

    form.querySelector('[data-back]').onclick = welcomeStep;
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type=submit]');
      email = form.querySelector('#si-email').value.trim().toLowerCase();
      name = signup ? form.querySelector('#si-name').value.trim() : '';

      if (signup && name.length < 2) {
        toast('Tell us your name so your manager knows who did the work', 'error');
        form.querySelector('#si-name').focus();
        return;
      }
      if (!EMAIL_RE.test(email)) {
        toast('Enter a valid email address', 'error');
        form.querySelector('#si-email').focus();
        return;
      }

      busy(btn);
      try {
        await sendCode();
        codeStep();
      } catch (err) {
        toast(friendlyError(err), 'error');
        busy(btn, false);
      }
    };
    step.appendChild(form);
    setTimeout(() => form.querySelector(signup ? '#si-name' : '#si-email').focus(), 120);
  };

  const sendCode = async () => {
    const { error } = await sb().auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: mode === 'signup',
        data: name ? { full_name: name } : undefined,
      },
    });
    if (error) {
      // Supabase says "Signups not allowed" when logging in with an unknown email
      if (/not allowed|not found|signup/i.test(error.message) && mode === 'login') {
        throw new Error("We don't have an account for that email. Create one instead.");
      }
      throw error;
    }
  };

  /* ---- 6-digit code ---- */
  const codeStep = () => {
    step.innerHTML = '';
    heading.textContent = 'Check your email';
    lede.innerHTML = `We sent a 6-digit code to <strong>${esc(email)}</strong>.`;
    foot.textContent = "Can't find it? Check spam — it arrives within a minute.";
    cooldown = 45;

    const form = el(`
      <form novalidate>
        <div class="field">
          <label for="si-code">6-digit code</label>
          <input class="input code-input" id="si-code" inputmode="numeric" autocomplete="one-time-code"
                 maxlength="6" pattern="[0-9]*" placeholder="······">
        </div>
        <button class="btn block" type="submit">Verify and continue</button>
        <div class="btn-row mt">
          <button class="btn link" type="button" data-back>← Change email</button>
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
        if (name) await data.setMyName(name).catch(() => {});
        // main.js picks it up from here via onAuthStateChange
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
    form.querySelector('[data-back]').onclick = () => { clearInterval(timer); detailsStep(); };
    resend.onclick = async () => {
      resend.disabled = true;
      try {
        await sendCode();
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

  welcomeStep();
  root.appendChild(wrap);
}

/* ============================================== create a team or join one */

/**
 * Shown once, right after sign-up, to anyone who isn't on a team yet.
 * onJoined(identity) hands the fresh { member, team } back to the app.
 */
export function teamSetupView(root, member, onJoined) {
  root.innerHTML = '';
  const firstName = (member.name || '').split(' ')[0] || 'there';

  const wrap = el(`
    <div class="auth">
      <div class="brand-mark">👥</div>
      <h1>Hi ${esc(firstName)}</h1>
      <p class="lede">Last step. Are you setting up a team, or joining one your manager already made?</p>
      <div data-step></div>
      <p class="foot" data-foot>Signed in as ${esc(member.email)}</p>
    </div>`);
  const step = wrap.querySelector('[data-step]');

  const chooseStep = () => {
    step.innerHTML = '';
    const buttons = el(`
      <div>
        <button class="btn block" data-join>I have a team code</button>
        <button class="btn ghost block mt" data-create>Create a new team</button>
      </div>`);
    buttons.querySelector('[data-join]').onclick = joinStep;
    buttons.querySelector('[data-create]').onclick = createStep;
    step.appendChild(buttons);
  };

  const finish = async (identity, message) => {
    setState({ me: identity.member, team: identity.team });
    toast(message, 'ok');
    onJoined(identity);
  };

  const joinStep = () => {
    step.innerHTML = '';
    const form = el(`
      <form novalidate>
        <div class="field">
          <label for="tc-code">Team code</label>
          <input class="input code-input" id="tc-code" maxlength="7" autocapitalize="characters"
                 autocomplete="off" spellcheck="false" placeholder="ABC123" style="letter-spacing:.3em;font-size:22px">
          <div class="hint">The 6-character code your manager gave you.</div>
        </div>
        <button class="btn block" type="submit">Join the team</button>
        <button class="btn link block mt" type="button" data-back>← Back</button>
      </form>`);

    const input = form.querySelector('#tc-code');
    input.oninput = () => {
      input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    };
    form.querySelector('[data-back]').onclick = chooseStep;
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type=submit]');
      const code = input.value.trim();
      if (code.length < 4) {
        toast('Enter the code your manager shared', 'error');
        return;
      }
      busy(btn);
      try {
        const identity = await data.joinTeam(code, member.name);
        await finish(identity, `You're on ${identity.team.name}`);
      } catch (err) {
        toast(friendlyError(err), 'error');
        busy(btn, false);
        input.select();
      }
    };
    step.appendChild(form);
    setTimeout(() => input.focus(), 120);
  };

  const createStep = () => {
    step.innerHTML = '';
    const form = el(`
      <form novalidate>
        <div class="field">
          <label for="tc-name">Business or team name</label>
          <input class="input" id="tc-name" maxlength="60" autocomplete="organization"
                 placeholder="Mojo Services">
          <div class="hint">You'll be the manager. You get a code to invite your crew.</div>
        </div>
        <button class="btn block" type="submit">Create the team</button>
        <button class="btn link block mt" type="button" data-back>← Back</button>
      </form>`);

    form.querySelector('[data-back]').onclick = chooseStep;
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type=submit]');
      const teamName = form.querySelector('#tc-name').value.trim();
      if (teamName.length < 2) {
        toast('Give your team a name', 'error');
        return;
      }
      busy(btn);
      try {
        const identity = await data.createTeam(teamName, member.name);
        setState({ me: identity.member, team: identity.team });
        codesStep(identity);
      } catch (err) {
        toast(friendlyError(err), 'error');
        busy(btn, false);
      }
    };
    step.appendChild(form);
    setTimeout(() => form.querySelector('#tc-name').focus(), 120);
  };

  /** Shows the freshly minted codes before dropping them into the app. */
  const codesStep = (identity) => {
    step.innerHTML = '';
    wrap.querySelector('h1').textContent = identity.team.name;
    wrap.querySelector('.lede').textContent =
      'Your team is ready. Share this code with your crew — they type it when they sign up.';

    const box = el(`
      <div>
        <div class="card center">
          <div class="k" style="font-size:11.5px;font-weight:700;letter-spacing:.08em;color:var(--muted)">CREW CODE</div>
          <div style="font-size:38px;font-weight:800;letter-spacing:.16em;margin:8px 0">${esc(identity.team.join_code)}</div>
          <button class="btn soft sm" data-copy>Copy code</button>
        </div>
        <p class="small muted center mt">You can find this again any time under Team.</p>
        <button class="btn block mt-lg" data-go>Start using the app</button>
      </div>`);

    box.querySelector('[data-copy]').onclick = async () => {
      try {
        await navigator.clipboard.writeText(identity.team.join_code);
        toast('Code copied', 'ok');
      } catch {
        toast(`Your crew code is ${identity.team.join_code}`);
      }
    };
    box.querySelector('[data-go]').onclick = () => onJoined(identity);
    step.appendChild(box);
  };

  chooseStep();
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
