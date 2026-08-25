/* Service worker: makes the installed app open instantly and survive a dead
   signal. Supabase traffic always goes to the network — never cached. */

const VERSION = '__BUILD_ID__';
const SHELL_CACHE = `shell-${VERSION}`;
const RUNTIME_CACHE = `runtime-${VERSION}`;
const SHELL_ASSETS = __SHELL_ASSETS__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Anything that isn't our own origin (Supabase REST, auth, storage) stays live.
  if (url.origin !== self.location.origin) return;

  // App shell: serve the cached page instantly, refresh it in the background.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((c) => c.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html').then((hit) => hit || offlinePage()))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request)
        .then((response) => {
          if (response.ok && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/'))) {
            const copy = response.clone();
            caches.open(RUNTIME_CACHE).then((c) => c.put(request, copy));
          }
          return response;
        })
        .catch(() => hit);
    })
  );
});

function offlinePage() {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
     <style>body{font-family:-apple-system,system-ui,sans-serif;display:grid;place-items:center;height:100dvh;margin:0;
     background:#f4f6fb;color:#0b1220;text-align:center;padding:24px}p{color:#64748b}</style>
     <div><h2>You're offline</h2><p>Reconnect and this screen will load again.</p></div>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}
