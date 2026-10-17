// Shared helpers for the framework's self-test. Node's own modules only.
import { readFileSync, readdirSync, statSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const skip = new Set(['.git', 'node_modules', 'out', '.playwright-mcp']);

/** Every file under a folder, as absolute paths. */
export function walk(folder) {
  return readdirSync(folder).flatMap((name) => {
    if (skip.has(name)) return [];
    const path = join(folder, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

export const rel = (path) => relative(root, path).replaceAll('\\', '/');

/**
 * Reads YAML frontmatter the way Claude Code needs it: `key: value` lines between --- markers.
 * Returns { data, problems }. Flags what would break a YAML parser in a plain (unquoted) value.
 */
export function frontmatter(text) {
  const problems = [];
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!match) return { data: null, problems: ['no frontmatter between --- lines at the top'] };
  const data = {};
  let current = null;
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const list = /^\s+-\s+(.*)$/.exec(line);
    if (list && current) { (data[current] = Array.isArray(data[current]) ? data[current] : []).push(unquote(list[1])); continue; }
    const pair = /^([A-Za-z_][A-Za-z0-9_-]*):(?:\s+(.*))?$/.exec(line);
    if (!pair) { problems.push(`cannot read line: ${line}`); continue; }
    const [, key, raw = ''] = pair;
    current = key;
    const value = raw.trim();
    if (value === '') { data[key] = ''; continue; }
    const quoted = /^(['"]).*\1$/.test(value);
    if (!quoted) {
      if (/:\s/.test(value)) problems.push(`${key}: an unquoted value may not contain ": " (quote it or use " - ")`);
      if (/\s#/.test(value)) problems.push(`${key}: an unquoted value may not contain " #"`);
      if (/^[[{>|*&!%@`]/.test(value) && !/^\[.*\]$/.test(value)) problems.push(`${key}: an unquoted value may not start with ${value[0]}`);
    }
    data[key] = unquote(value);
  }
  return { data, problems };
}

function unquote(value) {
  const trimmed = value.trim();
  if (/^".*"$/.test(trimmed)) return JSON.parse(trimmed);
  if (/^'.*'$/.test(trimmed)) return trimmed.slice(1, -1).replace(/''/g, "'");
  return trimmed;
}

/** A scratch copy of the project template, optionally with a fixture laid over it. */
export function scaffold(fixture) {
  const folder = mkdtempSync(join(tmpdir(), 'build-framework-'));
  cpSync(join(root, 'templates', 'project'), folder, { recursive: true });
  if (fixture) cpSync(join(root, 'tests', 'fixtures', fixture), folder, { recursive: true });
  return { folder, remove: () => rmSync(folder, { recursive: true, force: true }) };
}

/** Runs node with arguments in a folder; returns { status, out }. */
export function node(cwd, ...args) {
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', env: Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== 'NODE_TEST_CONTEXT' && name !== 'NODE_OPTIONS')) });
  return { status: result.status, out: `${result.stdout}\n${result.stderr}` };
}

export const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
