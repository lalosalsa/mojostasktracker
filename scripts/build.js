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

const env = (...names) => {
  for (const n of names) if (process.env[n]) return process.env[n].trim();
  return '';
};

const SUPABASE_URL = env('SUPABASE_URL', 'VITE_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'PUBLIC_SUPABASE_URL').replace(/\/+$/, '');
const APP_NAME = env('APP_NAME') || "Mojo's Task Tracker";
const APP_SHORT_NAME = env('APP_SHORT_NAME') || 'Tasks';
const SUPABASE_ANON_KEY = env(
  'SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'PUBLIC_SUPABASE_ANON_KEY'
);

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
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.log('  note: SUPABASE_URL / SUPABASE_ANON_KEY not set — the app will ask for them on first run.');
  }
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
