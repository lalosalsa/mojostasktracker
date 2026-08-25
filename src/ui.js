/* Rendering + interaction helpers shared by every view. */

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function toast(message, kind = '') {
  const root = document.getElementById('toasts');
  const icon = kind === 'ok' ? '✓' : kind === 'error' ? '⚠︎' : 'ℹ︎';
  const node = el(`<div class="toast ${kind}"><span>${icon}</span><span>${esc(message)}</span></div>`);
  root.appendChild(node);
  setTimeout(() => {
    node.style.transition = 'opacity .25s ease';
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 260);
  }, kind === 'error' ? 4200 : 2600);
}

let sheetCount = 0;

/** Bottom sheet. Returns { close, body } — resolves onClose when dismissed. */
export function sheet({ title, body, footer, onClose }) {
  const root = document.getElementById('modal-root');
  const scrim = el(`
    <div class="scrim" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet">
        <div class="sheet-head">
          <h2>${esc(title)}</h2>
          <button class="icon-btn" data-close aria-label="Close">✕</button>
        </div>
        <div class="sheet-body"></div>
        ${footer ? '<div class="sheet-foot"></div>' : ''}
      </div>
    </div>`);
  const bodyEl = scrim.querySelector('.sheet-body');
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body) bodyEl.appendChild(body);
  if (footer) {
    const foot = scrim.querySelector('.sheet-foot');
    if (typeof footer === 'string') foot.innerHTML = footer;
    else foot.appendChild(footer);
  }

  const close = () => {
    scrim.remove();
    sheetCount -= 1;
    if (!sheetCount) document.body.style.overflow = '';
    onClose?.();
  };
  scrim.addEventListener('click', (e) => {
    if (e.target === scrim || e.target.closest('[data-close]')) close();
  });
  root.appendChild(scrim);
  sheetCount += 1;
  document.body.style.overflow = 'hidden';
  return { close, body: bodyEl, root: scrim };
}

export function confirmSheet({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const s = sheet({
      title,
      body: `<p style="font-size:14.5px;line-height:1.55;color:var(--ink-2)">${esc(message)}</p>`,
      footer: el(`<div style="display:flex;gap:10px;width:100%">
        <button class="btn ghost" style="flex:1" data-no>Cancel</button>
        <button class="btn ${danger ? 'danger' : ''}" style="flex:1" data-yes>${esc(confirmLabel)}</button>
      </div>`),
      onClose: () => { if (!done) { done = true; resolve(false); } },
    });
    s.root.querySelector('[data-no]').onclick = () => { done = true; s.close(); resolve(false); };
    s.root.querySelector('[data-yes]').onclick = () => { done = true; s.close(); resolve(true); };
  });
}

/* ------------------------------------------------------------------- dates */
export function fmtDate(dateStr, { weekday = true } = {}) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, {
    ...(weekday ? { weekday: 'short' } : {}),
    month: 'short',
    day: 'numeric',
  });
}

export function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function timeAgo(iso) {
  if (!iso) return 'never';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('') || '?';
}

export const STATUS_LABELS = {
  open: 'To do',
  in_progress: 'In progress',
  submitted: 'Done — awaiting review',
  verified: 'Verified',
  rejected: 'Needs a redo',
};
export const STATUS_CHIP = {
  open: '',
  in_progress: 'brand',
  submitted: 'warn',
  verified: 'ok',
  rejected: 'danger',
};
export const PRIORITY_CHIP = { urgent: 'danger', high: 'warn', normal: '', low: 'info' };

export function busy(btn, on = true) {
  if (!btn) return;
  if (on) {
    btn.dataset.label = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
  } else {
    btn.disabled = false;
    if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
  }
}
