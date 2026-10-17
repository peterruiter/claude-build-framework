// The attribution guards: the plugin's PreToolUse hook and the project's commit-msg git hook.
// Sample attribution lines are built from parts so this file itself carries none.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { root, readJson } from './helpers.mjs';
import { inspect, findAttribution, guardedKind, messageFiles } from '../hooks/no-ai-attribution.mjs';

const trailer = ['Co-Authored-By:', 'Claude Opus <noreply@', 'anthropic.com>'].join(' ').replace('@ ', '@');
const copilot = ['Co-authored-by:', 'Copilot <copilot@users.noreply.github.com>'].join(' ');
const generated = ['Generated with', '[Claude Code](https://claude.com/claude-code)'].join(' ');
const robot = String.fromCodePoint(0x1F916) + ' made here';
const human = 'Co-authored-by: Jane Doe <jane@example.com>';

const bash = (command, cwd) => ({ tool_name: 'Bash', tool_input: { command }, cwd });

test('hooks.json runs the guard before Bash and PowerShell, in exec form', () => {
  const config = readJson(join(root, 'hooks', 'hooks.json'));
  const entry = config.hooks.PreToolUse[0];
  assert.equal(entry.matcher, 'Bash|PowerShell');
  assert.equal(entry.hooks[0].command, 'node');
  assert.deepEqual(entry.hooks[0].args, ['${CLAUDE_PLUGIN_ROOT}/hooks/no-ai-attribution.mjs']);
});

test('only commits, pull requests, issues and release notes are guarded', () => {
  assert.equal(guardedKind('git commit -m "x"'), 'commit message');
  assert.equal(guardedKind('git -C repo commit -F msg.txt'), 'commit message');
  assert.equal(guardedKind('gh pr create --title t --body b'), 'pull request text');
  assert.equal(guardedKind('gh release create v1 --notes n'), 'release notes');
  assert.equal(guardedKind(`grep -r "${trailer}" .`), null);
  assert.equal(guardedKind('git log --format=%B'), null);
  assert.deepEqual(messageFiles('git commit -F msg.txt && gh pr create --body-file "pr body.md" --notes-file=n.md'), ['msg.txt', 'pr body.md', 'n.md']);
});

test('attribution is found in every form; a human co-author is not', () => {
  for (const line of [trailer, copilot, generated, robot]) assert.ok(findAttribution(`Fix the export\n\n${line}`), line);
  assert.equal(findAttribution(`Fix the export\n\n${human}`), null);
  assert.equal(findAttribution('Generated with the release script'), null);
});

test('a commit with an attribution trailer in a heredoc is blocked; a clean one passes', () => {
  const heredoc = `git commit -m "$(cat <<'EOF'\nAdd CSV export\n\n${trailer}\nEOF\n)"`;
  const blocked = inspect(bash(heredoc));
  assert.equal(blocked.block, true);
  assert.match(blocked.reason, /no AI attribution anywhere/);
  assert.equal(inspect(bash('git commit -m "Add CSV export"')).block, false);
  assert.equal(inspect({ tool_name: 'PowerShell', tool_input: { command: `gh pr create --title "Export" --body "Adds export.\n\n${generated}"` } }).block, true);
  assert.equal(inspect({ tool_name: 'Read', tool_input: { file_path: 'x' } }).block, false);
});

test('a message file is read too, and the script blocks with exit code 2', (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'build-framework-hook-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  writeFileSync(join(folder, 'msg.txt'), `Add CSV export\n\n${copilot}\n`);
  const run = (input) => spawnSync(process.execPath, [join(root, 'hooks', 'no-ai-attribution.mjs')], { input: JSON.stringify(input), encoding: 'utf8' });
  const blocked = run(bash('git commit -F msg.txt', folder));
  assert.equal(blocked.status, 2, blocked.stderr);
  assert.match(blocked.stderr, /Co-Authored-By trailer naming an AI assistant/);
  writeFileSync(join(folder, 'msg.txt'), `Add CSV export\n\n${human}\n`);
  assert.equal(run(bash('git commit -F msg.txt', folder)).status, 0);
  assert.equal(spawnSync(process.execPath, [join(root, 'hooks', 'no-ai-attribution.mjs')], { input: 'not json', encoding: 'utf8' }).status, 0, 'unreadable input lets the command through');
});

test('the commit-msg git hook refuses attribution and accepts a clean message', (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'build-framework-githook-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const hook = join(folder, 'commit-msg');
  writeFileSync(hook, readFileSync(join(root, 'templates', 'project', 'githooks', 'commit-msg')));
  const check = (message) => {
    writeFileSync(join(folder, 'COMMIT_EDITMSG'), message);
    return spawnSync(process.execPath, [hook, join(folder, 'COMMIT_EDITMSG')], { encoding: 'utf8' });
  };
  for (const line of [trailer, copilot, generated, robot]) {
    const result = check(`Add CSV export\n\n${line}\n`);
    assert.equal(result.status, 1, line);
    assert.match(result.stderr, /no AI attribution anywhere/);
  }
  assert.equal(check(`Add CSV export\n\n${human}\n# ${trailer}\n`).status, 0, 'a human co-author and git comment lines pass');
});
