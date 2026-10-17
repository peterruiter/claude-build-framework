#!/usr/bin/env node
// Fails when a control changed since the base (a branch or tag) but its version did not go up,
// or when any control changed and the solution version did not. Without this an import
// succeeds and the environment keeps serving the old bundle.
// A change under shared/ counts as a change to every control; tests do not count.
// Usage: node scripts/check-version-bump.mjs --base origin/main
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { controlsRoot, findControls, readManifest } from './lib.mjs';

const index = process.argv.indexOf('--base');
const base = index > 0 ? process.argv[index + 1] : 'origin/main';
const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: controlsRoot, encoding: 'utf8' }).trim();
// Paths below are relative to the repository root, so git runs there.
const git = (...args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
const fromRepo = (path) => relative(repoRoot, path).replaceAll('\\', '/');
const changed = (path) => git('diff', '--name-only', `${base}...HEAD`, '--', fromRepo(path)).split('\n').filter(Boolean);
const atBase = (path) => {
  try {
    return git('show', `${base}:${fromRepo(path)}`);
  } catch {
    return null;
  }
};
const greater = (a, b) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return false;
};

const sharedChanged = changed(join(controlsRoot, 'shared')).length > 0;
const problems = [];
let anyChanged = false;
for (const folder of findControls()) {
  const manifest = readManifest(folder);
  // The project folder: the control, its strings and its package.json.
  if (!sharedChanged && changed(dirname(folder)).length === 0) continue;
  anyChanged = true;
  const before = atBase(manifest.path);
  if (before === null) {
    console.log(`  new control ${manifest.constructor} ${manifest.version}`);
    continue;
  }
  const old = /<control\b[^>]*\bversion="([^"]+)"/.exec(before)?.[1] ?? '0.0.0';
  if (greater(manifest.version, old)) console.log(`  ✓ ${manifest.constructor}: ${old} -> ${manifest.version}`);
  else problems.push(`${manifest.constructor} changed since ${base} but its version is still ${manifest.version} (npm run version:bump)`);
}

const solutionXml = join(controlsRoot, '..', 'solution', 'src', 'Other', 'Solution.xml');
if (anyChanged) {
  const now = /<Version>([^<]+)<\/Version>/.exec(readFileSync(solutionXml, 'utf8'))?.[1] ?? '0';
  const before = atBase(solutionXml);
  const old = before ? /<Version>([^<]+)<\/Version>/.exec(before)?.[1] : null;
  if (old && !greater(now, old)) problems.push(`controls changed since ${base} but the solution version is still ${now}`);
  else if (old) console.log(`  ✓ solution: ${old} -> ${now}`);
}

for (const problem of problems) console.error(`  ✗ ${problem}`);
if (problems.length) process.exit(1);
console.log(anyChanged ? 'Versions: raised where needed. OK' : `Versions: no control changed since ${base}. OK`);
