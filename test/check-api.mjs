/**
 * Catches drift between the app and the schema: every table the client reads
 * and every RPC it calls has to exist in supabase/schema.sql.
 */
import fs from 'node:fs';
import path from 'node:path';

const schema = fs.readFileSync('supabase/schema.sql', 'utf8');
const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) files.push(full);
  }
})('src');

const tables = new Set();
const rpcs = new Set();
for (const file of files) {
  const code = fs.readFileSync(file, 'utf8');
  for (const m of code.matchAll(/\.from\(\s*['"]([a-z_]+)['"]/g)) tables.add(m[1]);
  for (const m of code.matchAll(/\.rpc\(\s*['"]([a-z_]+)['"]/g)) rpcs.add(m[1]);
}

const STORAGE_BUCKETS = new Set(['task-photos']);
const problems = [];

for (const table of tables) {
  if (STORAGE_BUCKETS.has(table)) continue;
  if (!new RegExp(`create table if not exists public\\.${table}\\b`).test(schema)) {
    problems.push(`table "${table}" is used by the app but not in the schema`);
  }
}
for (const rpc of rpcs) {
  if (!new RegExp(`create or replace function public\\.${rpc}\\s*\\(`).test(schema)) {
    problems.push(`rpc "${rpc}" is called by the app but not in the schema`);
  }
  if (!new RegExp(`grant execute on function public\\.${rpc}\\s*\\(`).test(schema)) {
    problems.push(`rpc "${rpc}" exists but is never granted to authenticated`);
  }
}

console.log(`  tables used: ${[...tables].sort().join(', ')}`);
console.log(`  rpcs called: ${[...rpcs].sort().join(', ')}`);
if (problems.length) {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  process.exit(1);
}
console.log('\n  every table and RPC the app uses exists and is granted\n');
