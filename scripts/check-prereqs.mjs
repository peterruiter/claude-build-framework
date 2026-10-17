#!/usr/bin/env node
// Checks that the tools a profile needs are installed, and says how to install the missing ones.
//
// Usage:
//   node scripts/check-prereqs.mjs [profile ...] [--json]
//
// Always checks the framework's own list (prerequisites.json at the repository root), then each
// named profile's profiles/<profile>/prerequisites.json. Exit code 1 when a required tool is missing
// or older than its minimum; optional tools only warn.
//
// A tool entry:
//   { "id", "name", "command", "args": [...], "pattern": "regex, version in group 1", "min": "x.y.z",
//     "required": true, "why": "...", "install": { "windows", "macos", "linux" }, "docs": "https://..." }
// The highest version found in stdout and stderr counts, so "dotnet --list-sdks" works.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const profiles = args.filter((arg) => !arg.startsWith('--'));

const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';

/** Reads one prerequisites file, or throws a clear error. */
export function readList(file) {
  if (!existsSync(file)) throw new Error(`No prerequisites file at ${file}`);
  const list = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(list.tools)) throw new Error(`${file} has no "tools" array`);
  return list;
}

/** Compares two dotted versions numerically: negative, zero or positive. */
export function compareVersions(a, b) {
  const left = String(a).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const right = String(b).split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** The highest version the pattern finds in the text, or null. */
export function highestVersion(text, pattern) {
  const expression = new RegExp(pattern ?? '(\\d+\\.\\d+(?:\\.\\d+)?)', 'g');
  let best = null;
  for (const match of text.matchAll(expression)) {
    const version = match[1];
    if (version && (best === null || compareVersions(version, best) > 0)) best = version;
  }
  return best;
}

/** Runs one tool's check and returns { tool, status: ok|old|missing|unknown, version }. */
export function checkTool(tool, run = runCommand) {
  const result = run(tool.command, tool.args ?? []);
  if (!result.found) return { tool, status: 'missing', version: null };
  const version = highestVersion(`${result.stdout}\n${result.stderr}`, tool.pattern);
  if (!version) return { tool, status: tool.min ? 'unknown' : 'ok', version: null };
  if (tool.min && compareVersions(version, tool.min) < 0) return { tool, status: 'old', version };
  return { tool, status: 'ok', version };
}

function runCommand(command, commandArgs) {
  // A shell finds .cmd/.ps1 shims on Windows (npm, pac, gh); arguments are fixed strings from the list.
  const options = { encoding: 'utf8', timeout: 30_000, windowsHide: true };
  const result = process.platform === 'win32'
    ? spawnSync([command, ...commandArgs.map(quote)].join(' '), { ...options, shell: true })
    : spawnSync(command, commandArgs, options);
  const notFound = result.error?.code === 'ENOENT'
    || (process.platform === 'win32' && result.status === 1 && /is not recognized as an internal or external command/i.test(result.stderr ?? ''))
    || (process.platform !== 'win32' && result.status === 127);
  return { found: !notFound && !result.error, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function quote(arg) {
  // cmd.exe: quote anything with spaces or shell characters; the lists hold fixed, trusted strings.
  return /[\s"&|<>^()]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

function main() {
  const lists = [readList(join(root, 'prerequisites.json'))];
  for (const profile of profiles) lists.push(readList(join(root, 'profiles', profile, 'prerequisites.json')));

  const seen = new Set();
  const results = [];
  for (const list of lists) {
    for (const tool of list.tools) {
      if (seen.has(tool.id)) continue;
      seen.add(tool.id);
      results.push({ ...checkTool(tool), from: list.profile ?? 'framework' });
    }
  }

  const blocking = results.filter((r) => r.tool.required !== false && (r.status === 'missing' || r.status === 'old'));

  if (asJson) {
    console.log(JSON.stringify(results.map((r) => ({ id: r.tool.id, name: r.tool.name, from: r.from, status: r.status, version: r.version, min: r.tool.min ?? null, required: r.tool.required !== false, install: r.tool.install?.[platform] ?? null, docs: r.tool.docs ?? null })), null, 2));
  } else {
    const mark = { ok: 'ok     ', old: 'TOO OLD', missing: 'MISSING', unknown: 'CHECK  ' };
    console.log(`Prerequisites for ${['framework', ...profiles].join(' + ')} (${platform})\n`);
    for (const r of results) {
      const optional = r.tool.required === false ? ' (optional)' : '';
      const version = r.version ? ` ${r.version}` : '';
      const min = r.tool.min ? `, needs ${r.tool.min}+` : '';
      console.log(`  ${mark[r.status]} ${r.tool.name}${version}${min}${optional}`);
    }
    const toFix = results.filter((r) => r.status !== 'ok');
    if (toFix.length) {
      console.log('\nTo install or update:');
      for (const r of toFix) {
        console.log(`\n  ${r.tool.name}: ${r.tool.why ?? ''}`.trimEnd());
        console.log(`    ${r.tool.install?.[platform] ?? 'see the docs link'}`);
        if (r.tool.docs) console.log(`    ${r.tool.docs}`);
        if (r.status === 'unknown') console.log('    (installed, but its version could not be read: check it is recent enough)');
      }
      console.log('\nOpen a new terminal after installing, so the PATH is picked up, and run this check again.');
    } else {
      console.log('\nEverything is installed.');
    }
  }
  process.exitCode = blocking.length ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
