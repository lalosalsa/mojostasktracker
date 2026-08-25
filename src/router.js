/* Hash routing keeps deep links working from a home-screen shortcut without
   any server rewrites. */

const routes = new Map();
let notFound = null;
let current = null;

export function route(pattern, handler) {
  routes.set(pattern, handler);
}

export function setNotFound(handler) {
  notFound = handler;
}

export function parse() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, query] = raw.split('?');
  return {
    path: path.replace(/\/+$/, '') || '/',
    params: Object.fromEntries(new URLSearchParams(query || '')),
  };
}

export function navigate(path, { replace = false } = {}) {
  const target = `#${path}`;
  if (location.hash === target) return resolve();
  if (replace) history.replaceState(null, '', target);
  else location.hash = target;
}

export function currentPath() {
  return current;
}

export async function resolve() {
  const { path, params } = parse();
  current = path;

  for (const [pattern, handler] of routes) {
    const keys = [];
    const regex = new RegExp(
      `^${pattern.replace(/:([A-Za-z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`
    );
    const match = path.match(regex);
    if (match) {
      const args = Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(match[i + 1])]));
      return handler({ ...args, ...params });
    }
  }
  return notFound?.({ path });
}

export function startRouter() {
  window.addEventListener('hashchange', resolve);
  return resolve();
}
