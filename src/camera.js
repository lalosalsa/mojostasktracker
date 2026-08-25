/* Client-side photo pipeline: downscale + JPEG-compress before upload so a
   12 MP phone photo becomes ~300-800 KB, and generate a small thumbnail. */

const MAX_EDGE = 1800;
const THUMB_EDGE = 320;

async function decode(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file); } catch { /* HEIC on some browsers */ }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable image')); };
    img.src = url;
  });
}

function draw(source, maxEdge, quality) {
  const w = source.width || source.naturalWidth;
  const h = source.height || source.naturalHeight;
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/**
 * Returns { photo, thumb, width, height }. Falls back to the original file
 * when decoding fails (e.g. HEIC in an old browser) — the server still
 * validates it by magic bytes.
 */
export async function preparePhoto(file) {
  try {
    const source = await decode(file);
    const photo = await draw(source, MAX_EDGE, 0.82);
    const thumb = await draw(source, THUMB_EDGE, 0.7);
    const width = source.width || source.naturalWidth;
    const height = source.height || source.naturalHeight;
    source.close?.();
    if (photo && photo.size > 0) return { photo, thumb, width, height };
  } catch { /* fall through */ }
  return { photo: file, thumb: null, width: null, height: null };
}

/** Best-effort location tag; resolves null quickly if denied/unavailable. */
export function grabLocation(timeoutMs = 3500) {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null);
    const timer = setTimeout(() => resolve(null), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (pos) => { clearTimeout(timer); resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }); },
      () => { clearTimeout(timer); resolve(null); },
      { maximumAge: 300000, timeout: timeoutMs, enableHighAccuracy: false }
    );
  });
}
