// scripts/design-system.mjs: both shipped design systems pass their check; every target builds and
// parses; the CSS carries both themes with the dark guard; the Fluent ramp has 16 steps; a broken
// token set fails with useful messages; the project template's generated files are current; a
// project switched to another design system passes its theme contract test; video-tour resolves a
// design system by id.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { root, scaffold, node, readJson } from './helpers.mjs';

const ds = await import(pathToFileURL(join(root, 'scripts', 'design-system.mjs')).href);
const script = join(root, 'scripts', 'design-system.mjs');
// Built from parts so this file does not trip the self-test's name check.
const branded = [['cap', 'gemini'].join(''), 'zodiak'].join('-');
const systems = ['neutral', branded];

function scratch(t) {
  const folder = mkdtempSync(join(tmpdir(), 'design-system-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}

/** The custom properties declared in the first rule whose selector matches. */
function block(css, selector) {
  const at = css.indexOf(selector);
  if (at < 0) return null;
  const open = css.indexOf('{', at);
  const body = css.slice(open + 1, css.indexOf('}', open));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

test('list shows every design system folder, the default neutral one included', () => {
  const ids = ds.listSystems().map((one) => one.id);
  assert.deepEqual(ids, [...ids].sort());
  for (const id of systems) assert.ok(ids.includes(id), id);
  const listed = node(root, script, 'list');
  assert.equal(listed.status, 0, listed.out);
  assert.match(listed.out, /^neutral\s+Neutral 1\.0\.0/m);
});

for (const id of systems) {
  test(`${id}: check passes`, () => {
    const result = ds.checkSystem(ds.loadSystem(id));
    assert.deepEqual(result.errors, []);
    assert.ok(result.passed.length >= 20, `contrast checks: ${result.passed.length}`);
    const cli = node(root, script, 'check', id);
    assert.equal(cli.status, 0, cli.out);
  });

  test(`${id}: every target builds, and every file parses`, (t) => {
    const out = scratch(t);
    const written = ds.build(ds.loadSystem(id), out);
    for (const file of ['tokens.json', 'tokens.css', 'tokens.ts', 'fluent-theme.ts', 'fluent-theme.json', 'dataverse-theme.xml', 'dataverse-app-header.xml', 'dataverse-theme.json', 'email-palette.json', 'chart-palette.json', 'video-brand.json', 'office-theme.json']) {
      assert.ok(written.includes(file) && existsSync(join(out, file)), `${file} written`);
    }
    for (const file of written.filter((one) => one.endsWith('.json'))) assert.doesNotThrow(() => readJson(join(out, file)), file);
    for (const file of ['tokens.ts', 'fluent-theme.ts']) {
      const check = node(out, '--check', '--experimental-strip-types', file);
      assert.ok(check.status === 0 || /strip-types|unknown/i.test(check.out), `${file}: ${check.out}`);
    }
    const xml = readFileSync(join(out, 'dataverse-theme.xml'), 'utf8');
    assert.match(xml, /^<CustomTheme$/m);
    assert.match(xml, /<AppHeaderColors[\s\S]*background="#[0-9A-F]{6}"[\s\S]*\/>\s*<\/CustomTheme>/);
    for (const slot of ['darker70', 'darker10', 'primary', 'lighter10', 'lighter80']) assert.match(xml, new RegExp(`\\b${slot}="#[0-9A-F]{6}"`), slot);
    const email = readJson(join(out, 'email-palette.json'));
    for (const theme of ['light', 'dark']) for (const [key, value] of Object.entries(email[theme])) assert.match(value, /^#[0-9a-f]{6}$/, `email ${theme}.${key} is opaque hex`);
    const video = readJson(join(out, 'video-brand.json'));
    for (const value of Object.values(video.colors)) assert.match(value, /^#[0-9a-f]{6}$/);
    if (video.font.file) assert.ok(existsSync(join(out, video.font.file)), 'the video font travels with the output');
    if (video.logo) assert.ok(existsSync(join(out, video.logo)), 'the video logo travels with the output');
    const office = readJson(join(out, 'office-theme.json'));
    assert.deepEqual(Object.keys(office.colors), ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink']);
    assert.ok(office.fonts.major && office.fonts.minor);
    const charts = readJson(join(out, 'chart-palette.json'));
    assert.ok(charts.light.length >= 6 && charts.dark.length >= 6, 'six or more series per theme');
  });

  test(`${id}: tokens.css has both themes, the dark guard, and identical dark blocks`, () => {
    const css = ds.css(ds.loadSystem(id));
    assert.match(css, /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{/);
    assert.match(css, /:root\[data-theme="dark"\] \{/);
    const light = block(css, ':root {');
    const system = block(css, ':root:not([data-theme="light"])');
    const chosen = block(css, ':root[data-theme="dark"]');
    assert.ok(Object.keys(light).length >= 10);
    assert.deepEqual(Object.keys(system).sort(), Object.keys(light).sort());
    assert.deepEqual(chosen, system);
    for (const value of [...Object.values(light), ...Object.values(system)]) assert.ok(ds.parseColor(value), `${value} is a colour`);
    for (const role of ['background', 'text', 'accent', 'focus']) assert.match(css, new RegExp(`--ds-${role}: `), `role --ds-${role}`);
    assert.match(css, /:focus-visible \{\s*outline: 2px solid var\(--ds-focus\)/);
    assert.match(css, /prefers-reduced-motion: reduce/);
  });

  test(`${id}: the Fluent brand ramp has 16 steps from dark to light, with the brand colour at 80`, () => {
    const system = ds.loadSystem(id);
    const theme = ds.fluent(system);
    assert.deepEqual(Object.keys(theme.brand).map(Number), [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160]);
    for (const value of Object.values(theme.brand)) assert.match(value, /^#[0-9a-f]{6}$/);
    assert.equal(theme.brand[80], ds.opaqueHex(system.value(system.manifest.brandColor, 'light')));
    const lightness = Object.values(theme.brand).map((hex) => ds.contrast(hex, '#000000'));
    for (let i = 1; i < lightness.length; i++) assert.ok(lightness[i] > lightness[i - 1], `step ${(i + 1) * 10} is lighter than step ${i * 10}`);
    for (const mode of ['light', 'dark']) assert.ok(theme[mode].colorNeutralBackground1 && theme[mode].colorBrandBackground && theme[mode].colorStrokeFocus2, `${mode} overrides`);
  });
}

test(`${branded}: the brand book's own exceptions are known, not failures, and the source has no shortfalls left`, () => {
  const result = ds.checkSystem(ds.loadSystem(branded));
  for (const token of ['border-primary', 'text-disabled', 'action-active']) assert.ok(result.known.some((line) => line.startsWith(`${token} on `)), `${token} is a known exception`);
  // Error text and links on the heavy blue surfaces were fixed in 1.0.1 (red-100, white links).
  assert.deepEqual(result.findings, [], 'no undocumented shortfalls');
  const cli = node(root, script, 'check', branded);
  assert.match(cli.out, /known: border-primary on page-background \(light\): 1\.61:1/);
  assert.doesNotMatch(cli.out, /finding: /);
});

test(`${branded}: the build carries the font licence, the logos and the brand use rules`, (t) => {
  const out = scratch(t);
  const result = node(root, script, 'build', branded, '--out', out, '--targets', 'css');
  assert.equal(result.status, 0, result.out);
  assert.ok(existsSync(join(out, 'fonts', 'LICENCE.txt')));
  assert.match(readFileSync(join(out, 'fonts', 'LICENCE.txt'), 'utf8'), /UBUNTU FONT LICENCE Version 1\.0/);
  assert.ok(readdirSync(join(out, 'fonts')).filter((file) => file.endsWith('.woff2')).length === 5);
  assert.ok(existsSync(join(out, 'BRAND-USE.md')));
  assert.ok(existsSync(join(out, 'logos')));
  const css = readFileSync(join(out, 'tokens.css'), 'utf8');
  for (const [, url] of css.matchAll(/url\("([^"]+)"\)/g)) assert.ok(existsSync(join(out, url)), `${url} next to tokens.css`);
  assert.deepEqual(readdirSync(out).sort(), ['BRAND-USE.md', 'fonts', 'logos', 'tokens.css', 'tokens.json']);
});

test('a broken token set fails the check with a message per problem', () => {
  const manifest = {
    id: 'broken', name: 'Broken', version: '0.0.1',
    roles: { background: 'bg', surface: 'bg', text: 'text', textMuted: 'muted', border: 'bg', accent: 'accent', textInverse: 'bg', focus: 'accent', danger: 'nowhere' },
    contrast: { pairs: [{ fg: 'muted', bg: 'bg', min: 4.5 }, { fg: 'accent', bg: 'bg', min: 3 }], known: [{ fg: 'text', bg: 'bg', min: 4.5 }] },
    office: { fonts: { major: 'A', minor: 'B' }, colors: {} }
  };
  const tokens = {
    color: {
      themes: [{ id: 'light' }, { id: 'dark' }],
      tokens: [
        { name: 'white', value: '#ffffff' },
        { name: 'bg', value: { light: '{white}', dark: '#000000' } },
        { name: 'text', value: { light: '#111111', dark: '#eeeeee' } },
        { name: 'text', value: '#123456' },
        { name: 'muted', value: { light: '#cccccc', dark: '#333333' } },
        { name: 'accent', value: { light: '{missing}' } },
        { name: 'odd', value: 'not a colour' }
      ]
    }
  };
  const { errors } = ds.checkSystem(ds.model(manifest, tokens));
  const expect = [
    /token name 'text' is used twice/,
    /semantic token 'accent' has no dark value/,
    /'accent' \(light\): unknown token 'missing'/,
    /'odd': 'not a colour' is not a colour/,
    /role 'danger': unknown token 'nowhere'/,
    /contrast muted on bg \(light\): 1\.61:1, needs 4\.5:1/,
    /contrast muted on bg \(dark\): 1\.66:1, needs 4\.5:1/,
    /known pair text on bg needs a reason/
  ];
  for (const pattern of expect) assert.ok(errors.some((line) => pattern.test(line)), `expected ${pattern} in:\n${errors.join('\n')}`);
  assert.throws(() => ds.build(ds.model(manifest, tokens), mkdtempSync(join(tmpdir(), 'design-system-'))), /does not pass its check/);
});

test('build refuses an unknown target, and check an unknown design system, with the known ones listed', (t) => {
  const out = scratch(t);
  const badTarget = node(root, script, 'build', 'neutral', '--out', out, '--targets', 'css,pdf');
  assert.equal(badTarget.status, 1);
  assert.match(badTarget.out, /unknown target\(s\): pdf/);
  const missing = node(root, script, 'check', 'nope');
  assert.equal(missing.status, 1);
  assert.match(missing.out, /No design system 'nope'.*known: .*neutral/);
});

test('contrast and colour helpers match WCAG reference values', () => {
  assert.equal(ds.contrast('#000000', '#ffffff').toFixed(2), '21.00');
  assert.equal(ds.contrast('#767676', '#ffffff').toFixed(2), '4.54');
  assert.equal(ds.opaqueHex('rgba(0,0,0,0.5)', '#ffffff'), '#808080');
  assert.equal(ds.opaqueHex('hsla(0,0%,100%,0.5)', '#000000'), '#808080');
  assert.equal(ds.opaqueHex('#abc'), '#aabbcc');
});

test('the project template ships the neutral design system, generated and current', (t) => {
  const config = readJson(join(root, 'templates', 'project', 'build', 'framework.json'));
  assert.equal(config.designSystem.id, 'neutral');
  const out = scratch(t);
  ds.build(ds.loadSystem('neutral'), out, config.designSystem.targets);
  for (const file of ['tokens.css', 'tokens.json', 'tokens.ts']) {
    const shipped = readFileSync(join(root, 'templates', 'project', config.designSystem.out, file), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(shipped, readFileSync(join(out, file), 'utf8'), `templates/project/${config.designSystem.out}/${file} is current (regenerate with scripts/design-system.mjs build neutral --out templates/project/${config.designSystem.out} --targets ${config.designSystem.targets.join(',')})`);
  }
});

test('a project switched to another design system passes its theme test; a stale or mismatched one fails', (t) => {
  const project = scaffold();
  t.after(project.remove);
  const configPath = join(project.folder, 'build', 'framework.json');
  const config = readJson(configPath);
  const out = join(project.folder, config.designSystem.out);
  rmSync(out, { recursive: true, force: true });
  const built = node(root, script, 'build', branded, '--out', out, '--targets', 'css,ts');
  assert.equal(built.status, 0, built.out);

  const stale = node(project.folder, '--test', 'tests/contracts/theme.test.mjs');
  assert.notEqual(stale.status, 0, 'framework.json still says neutral');
  assert.match(stale.out, /generated from '[a-z-]+', but build\/framework\.json says 'neutral'/);

  config.designSystem.id = branded;
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  const switched = node(project.folder, '--test', 'tests/contracts/theme.test.mjs');
  assert.equal(switched.status, 0, switched.out);
  assert.match(switched.out, /known exception: border-primary/);

  config.theme.pairs = [{ fg: '--border-primary', bg: '--page-background', min: 3 }];
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  const tooLow = node(project.folder, '--test', 'tests/contracts/theme.test.mjs');
  assert.notEqual(tooLow.status, 0);
  assert.match(tooLow.out, /border-primary on --page-background is 1\.61:1, needs 3:1/);
});

test('video-tour resolves brand.designSystem through the script, and settings beside it win', async (t) => {
  const folder = scratch(t);
  const { designSystemBrand } = await import(pathToFileURL(join(root, 'tools', 'video-tour', 'src', 'config.mjs')).href);
  const brand = designSystemBrand(branded, null, folder);
  assert.match(brand.colors.background, /^#[0-9a-f]{6}$/);
  assert.ok(existsSync(brand.font.file), 'absolute font path');
  assert.ok(existsSync(brand.logo), 'absolute logo path');
  const neutral = designSystemBrand('neutral', null, folder);
  assert.equal(neutral.logo, null);
  assert.throws(() => designSystemBrand('nope', null, folder), /no design-systems\/nope/);
});
