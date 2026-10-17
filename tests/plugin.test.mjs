// The plugin itself: manifests, every skill's and agent's frontmatter, links between files, and the
// rules every file in the repository follows (no AI attribution, no names from the projects this
// method was practised on).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { root, walk, rel, frontmatter, readJson } from './helpers.mjs';

const plugin = readJson(join(root, '.claude-plugin', 'plugin.json'));
const marketplace = readJson(join(root, '.claude-plugin', 'marketplace.json'));

test('plugin.json: kebab-case name, semantic version, author, description', () => {
  assert.match(plugin.name, /^[a-z][a-z0-9-]*$/);
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
  assert.ok(plugin.author?.name, 'author.name');
  assert.ok(plugin.description?.length > 20, 'description');
});

test('marketplace.json lists this plugin from the repository root, without a second version', () => {
  assert.match(marketplace.name, /^[a-z0-9][a-z0-9._-]*$/);
  assert.ok(marketplace.owner?.name, 'owner.name');
  const entry = marketplace.plugins.find((one) => one.name === plugin.name);
  assert.ok(entry, `an entry named ${plugin.name}`);
  assert.equal(entry.source, './', 'the repository is both marketplace and plugin');
  assert.equal(entry.version, undefined, 'version lives in plugin.json only (the docs warn against both)');
});

test('CHANGELOG.md has a section for the current version', () => {
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  assert.match(changelog, new RegExp(`^## ${plugin.version.replaceAll('.', '\\.')}\\b`, 'm'));
});

const skillFolders = readdirSync(join(root, 'skills')).filter((name) => statSync(join(root, 'skills', name)).isDirectory());

test('every skill has SKILL.md with a valid name and a description that can trigger it', () => {
  assert.ok(skillFolders.length >= 14, `skills found: ${skillFolders.length}`);
  for (const folder of skillFolders) {
    const path = join(root, 'skills', folder, 'SKILL.md');
    assert.ok(existsSync(path), `skills/${folder}/SKILL.md exists`);
    const { data, problems } = frontmatter(readFileSync(path, 'utf8'));
    assert.deepEqual(problems, [], `skills/${folder}/SKILL.md frontmatter`);
    assert.equal(data.name, folder, `skills/${folder}: name matches the folder`);
    assert.match(data.name, /^[a-z][a-z0-9-]*$/);
    assert.ok(typeof data.description === 'string' && data.description.length >= 80, `skills/${folder}: a description of at least 80 characters`);
    assert.ok(`${data.description}${data.when_to_use ?? ''}`.length <= 1536, `skills/${folder}: description and when_to_use within 1,536 characters`);
  }
});

const knownTools = new Set(['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'PowerShell', 'WebFetch', 'WebSearch', 'NotebookEdit', 'Agent', 'Skill', 'TodoWrite', 'AskUserQuestion']);
const agentFiles = readdirSync(join(root, 'agents')).filter((name) => name.endsWith('.md'));

test('every agent has a name, a description, known tools and no fields plugins ignore', () => {
  assert.ok(agentFiles.length >= 6, `agents found: ${agentFiles.length}`);
  for (const file of agentFiles) {
    const { data, problems } = frontmatter(readFileSync(join(root, 'agents', file), 'utf8'));
    assert.deepEqual(problems, [], `agents/${file} frontmatter`);
    assert.equal(data.name, file.replace(/\.md$/, ''), `agents/${file}: name matches the file`);
    assert.ok(!data.name.includes(':'), 'no colon in an agent name');
    assert.ok(data.description?.length >= 80, `agents/${file}: description`);
    for (const field of ['tools', 'disallowedTools']) {
      if (data[field] === undefined) continue;
      const list = Array.isArray(data[field]) ? data[field] : data[field].split(',').map((one) => one.trim());
      for (const tool of list) assert.ok(knownTools.has(tool.replace(/\(.*\)$/, '')) || tool.startsWith('mcp__'), `agents/${file}: unknown tool '${tool}'`);
    }
    for (const ignored of ['hooks', 'mcpServers', 'permissionMode']) assert.equal(data[ignored], undefined, `agents/${file}: plugin agents ignore '${ignored}'`);
  }
});

const markdown = walk(root).filter((path) => path.endsWith('.md') && !rel(path).startsWith('tests/'));

test('relative links and ${CLAUDE_PLUGIN_ROOT} paths in Markdown point at files that exist', () => {
  const broken = [];
  for (const file of markdown) {
    const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
    for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^(https?:|mailto:|#)/.test(target) || target.includes('{{') || target.includes('<')) continue;
      const path = resolve(dirname(file), decodeURIComponent(target.split('#')[0]));
      if (!existsSync(path)) broken.push(`${rel(file)} → ${target}`);
    }
    for (const [, target] of text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_./-]+)/g)) {
      const clean = target.replace(/[.,;:]+$/, '');
      if (clean.includes('<') || clean.endsWith('…')) continue;
      if (!existsSync(join(root, clean))) broken.push(`${rel(file)} → \${CLAUDE_PLUGIN_ROOT}/${clean}`);
    }
  }
  assert.deepEqual(broken, []);
});

// Built from parts so this file does not trip its own check.
const forbidden = [
  ['attend', 'beacon'].join(''),
  ['distilled', 'from'].join(' '),
  ['co-authored-by:', 'claude'].join(' '),
  ['generated with', '[claude'].join(' '),
  ['generated with', 'claude code'].join(' '),
  ['co-authored-by:', 'github copilot'].join(' '),
];

test('no file names the projects this was practised on, and nothing carries AI attribution', () => {
  const found = [];
  for (const file of walk(root)) {
    if (/\.(png|jpe?g|gif|webp|mp4|webm|mp3|wav|ico|woff2?|zip)$/i.test(file)) continue;
    const text = readFileSync(file, 'utf8').toLowerCase();
    for (const phrase of forbidden) if (text.includes(phrase)) found.push(`${rel(file)}: "${phrase}"`);
    if (text.includes('\u{1F916}')) found.push(`${rel(file)}: robot emoji`);
  }
  assert.deepEqual(found, []);
});
