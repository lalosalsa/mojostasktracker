/* The proof queue: photos come in, the manager signs off or sends them back. */

import { el, esc, toast, busy, timeAgo } from '../ui.js';
import * as data from '../data.js';
import { emptyState, skeletonList, sectionHead } from './components.js';
import { openTaskSheet, askNote } from './taskSheet.js';
import { hydrateThumbs, openLightbox } from '../photos.js';

export async function reviewView(container) {
  container.innerHTML = '';
  const shell = el('<div></div>');
  shell.appendChild(skeletonList(3));
  container.appendChild(shell);

  const tasks = await data.listTasks({ status: 'submitted', limit: 100 });
  const refresh = () => reviewView(container);

  shell.innerHTML = '';
  if (!tasks.length) {
    shell.appendChild(emptyState('✅', 'All caught up', 'Nothing is waiting on your sign-off right now.'));
    return;
  }

  shell.appendChild(el(`<div class="section" style="margin-top:0">${sectionHead('Waiting on your sign-off', tasks.length)}</div>`));

  for (const task of tasks) {
    const strip = (task.photos || []).slice(0, 4).map((p) =>
      `<img data-path="${esc(p.thumb_path || p.storage_path)}" alt="" loading="lazy"
            style="width:70px;height:70px;border-radius:11px;object-fit:cover;border:1px solid var(--line);cursor:zoom-in">`
    ).join('');

    const card = el(`
      <div class="card">
        <div style="display:flex;gap:10px;align-items:flex-start">
          <div style="flex:1;min-width:0">
            <h3 style="font-size:15.5px;line-height:1.3">${esc(task.title)}</h3>
            <p class="small muted" style="margin-top:5px">
              ${esc(task.finisher?.name || task.assignee?.name || 'Someone')} · finished ${esc(timeAgo(task.completed_at))}
              ${task.location ? ` · 📍 ${esc(task.location)}` : ''}
            </p>
          </div>
          <span class="chip ${task.photos?.length ? 'ok' : 'danger'}">📷 ${task.photos?.length || 0}</span>
        </div>
        ${task.notes ? `<p class="small mt" style="color:var(--ink-2);white-space:pre-wrap">${esc(task.notes)}</p>` : ''}
        <div style="display:flex;gap:6px;margin-top:11px;overflow-x:auto;padding-bottom:2px">${strip}</div>
        <div class="btn-row mt">
          <button class="btn ghost sm" data-open>Open</button>
          <button class="btn ghost sm" data-back>Send back</button>
          <button class="btn ok sm" data-ok>✓ Verify</button>
        </div>
      </div>`);

    card.querySelectorAll('img[data-path]').forEach((img, i) => {
      img.onclick = () => openLightbox(task.photos, i);
    });
    card.querySelector('[data-open]').onclick = () => openTaskSheet(task, { onChange: refresh });
    card.querySelector('[data-ok]').onclick = async (e) => {
      busy(e.currentTarget);
      try {
        await data.verifyTask(task.id);
        card.style.transition = 'opacity .2s ease';
        card.style.opacity = '0';
        setTimeout(refresh, 200);
        toast('Verified', 'ok');
      } catch (err) {
        toast(err.message, 'error');
        busy(e.currentTarget, false);
      }
    };
    card.querySelector('[data-back]').onclick = async (e) => {
      const note = await askNote('Send this task back', 'What needs fixing? The crew member will see this.');
      if (note === null) return;
      busy(e.currentTarget);
      try {
        await data.rejectTask(task.id, note);
        toast('Sent back to the crew');
        refresh();
      } catch (err) {
        toast(err.message, 'error');
        busy(e.currentTarget, false);
      }
    };

    hydrateThumbs(card);
    shell.appendChild(card);
  }

  const all = el('<button class="btn soft block mt-lg">✓ Verify everything above</button>');
  all.onclick = async () => {
    busy(all);
    try {
      for (const t of tasks) await data.verifyTask(t.id);
      toast(`Verified ${tasks.length} tasks`, 'ok');
      refresh();
    } catch (err) {
      toast(err.message, 'error');
      busy(all, false);
    }
  };
  shell.appendChild(all);
}
