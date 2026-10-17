import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkTool, compareVersions, highestVersion, readList } from '../scripts/check-prereqs.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('versions compare numerically', () => {
  assert.ok(compareVersions('9.0.315', '9.0.200') > 0);
  assert.ok(compareVersions('2.9.0', '2.40.0') < 0);
  assert.equal(compareVersions('22.18', '22.18.0'), 0);
});

test('the highest version in the output counts', () => {
  const sdks = '8.0.404 [C:\\Program Files\\dotnet\\sdk]\n9.0.315 [C:\\Program Files\\dotnet\\sdk]\n10.0.303 [x]';
  assert.equal(highestVersion(sdks, '(9\\.0\\.\\d+)'), '9.0.315');
  assert.equal(highestVersion('gh version 2.97.0 (2026-09-01)', 'gh version (\\d+\\.\\d+\\.\\d+)'), '2.97.0');
  assert.equal(highestVersion('nothing here', '(\\d+\\.\\d+\\.\\d+)'), null);
});

test('a tool is ok, too old, missing or unreadable', () => {
  const tool = { id: 't', name: 'T', command: 't', args: [], pattern: 'v(\\d+\\.\\d+\\.\\d+)', min: '2.0.0' };
  const run = (out) => () => ({ found: true, stdout: out, stderr: '' });
  assert.equal(checkTool(tool, run('v2.1.0')).status, 'ok');
  assert.equal(checkTool(tool, run('v1.9.9')).status, 'old');
  assert.equal(checkTool(tool, run('no version')).status, 'unknown');
  assert.equal(checkTool(tool, () => ({ found: false, stdout: '', stderr: '' })).status, 'missing');
});

test('every prerequisites file is complete, with install steps for each OS', () => {
  const files = [join(root, 'prerequisites.json')];
  for (const profile of readdirSync(join(root, 'profiles'))) {
    const file = join(root, 'profiles', profile, 'prerequisites.json');
    assert.ok(existsSync(file), `profiles/${profile} has no prerequisites.json`);
    files.push(file);
  }
  for (const file of files) {
    const list = readList(file);
    const ids = new Set();
    for (const tool of list.tools) {
      for (const field of ['id', 'name', 'command', 'why', 'docs']) assert.ok(tool[field], `${file}: ${tool.id ?? '?'} has no ${field}`);
      assert.ok(!ids.has(tool.id), `${file}: ${tool.id} twice`);
      ids.add(tool.id);
      assert.ok(Array.isArray(tool.args ?? []), `${file}: ${tool.id} args is not a list`);
      if (tool.pattern) new RegExp(tool.pattern);
      for (const os of ['windows', 'macos', 'linux']) assert.ok(tool.install?.[os], `${file}: ${tool.id} has no ${os} install step`);
      assert.match(tool.docs, /^https:\/\//, `${file}: ${tool.id} docs is not https`);
    }
  }
});
