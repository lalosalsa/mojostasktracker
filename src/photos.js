/* Photo proof: capture → shrink → upload → gallery → full-screen viewer. */

import { el, esc, toast, confirmSheet, fmtTime } from './ui.js';
import { preparePhoto, grabLocation } from './camera.js';
import { signedUrls, uploadPhoto, deletePhoto } from './data.js';
import { setState, state } from './store.js';

/** Full-screen viewer with swipe/arrow navigation. */
export async function openLightbox(photos, startIndex = 0) {
  let index = startIndex;
  const urls = await signedUrls(photos.map((p) => p.storage_path));

  const box = el(`
    <div class="lightbox">
      <div class="lb-top">
        <button class="icon-btn" data-close aria-label="Close">✕</button>
        <span class="spacer"></span>
        <span class="small" data-counter style="color:#cbd5e1"></span>
        <a class="icon-btn" data-download download title="Save photo">⬇</a>
      </div>
      <img alt="Task photo" data-img>
      <div class="lb-foot" data-caption></div>
    </div>`);

  const img = box.querySelector('[data-img]');
  const counter = box.querySelector('[data-counter]');
  const caption = box.querySelector('[data-caption]');
  const download = box.querySelector('[data-download]');

  const show = () => {
    const p = photos[index];
    img.src = urls[p.storage_path] || '';
    download.href = urls[p.storage_path] || '#';
    counter.textContent = `${index + 1} / ${photos.length}`;
    const bits = [];
    if (p.caption) bits.push(esc(p.caption));
    bits.push(`Taken ${fmtTime(p.created_at)}`);
    if (p.latitude) bits.push(`📍 ${p.latitude.toFixed(4)}, ${p.longitude.toFixed(4)}`);
    caption.innerHTML = bits.join(' · ');
  };

  const step = (delta) => {
    index = (index + delta + photos.length) % photos.length;
    show();
  };

  const onKey = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowRight') step(1);
    if (e.key === 'ArrowLeft') step(-1);
  };
  const close = () => {
    box.remove();
    document.removeEventListener('keydown', onKey);
    document.body.style.overflow = '';
  };

  let touchX = 0;
  img.addEventListener('touchstart', (e) => { touchX = e.changedTouches[0].clientX; }, { passive: true });
  img.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
  }, { passive: true });
  box.querySelector('[data-close]').onclick = close;
  document.addEventListener('keydown', onKey);

  document.body.style.overflow = 'hidden';
  document.getElementById('modal-root').appendChild(box);
  show();
}

/** Resolves signed URLs into every <img data-path> inside a container. */
export async function hydrateThumbs(container) {
  const nodes = [...container.querySelectorAll('img[data-path]')].filter((n) => !n.src);
  if (!nodes.length) return;
  const urls = await signedUrls(nodes.map((n) => n.dataset.path));
  for (const node of nodes) {
    const url = urls[node.dataset.path];
    if (url) node.src = url;
  }
}

/**
 * Uploads picked files one by one, showing a placeholder tile for each.
 * Returns the photo rows that made it.
 */
export async function uploadFiles(task, files, { onProgress, gridEl } = {}) {
  const list = [...files].slice(0, 12);
  if (!list.length) return [];
  const location = await grabLocation();
  const done = [];

  setState({ pendingUploads: state.pendingUploads + list.length });
  try {
    for (let i = 0; i < list.length; i += 1) {
      const file = list[i];
      let placeholder = null;
      if (gridEl) {
        placeholder = el(`<div class="shot"><div class="pending">Uploading…</div></div>`);
        gridEl.prepend(placeholder);
      }
      try {
        if (!file.type.startsWith('image/') && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) {
          throw new Error('That file is not a photo.');
        }
        const prepared = await preparePhoto(file);
        const row = await uploadPhoto(task, { ...prepared, location });
        done.push(row);
        onProgress?.(i + 1, list.length, row);
      } catch (err) {
        toast(err.message || 'Upload failed', 'error');
      } finally {
        placeholder?.remove();
        setState({ pendingUploads: Math.max(0, state.pendingUploads - 1) });
      }
    }
  } finally {
    if (state.pendingUploads < 0) setState({ pendingUploads: 0 });
  }
  return done;
}

/** Hidden file input wired for the phone camera. */
export function pickPhotos({ camera = true } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    if (camera) input.setAttribute('capture', 'environment');
    input.style.display = 'none';
    input.onchange = () => {
      resolve([...(input.files || [])]);
      input.remove();
    };
    document.body.appendChild(input);
    input.click();
  });
}

/** Grid of a task's photos, optionally with add/remove controls. */
export function photoGrid(task, { editable = false, onChange } = {}) {
  const wrap = el('<div class="gallery"></div>');

  const render = () => {
    wrap.innerHTML = '';
    for (const p of task.photos || []) {
      const tile = el(`
        <div class="shot">
          <img data-path="${esc(p.thumb_path || p.storage_path)}" alt="${esc(p.caption || 'Task photo')}" loading="lazy">
          ${editable ? '<button class="rm" title="Remove photo">✕</button>' : ''}
        </div>`);
      tile.querySelector('img').onclick = () => openLightbox(task.photos, task.photos.indexOf(p));
      tile.querySelector('.rm')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const yes = await confirmSheet({
          title: 'Remove this photo?',
          message: 'It will be deleted from the task for good.',
          confirmLabel: 'Remove',
          danger: true,
        });
        if (!yes) return;
        try {
          await deletePhoto(p);
          task.photos = task.photos.filter((x) => x.id !== p.id);
          task.photoCount = task.photos.length;
          render();
          onChange?.(task);
          toast('Photo removed');
        } catch (err) {
          toast(err.message, 'error');
        }
      });
      wrap.appendChild(tile);
    }

    if (editable) {
      const camera = el(`<button class="add-shot"><span class="ic">📷</span><span>Take photo</span></button>`);
      camera.onclick = async () => {
        const files = await pickPhotos({ camera: true });
        const added = await uploadFiles(task, files, { gridEl: wrap });
        if (added.length) {
          task.photos = [...(task.photos || []), ...added];
          task.photoCount = task.photos.length;
          if (task.status === 'open') task.status = 'in_progress';
          render();
          onChange?.(task);
        }
      };
      const library = el(`<button class="add-shot"><span class="ic">🖼️</span><span>From gallery</span></button>`);
      library.onclick = async () => {
        const files = await pickPhotos({ camera: false });
        const added = await uploadFiles(task, files, { gridEl: wrap });
        if (added.length) {
          task.photos = [...(task.photos || []), ...added];
          task.photoCount = task.photos.length;
          if (task.status === 'open') task.status = 'in_progress';
          render();
          onChange?.(task);
        }
      };
      wrap.append(camera, library);
    }
    hydrateThumbs(wrap);
  };

  render();
  wrap.refresh = render;
  return wrap;
}
