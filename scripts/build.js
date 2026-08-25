#!/usr/bin/env node
'use strict';
/**
 * Builds the static site into public/ :
 *   - bundles src/main.js (Supabase client included) into a hashed asset
 *   - bakes the Supabase URL / anon key in from the environment
 *   - copies the shell, styles, manifest and icons
 *   - stamps the service worker with a version so updates roll out cleanly
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'public');
const watch = process.argv.includes('--watch');

/** Returns [value, nameItCameFrom] for the first variable that is actually set. */
const env = (...names) => {
  for (const n of names) {
    const value = (process.env[n] || '').trim();
    if (value) return [value, n];
  }
  return ['', ''];
};

// Vercel's Supabase integration injects several of these; a hand-typed .env
// usually has the bare names. Accept whichever showed up.
const [rawUrl, urlFrom] = env(
  'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'VITE_SUPABASE_URL',
  'PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_URL'
);
const [SUPABASE_ANON_KEY, keyFrom] = env(
  'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_PUBLISHABLE_DEFAULT_KEY', 'VITE_SUPABASE_ANON_KEY',
  'PUBLIC_SUPABASE_ANON_KEY', 'EXPO_PUBLIC_SUPABASE_ANON_KEY'
);
const SUPABASE_URL = rawUrl.replace(/\/+$/, '');
const [APP_NAME_ENV] = env('APP_NAME');
const [APP_SHORT_ENV] = env('APP_SHORT_NAME');
const APP_NAME = APP_NAME_ENV || "Mojo's Task Tracker";
const APP_SHORT_NAME = APP_SHORT_ENV || 'Tasks';

/** Says out loud what the build found, so a Vercel log answers "did it pick up
    my Supabase connection?" without anyone having to guess. */
function reportConfig() {
  const problems = [];
  if (!SUPABASE_URL) problems.push('no Supabase URL variable is set');
  else if (!/^https:\/\/[^/]+\.supabase\.(co|in|red)/.test(SUPABASE_URL)) {
    problems.push(`SUPABASE_URL does not look like a project URL: ${SUPABASE_URL.slice(0, 40)}` +
      (SUPABASE_URL.startsWith('postgres') ? ' (that is the database connection string, not the API URL)' : ''));
  }
  if (!SUPABASE_ANON_KEY) problems.push('no Supabase anon/publishable key variable is set');
  else if (SUPABASE_ANON_KEY.length < 30) problems.push('the Supabase key looks too short to be real');
  else if (/service_role/.test(SUPABASE_ANON_KEY) || SUPABASE_ANON_KEY.startsWith('sb_secret_')) {
    problems.push('that is the SERVICE ROLE key — use the anon / publishable key, never the secret one');
  }

  if (!problems.length) {
    console.log(`  Supabase: ${SUPABASE_URL} (from ${urlFrom} + ${keyFrom})`);
    return;
  }
  console.log('  ────────────────────────────────────────────────────────────');
  console.log('  Supabase connection NOT baked into this build:');
  for (const p of problems) console.log(`    · ${p}`);
  console.log('    The app will open a setup screen asking for the URL and key.');
  console.log('    Fix: set SUPABASE_URL and SUPABASE_ANON_KEY in Vercel, then redeploy.');
  console.log('  ────────────────────────────────────────────────────────────');
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else fs.copyFileSync(src, dest);
  }
}

async function build() {
  const started = Date.now();
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'assets'), { recursive: true });

  // 1. bundle
  const result = await esbuild.build({
    entryPoints: [path.join(SRC, 'main.js')],
    bundle: true,
    format: 'esm',
    target: ['es2020', 'safari14'],
    minify: true,
    sourcemap: true,
    write: false,
    outfile: path.join(OUT, 'assets', 'app.js'),
    legalComments: 'none',
    define: {
      __SUPABASE_URL__: JSON.stringify(SUPABASE_URL),
      __SUPABASE_ANON_KEY__: JSON.stringify(SUPABASE_ANON_KEY),
      __BUILD_ID__: JSON.stringify('BUILD_ID_PLACEHOLDER'),
      __APP_NAME__: JSON.stringify(APP_NAME),
    },
  });

  const jsFile = result.outputFiles.find((f) => f.path.endsWith('.js'));
  const mapFile = result.outputFiles.find((f) => f.path.endsWith('.map'));
  const hash = crypto.createHash('sha256').update(jsFile.contents).digest('hex').slice(0, 10);
  const bundleName = `app.${hash}.js`;

  const code = jsFile.text
    .replace(/BUILD_ID_PLACEHOLDER/g, hash)
    .replace(/\/\/# sourceMappingURL=.*$/m, `//# sourceMappingURL=/assets/${bundleName}.map`);
  fs.writeFileSync(path.join(OUT, 'assets', bundleName), code);
  if (mapFile) fs.writeFileSync(path.join(OUT, 'assets', `${bundleName}.map`), mapFile.text);

  // 2. static files
  fs.copyFileSync(path.join(SRC, 'styles.css'), path.join(OUT, 'styles.css'));
  const manifest = fs.readFileSync(path.join(SRC, 'manifest.webmanifest'), 'utf8')
    .replaceAll('__APP_NAME__', APP_NAME.replace(/"/g, '\\"'))
    .replaceAll('__APP_SHORT_NAME__', APP_SHORT_NAME.replace(/"/g, '\\"'));
  fs.writeFileSync(path.join(OUT, 'manifest.webmanifest'), manifest);
  copyDir(path.join(SRC, 'icons'), path.join(OUT, 'icons'));

  const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8')
    .replace('__BUNDLE__', `/assets/${bundleName}`)
    .replaceAll('__APP_NAME__', APP_NAME.replace(/[<>&]/g, ''))
    .replaceAll('__APP_SHORT_NAME__', APP_SHORT_NAME.replace(/[<>&]/g, ''));
  fs.writeFileSync(path.join(OUT, 'index.html'), html);

  // 3. service worker
  const shellAssets = ['/', '/index.html', '/styles.css', '/manifest.webmanifest',
    `/assets/${bundleName}`, '/icons/icon-192.png', '/icons/icon-512.png'];
  const sw = fs.readFileSync(path.join(SRC, 'sw.js'), 'utf8')
    .replace('__BUILD_ID__', hash)
    .replace('__SHELL_ASSETS__', JSON.stringify(shellAssets));
  fs.writeFileSync(path.join(OUT, 'sw.js'), sw);

  const size = (fs.statSync(path.join(OUT, 'assets', bundleName)).size / 1024).toFixed(0);
  console.log(`  built public/ in ${Date.now() - started}ms — assets/${bundleName} (${size} kB)`);
  reportConfig();
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});

if (watch) {
  let queued = null;
  fs.watch(SRC, { recursive: true }, () => {
    clearTimeout(queued);
    queued = setTimeout(() => build().catch(console.error), 120);
  });
  console.log('  watching src/ …');
}
