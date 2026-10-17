#!/usr/bin/env node
// ===========================================================================
// Tags What's new entries with the release they shipped in.
//
//   node scripts/release-tag.mjs --release 0.4.0 --from 181 --to 184 [--date 2026-10-17]
//   node scripts/release-tag.mjs --release 0.4.0 --ids 181,183
//   node scripts/release-tag.mjs --release 0.4.0 --untagged
//       [--force] [--dry-run] [--file build/contracts/changelog.json]
//
// Sets "release" (and "date", with --date) on the chosen entries. Edits only
// those values in place, so the rest of the file keeps its formatting. Refuses
// an entry that already has a different release unless --force, an id that is
// not in the file, and a release that does not match framework.json's
// releasePattern. Node's own modules only.
// ===========================================================================
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

const argv = process.argv.slice(2);
const option = (name) => { const at = argv.indexOf(`--${name}`); return at >= 0 && !argv[at + 1]?.startsWith('--') ? argv[at + 1] : undefined; };
const flag = (name) => argv.includes(`--${name}`);
const fail = (message) => { console.error(`release-tag: ${message}`); process.exit(1); };

function findConfig(start) {
  let folder = resolve(start);
  for (;;) {
    const candidate = join(folder, 'build', 'framework.json');
    if (existsSync(candidate)) return candidate;
    const up = dirname(folder);
    if (up === folder) return null;
    folder = up;
  }
}

const configPath = findConfig(process.cwd());
const config = configPath ? JSON.parse(readFileSync(configPath, 'utf8')) : {};
const root = configPath ? resolve(dirname(configPath), config.root ?? '..') : process.cwd();
const file = resolve(option('file') ?? resolve(root, config.changelog ?? 'build/contracts/changelog.json'));
if (!existsSync(file)) fail(`no changelog at ${file}`);

const release = option('release');
if (!release) fail('--release <version> is required');
const pattern = new RegExp(config.releasePattern ?? '^\\d+\\.\\d+\\.\\d+(?:[-+][0-9A-Za-z.-]+)?$');
if (!pattern.test(release)) fail(`'${release}' does not match the release pattern ${pattern}`);
const date = option('date') === 'today' ? new Date().toISOString().slice(0, 10) : option('date');
if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(`--date must be yyyy-MM-dd or 'today', not '${date}'`);

let text = readFileSync(file, 'utf8');
const changelog = JSON.parse(text);
const entries = changelog.entries ?? [];

let ids;
if (flag('untagged')) ids = entries.filter((entry) => entry.release === null).map((entry) => entry.id);
else if (option('ids')) ids = option('ids').split(',').map((id) => Number(id.trim()));
else if (option('from') && option('to')) {
  const from = Number(option('from'));
  const to = Number(option('to'));
  if (!(from <= to)) fail('--from must not be greater than --to');
  ids = Array.from({ length: to - from + 1 }, (_, index) => from + index);
} else fail('choose entries with --from and --to, --ids, or --untagged');

if (ids.length === 0) { console.log('release-tag: nothing to tag'); process.exit(0); }
const byId = new Map(entries.map((entry) => [entry.id, entry]));
const absent = ids.filter((id) => !byId.has(id));
if (absent.length) fail(`not in the changelog: ${absent.join(', ')}`);
const clash = ids.filter((id) => byId.get(id).release !== null && byId.get(id).release !== release);
if (clash.length && !flag('force')) fail(`already tagged with another release: ${clash.map((id) => `${id} (${byId.get(id).release})`).join(', ')}; pass --force to retag`);

// Edit in place: find each entry's "id": N, then its "release" (and "date") before the next "id".
for (const id of ids) {
  const start = new RegExp(`"id"\\s*:\\s*${id}\\s*[,}]`).exec(text);
  if (!start) fail(`could not find entry ${id} in the text`);
  const next = text.slice(start.index + start[0].length).search(/"id"\s*:/);
  const end = next < 0 ? text.length : start.index + start[0].length + next;
  let part = text.slice(start.index, end);
  if (!/"release"\s*:\s*(null|"[^"]*")/.test(part)) fail(`entry ${id} has no "release" field`);
  part = part.replace(/"release"\s*:\s*(null|"[^"]*")/, `"release": ${JSON.stringify(release)}`);
  if (date) part = part.replace(/"date"\s*:\s*"[^"]*"/, `"date": ${JSON.stringify(date)}`);
  text = text.slice(0, start.index) + part + text.slice(end);
}

// The result must still be the same file with only those values changed.
const after = JSON.parse(text);
for (const entry of after.entries) {
  const before = byId.get(entry.id);
  const tagged = ids.includes(entry.id);
  if (tagged && entry.release !== release) fail(`entry ${entry.id} did not take the release; nothing written`);
  if (!tagged && entry.release !== before.release) fail(`entry ${entry.id} changed by accident; nothing written`);
}

if (flag('dry-run')) console.log(`release-tag: would tag ${ids.length} entr${ids.length === 1 ? 'y' : 'ies'} (${ids.join(', ')}) with ${release}${date ? ` dated ${date}` : ''}`);
else {
  writeFileSync(file, text);
  console.log(`release-tag: tagged ${ids.length} entr${ids.length === 1 ? 'y' : 'ies'} (${ids.join(', ')}) with ${release}${date ? ` dated ${date}` : ''}`);
}
