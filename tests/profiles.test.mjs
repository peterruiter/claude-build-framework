// The profiles take their look only from a design system: every scaffold.ps1 takes -DesignSystem
// (default neutral) and uses the shared module; the neutral files each scaffold ships are what the
// generator makes today (regenerate them when the generator or the neutral system changes); the
// .NET web app holds no colour of its own; the Dataverse theme web resource is the generated theme.
// Generating a project with each system and running its gate is CI's job (.github/workflows/profiles.yml).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { root, readJson } from './helpers.mjs';

const ds = await import(pathToFileURL(join(root, 'scripts', 'design-system.mjs')).href);
const normal = (text) => text.replace(/^﻿/, '').replace(/\r\n/g, '\n');

// Where each profile's scaffold keeps the generated files, and which targets.
const shipped = [
  { profile: 'dotnet-react-azure', out: 'src/web/src/styles/design-system', targets: ['css', 'ts', 'email', 'charts'] },
  { profile: 'power-platform-pcf', out: 'controls/shared/design-system', targets: ['fluent', 'ts'] },
  { profile: 'dataverse-solution', out: 'docs/brand', targets: ['dataverse', 'email', 'office', 'charts'] }
];

function scratch(t) {
  const folder = mkdtempSync(join(tmpdir(), 'profile-design-system-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}

function files(folder) {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    if (['node_modules', 'design-system', 'out', 'bin', 'obj'].includes(name)) return [];
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

for (const profile of readdirSync(join(root, 'profiles')).filter((name) => statSync(join(root, 'profiles', name)).isDirectory())) {
  test(`${profile}: scaffold.ps1 takes -DesignSystem (default neutral) and records it`, () => {
    const script = readFileSync(join(root, 'profiles', profile, 'scaffold.ps1'), 'utf8');
    assert.match(script, /\[string\]\s*\$DesignSystem\s*=\s*'neutral'/, 'a -DesignSystem parameter, neutral by default');
    assert.match(script, /scripts\/DesignSystem\.psm1/, 'the shared design system module');
    assert.match(script, /Assert-DesignSystem -Id \$DesignSystem/, 'an unknown id stops the script before anything is written');
    assert.match(script, /Set-ProjectDesignSystem -Destination \$Destination -Id \$DesignSystem/, 'build/framework.json records the choice');
  });
}

for (const { profile, out, targets } of shipped) {
  test(`${profile}: the neutral files the scaffold ships are current`, (t) => {
    const fresh = scratch(t);
    const written = ds.build(ds.loadSystem('neutral'), fresh, targets);
    const folder = join(root, 'profiles', profile, 'scaffold', out);
    for (const file of written) {
      assert.equal(normal(readFileSync(join(folder, file), 'utf8')), readFileSync(join(fresh, file), 'utf8'),
        `profiles/${profile}/scaffold/${out}/${file} is current (regenerate: node scripts/design-system.mjs build neutral --out profiles/${profile}/scaffold/${out} --targets ${targets.join(',')})`);
    }
    const extra = readdirSync(folder).filter((name) => !written.includes(name));
    assert.deepEqual(extra, [], `nothing in profiles/${profile}/scaffold/${out} the generator does not write`);
  });
}

for (const profile of ['dotnet-react-azure', 'dataverse-solution']) {
  test(`${profile}: the scaffold's build/framework.json names neutral and where the files are`, () => {
    const config = readJson(join(root, 'profiles', profile, 'scaffold', 'build', 'framework.json'));
    const { out, targets } = shipped.find((one) => one.profile === profile);
    assert.deepEqual(config.designSystem, { id: 'neutral', out, targets });
  });
}

test('dotnet-react-azure: the web app and the start page hold no colour values of their own', () => {
  const scaffold = join(root, 'profiles', 'dotnet-react-azure', 'scaffold');
  const literal = /(?<![\w&/])#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/gi;
  const found = [];
  const sources = [...files(join(scaffold, 'src', 'web', 'src')), ...files(join(scaffold, 'src', 'web', 'portal')),
    join(scaffold, 'src', 'web', 'index.html'), join(scaffold, 'src', 'App.Api', 'wwwroot', 'index.html')];
  for (const path of sources.filter((one) => /\.(css|tsx?|html)$/.test(one))) {
    for (const match of readFileSync(path, 'utf8').matchAll(literal)) found.push(`${relative(root, path)}: ${match[0]}`);
  }
  assert.deepEqual(found, []);
});

test('dataverse-solution: the theme web resource in the sample solution is the generated theme', () => {
  const scaffold = join(root, 'profiles', 'dataverse-solution', 'scaffold');
  const webResource = readFileSync(join(scaffold, 'solutions', 'CaseAppCore', 'src', 'WebResources', 'contoso_theme.xml'), 'utf8');
  assert.equal(normal(webResource), normal(readFileSync(join(scaffold, 'docs', 'brand', 'dataverse-theme.xml'), 'utf8')));
  assert.match(readFileSync(join(scaffold, 'solutions', 'CaseAppCore', 'src', 'Other', 'Solution.xml'), 'utf8'), /<RootComponent type="61" schemaName="contoso_theme\.xml"/);
});

test('power-platform-pcf: the controls take the design system where the host passes no theme', () => {
  const theme = readFileSync(join(root, 'profiles', 'power-platform-pcf', 'scaffold', 'controls', 'shared', 'theme.ts'), 'utf8');
  assert.match(theme, /from "\.\/design-system\/fluent-theme"/);
  assert.doesNotMatch(theme, /webLightTheme|webDarkTheme/, 'never Fluent\'s own web themes as the fallback');
});

test('tools/video-tour: the example takes its brand from a design system', () => {
  const config = readJson(join(root, 'tools', 'video-tour', 'example', 'video-tour.config.json'));
  assert.deepEqual(config.brand, { designSystem: 'neutral' });
});
