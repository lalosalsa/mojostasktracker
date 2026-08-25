/* The task detail sheet — the screen an employee spends most of their day in. */

import { el, esc, sheet, toast, busy, confirmSheet, fmtDate, fmtTime, timeAgo,
         STATUS_LABELS, STATUS_CHIP, PRIORITY_CHIP } from '../ui.js';
import { photoGrid } from '../photos.js';
import * as data from '../data.js';
import { isAdmin, state } from '../store.js';

export function statusChip(task) {
  return `<span class="chip ${STATUS_CHIP[task.status] || ''}">${esc(STATUS_LABELS[task.status] || task.status)}</span>`;
}

export function openTaskSheet(task, { onChange } = {}) {
  const admin = isAdmin();
  const mine = task.assigned_to === state.profile?.id || task.assigned_to == null;
  const editable = (admin || mine) && task.status !== 'verified';

  const body = el('<div></div>');
  const foot = el('<div style="display:flex;gap:10px;width:100%"></div>');
  const s = sheet({ title: task.title, body, footer: foot });

  const rerender = () => {
    body.innerHTML = '';

    /* ---- summary ---- */
    const meta = [
      statusChip(task),
      task.priority !== 'normal'
        ? `<span class="chip ${PRIORITY_CHIP[task.priority]}">${esc(task.priority)}</span>` : '',
      task.location ? `<span class="chip">📍 ${esc(task.location)}</span>` : '',
      `<span class="chip">${esc(fmtDate(task.work_date))}</span>`,
      task.requires_photo ? '<span class="chip info">📷 photo required</span>' : '',
    ].filter(Boolean).join('');

    body.appendChild(el(`
      <div class="card">
        <div class="meta" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">${meta}</div>
        ${task.description ? `<p class="mt small" style="color:var(--ink-2);line-height:1.55;white-space:pre-wrap">${esc(task.description)}</p>` : ''}
        <p class="small muted mt">
          ${task.assignee ? `Assigned to ${esc(task.assignee.full_name || task.assignee.email)}` : 'Unassigned — anyone can pick this up'}
        </p>
      </div>`));

    if (task.status === 'rejected' && task.review_note) {
      body.appendChild(el(`
        <div class="banner danger mt">
          <span class="ic">↩︎</span>
          <div><strong>Sent back by your manager</strong><br>${esc(task.review_note)}</div>
        </div>`));
    }
    if (task.status === 'verified') {
      body.appendChild(el(`
        <div class="banner ok mt">
          <span class="ic">✓</span>
          <div><strong>Signed off${task.reviewer ? ` by ${esc(task.reviewer.full_name)}` : ''}</strong>
          ${task.review_note ? `<br>${esc(task.review_note)}` : ''}</div>
        </div>`));
    }

    /* ---- photos ---- */
    const photoCard = el(`
      <div class="card mt">
        <div class="section-head" style="margin-bottom:8px">
          <h2>Photo proof</h2>
          <span class="count">${task.photos?.length || 0}</span>
          <span class="spacer"></span>
        </div>
      </div>`);
    photoCard.appendChild(
      photoGrid(task, {
        editable,
        onChange: (t) => { onChange?.(t); rerender(); },
      })
    );
    if (!task.photos?.length && !editable) {
      photoCard.appendChild(el('<p class="small muted mt">No photos attached.</p>'));
    }
    body.appendChild(photoCard);

    /* ---- notes ---- */
    if (editable) {
      const notes = el(`
        <div class="card mt">
          <div class="field" style="margin-bottom:0">
            <label for="task-notes">Notes for your manager</label>
            <textarea class="textarea" id="task-notes" placeholder="Anything worth flagging — parts used, problems found, follow-up needed…">${esc(task.notes || '')}</textarea>
            <div class="hint">Saved when you mark the task done.</div>
          </div>
        </div>`);
      body.appendChild(notes);
    } else if (task.notes) {
      body.appendChild(el(`
        <div class="card mt">
          <h2 style="font-size:14px">Notes</h2>
          <p class="small mt" style="color:var(--ink-2);white-space:pre-wrap">${esc(task.notes)}</p>
        </div>`));
    }

    /* ---- timeline ---- */
    const stamps = [
      ['Created', task.created_at],
      ['Started', task.started_at],
      ['Marked done', task.completed_at],
      ['Reviewed', task.reviewed_at],
    ].filter(([, v]) => v);
    body.appendChild(el(`
      <div class="card mt">
        <h2 style="font-size:14px">Timeline</h2>
        <ul class="timeline mt">
          ${stamps.map(([k, v]) => `<li><span class="dot"></span><div>${k}<div class="when">${esc(fmtTime(v))} · ${esc(timeAgo(v))}</div></div></li>`).join('')}
        </ul>
      </div>`));

    /* ---- actions ---- */
    foot.innerHTML = '';
    const notesValue = () => body.querySelector('#task-notes')?.value || '';

    const act = async (btn, fn, okMessage) => {
      busy(btn);
      try {
        const updated = await fn();
        if (updated) Object.assign(task, updated);
        onChange?.(task);
        if (okMessage) toast(okMessage, 'ok');
        rerender();
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        busy(btn, false);
      }
    };

    if (mine && !admin) {
      if (task.status === 'open') {
        const start = el('<button class="btn ghost" style="flex:1">Start</button>');
        start.onclick = () => act(start, () => data.startTask(task.id));
        foot.appendChild(start);
      }
      if (['open', 'in_progress', 'rejected'].includes(task.status)) {
        const done = el('<button class="btn ok" style="flex:2">✓ Mark done</button>');
        done.onclick = () => act(
          done,
          () => data.completeTask(task.id, { notes: notesValue() }),
          'Sent to your manager for review'
        );
        foot.appendChild(done);
      }
      if (task.status === 'submitted') {
        const undo = el('<button class="btn ghost" style="flex:1">Undo — still working</button>');
        undo.onclick = () => act(undo, () => data.reopenTask(task.id));
        foot.appendChild(undo);
      }
    }

    if (admin) {
      if (task.status === 'submitted') {
        const back = el('<button class="btn ghost" style="flex:1">Send back</button>');
        back.onclick = async () => {
          const note = await askNote('Send this task back', 'What needs fixing?');
          if (note === null) return;
          act(back, () => data.rejectTask(task.id, note), 'Sent back to the crew');
        };
        const ok = el('<button class="btn ok" style="flex:1">✓ Verify</button>');
        ok.onclick = () => act(ok, () => data.verifyTask(task.id), 'Verified');
        foot.append(back, ok);
      } else if (task.status === 'verified') {
        const reopen = el('<button class="btn ghost" style="flex:1">Reopen</button>');
        reopen.onclick = () => act(reopen, () => data.reopenTask(task.id));
        foot.appendChild(reopen);
      } else {
        const done = el('<button class="btn ok" style="flex:1">Mark done</button>');
        done.onclick = () => act(done, () => data.completeTask(task.id, { notes: notesValue() }), 'Marked done');
        foot.appendChild(done);
      }
      const del = el('<button class="btn ghost" style="flex:0 0 52px" title="Delete task">🗑</button>');
      del.onclick = async () => {
        const yes = await confirmSheet({
          title: 'Delete this task?',
          message: 'The task and its photos are removed for good.',
          confirmLabel: 'Delete',
          danger: true,
        });
        if (!yes) return;
        busy(del);
        try {
          await data.deleteTask(task.id);
          onChange?.({ ...task, deleted: true });
          s.close();
          toast('Task deleted');
        } catch (err) {
          toast(err.message, 'error');
          busy(del, false);
        }
      };
      foot.appendChild(del);
    }

    if (!foot.children.length) {
      foot.appendChild(el('<button class="btn ghost" style="flex:1" data-close>Close</button>'));
    }
  };

  rerender();
  return s;
}

/** Small prompt sheet that returns the typed text, or null if cancelled. */
export function askNote(title, placeholder, initial = '') {
  return new Promise((resolve) => {
    let settled = false;
    const body = el(`
      <div class="field" style="margin-bottom:0">
        <textarea class="textarea" placeholder="${esc(placeholder)}">${esc(initial)}</textarea>
      </div>`);
    const foot = el(`<div style="display:flex;gap:10px;width:100%">
      <button class="btn ghost" style="flex:1" data-no>Cancel</button>
      <button class="btn" style="flex:1" data-yes>Send</button>
    </div>`);
    const s = sheet({
      title,
      body,
      footer: foot,
      onClose: () => { if (!settled) { settled = true; resolve(null); } },
    });
    setTimeout(() => body.querySelector('textarea').focus(), 80);
    foot.querySelector('[data-no]').onclick = () => { settled = true; s.close(); resolve(null); };
    foot.querySelector('[data-yes]').onclick = () => {
      settled = true;
      const value = body.querySelector('textarea').value.trim();
      s.close();
      resolve(value);
    };
  });
}
