#!/usr/bin/env node
/**
 * One-off ops tool: purge the ORPHANED attendance selfie blobs from Supabase Storage.
 *
 * Context (Owner-authorised data reset, 2026-09-07): the attendance/payroll wipe deleted every
 * attendance_record row and every attachment row, but the image BLOBS stayed in the
 * `attachments` bucket under `attendance_record/`. A DB trigger (storage.protect_delete)
 * deliberately blocks deleting storage.objects via SQL, so the blobs must go through the
 * Storage API — which is what this script does.
 *
 * SAFETY DESIGN — read before running:
 *   - DRY RUN BY DEFAULT. It prints what it would delete and exits. Pass --confirm to delete.
 *   - HARD PREFIX GUARD. It refuses to delete any object whose path does not start with
 *     `attendance_record/`. The `captures/` folder (857 live files, still referenced by
 *     capture_records.screenshot_path and capture_review_queue.screenshot_path) can never be
 *     touched by this script, even if the listing returns it.
 *   - The service-role key is read from the environment. It is NEVER written to disk, logged,
 *     or printed by this script.
 *
 * USAGE (PowerShell) — set the two vars in YOUR shell, then run:
 *   $env:SUPABASE_URL = "https://eqfddwxsmzzojuasffjx.supabase.co"
 *   $env:SUPABASE_SERVICE_ROLE_KEY = "<paste your service_role key>"
 *   node scripts/purge-attendance-selfies.mjs             # dry run
 *   node scripts/purge-attendance-selfies.mjs --confirm   # actually delete
 *
 * Get the key from: Supabase Dashboard -> Project Settings -> API -> service_role.
 * Close/clear the shell afterwards so the key does not linger in your session history.
 */

import { createClient } from '@supabase/supabase-js';

const BUCKET = 'attachments';
const PREFIX = 'attendance_record';
const CONFIRM = process.argv.includes('--confirm');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('ERROR: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your environment first.');
  console.error('See the usage block at the top of this file.');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

/** List every object under `attendance_record/<folder>/`, paging through each folder. */
async function collectPaths() {
  const paths = [];

  const { data: folders, error: folderErr } = await supabase.storage
    .from(BUCKET)
    .list(PREFIX, { limit: 1000 });

  if (folderErr) throw new Error(`listing ${PREFIX}: ${folderErr.message}`);

  for (const folder of folders ?? []) {
    // A "folder" entry has no id; real files have one. Skip stray files at this level.
    if (folder.id) {
      paths.push(`${PREFIX}/${folder.name}`);
      continue;
    }
    const { data: files, error } = await supabase.storage
      .from(BUCKET)
      .list(`${PREFIX}/${folder.name}`, { limit: 1000 });
    if (error) throw new Error(`listing ${PREFIX}/${folder.name}: ${error.message}`);
    for (const f of files ?? []) paths.push(`${PREFIX}/${folder.name}/${f.name}`);
  }

  return paths;
}

const all = await collectPaths();

// HARD GUARD: nothing outside the attendance_record/ prefix may ever be deleted.
const safe = all.filter((p) => p.startsWith(`${PREFIX}/`));
const rejected = all.filter((p) => !p.startsWith(`${PREFIX}/`));

if (rejected.length) {
  console.error(`REFUSING TO RUN: ${rejected.length} path(s) outside "${PREFIX}/" appeared:`);
  for (const r of rejected.slice(0, 10)) console.error(`  ${r}`);
  process.exit(1);
}

console.log(`Bucket:  ${BUCKET}`);
console.log(`Prefix:  ${PREFIX}/`);
console.log(`Found:   ${safe.length} file(s)`);

if (!CONFIRM) {
  console.log('\n--- DRY RUN (nothing deleted) ---');
  for (const p of safe.slice(0, 10)) console.log(`  would delete: ${p}`);
  if (safe.length > 10) console.log(`  ... and ${safe.length - 10} more`);
  console.log('\nRe-run with --confirm to delete these permanently.');
  process.exit(0);
}

// Delete in batches; the API accepts an array of paths.
let deleted = 0;
const BATCH = 100;
for (let i = 0; i < safe.length; i += BATCH) {
  const chunk = safe.slice(i, i + BATCH);
  const { data, error } = await supabase.storage.from(BUCKET).remove(chunk);
  if (error) {
    console.error(`FAILED on batch starting ${i}: ${error.message}`);
    process.exit(1);
  }
  deleted += data?.length ?? chunk.length;
  console.log(`  deleted ${deleted}/${safe.length}`);
}

const { data: leftover } = await supabase.storage.from(BUCKET).list(PREFIX, { limit: 1000 });
console.log(`\nDONE. Deleted ${deleted} file(s). Remaining entries under ${PREFIX}/: ${leftover?.length ?? 0}`);
