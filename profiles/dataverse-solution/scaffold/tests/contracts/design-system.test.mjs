// The design system: the model-driven apps' modern theme in the solution is exactly what the build
// framework's scripts/design-system.mjs generated for the design system build/framework.json names.
//
//   docs/brand/ (designSystem.out)   generated: dataverse-theme.xml, the email, chart and Office
//                                    palettes, tokens.json. Never edited; regenerated.
//   solutions/<core>/src/WebResources/<prefix>_theme.xml
//                                    the same dataverse-theme.xml as a Data (XML) web resource, a root
//                                    component of the core solution; the "Custom theme definition"
//                                    setting names it.
//
// After a regenerate (design-system skill): copy docs/brand/dataverse-theme.xml over the web resource.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readText, readJson, exists, schema, prefix, readSolutionFile } from './dataverse-lib.mjs';

const config = exists('build/framework.json') ? readJson('build/framework.json') : null;
const id = config?.designSystem?.id;
const out = config?.designSystem?.out ?? 'docs/brand';
const core = schema.solutions.find((solution) => solution.layer === 'core') ?? schema.solutions[0];
const webResource = `${prefix}theme.xml`;
const normal = (text) => text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trimEnd();

/** Attributes of the first element with this name, as an object. */
function attributes(xml, name) {
  const match = new RegExp(`<${name}\\s([^>]*?)/?>`).exec(xml);
  assert.ok(match, `<${name}> is in the theme`);
  return Object.fromEntries([...match[1].matchAll(/(\w+)="([^"]*)"/g)].map(([, key, value]) => [key, value]));
}

function contrast(a, b) {
  const luminance = (hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('build/framework.json names the design system, and docs/brand was generated from it', () => {
  assert.ok(id, 'build/framework.json has designSystem.id (scaffold.ps1 -DesignSystem writes it)');
  const tokens = readJson(`${out}/tokens.json`);
  assert.equal(tokens.designSystem.id, id, `${out} was generated from '${tokens.designSystem.id}', but build/framework.json says '${id}': regenerate (design-system skill)`);
  for (const file of ['dataverse-theme.xml', 'email-palette.json', 'office-theme.json']) assert.ok(exists(`${out}/${file}`), `${out}/${file} is generated`);
  assert.ok(readText(`${out}/dataverse-theme.xml`).includes(`design-systems/${id} `), `${out}/dataverse-theme.xml comes from '${id}'`);
});

test('the theme web resource in the core solution is the generated theme, unchanged', () => {
  const path = `WebResources/${webResource}`;
  assert.ok(exists(`${core.folder}/${path}`), `${core.folder}/${path} exists`);
  assert.equal(normal(readSolutionFile(core, path)), normal(readText(`${out}/dataverse-theme.xml`)),
    `${core.folder}/${path} differs from ${out}/dataverse-theme.xml: copy the generated file over it (never edit either)`);
  const data = readSolutionFile(core, `${path}.data.xml`);
  assert.match(data, new RegExp(`<Name>${webResource.replace('.', '\\.')}</Name>`), 'the web resource has the name the setting uses');
  assert.match(data, /<WebResourceType>4<\/WebResourceType>/, 'a Data (XML) web resource');
  assert.match(data, new RegExp(`<FileName>/${path.replace('.', '\\.')}</FileName>`));
  assert.match(readSolutionFile(core, 'Other/Solution.xml'), new RegExp(`<RootComponent type="61" schemaName="${webResource.replace('.', '\\.')}"`), 'a root component of the core solution');
});

test('the theme is a modern CustomTheme: the full palette, and app header text at 4.5:1 in every state', () => {
  const xml = readText(`${out}/dataverse-theme.xml`);
  const theme = attributes(xml, 'CustomTheme');
  assert.match(theme.basePaletteColor ?? '', /^#[0-9A-F]{6}$/i, 'basePaletteColor');
  const slots = ['darker70', 'darker60', 'darker50', 'darker40', 'darker30', 'darker20', 'darker10', 'primary',
    'lighter10', 'lighter20', 'lighter30', 'lighter40', 'lighter50', 'lighter60', 'lighter70', 'lighter80'];
  for (const slot of slots) assert.match(theme[slot] ?? '', /^#[0-9A-F]{6}$/i, `palette slot ${slot}`);
  const header = attributes(xml, 'AppHeaderColors');
  for (const state of ['', 'Hover', 'Pressed', 'Selected']) {
    const background = header[`background${state}`];
    const foreground = header[`foreground${state}`];
    assert.ok(background && foreground, `app header ${state || 'rest'} colours`);
    assert.ok(contrast(foreground, background) >= 4.5, `app header ${state || 'rest'}: ${foreground} on ${background} is ${contrast(foreground, background).toFixed(2)}:1`);
  }
});
