// Light and dark themes, from the design system's generated files (build/framework.json: theme.css is
// the generated tokens.css, theme.tokens the generated tokens.json). Both themes define the same
// tokens, the system dark block and the explicit data-theme="dark" block agree, and every colour pair
// meets its WCAG contrast in both themes (text 4.5:1, large text and UI parts such as the focus ring
// 3:1): the design system's own pairs (tokens.json contrast.pairs) plus the project's (theme.pairs).
// The design system's documented exceptions (contrast.known) are reported, not failed.
// Run: node --test "tests/contracts/*.test.mjs"   (Node's own modules only)
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import test from 'node:test';

function findConfig(start) {
  let folder = resolve(start);
  for (;;) {
    const candidate = join(folder, 'build', 'framework.json');
    if (existsSync(candidate)) return candidate;
    const up = dirname(folder);
    if (up === folder) throw new Error('No build/framework.json here or above; run the tests from the repository.');
    folder = up;
  }
}

const configPath = findConfig(process.env.FRAMEWORK_ROOT ?? process.cwd());
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const root = resolve(dirname(configPath), config.root ?? '..');
const theme = config.theme;
const cssPath = theme?.css ? resolve(root, theme.css) : null;
const tokensPath = theme?.tokens ? resolve(root, theme.tokens) : null;
const skip = !cssPath || !existsSync(cssPath) ? 'no theme.css configured in build/framework.json' : false;
const generated = tokensPath && existsSync(tokensPath) ? JSON.parse(readFileSync(tokensPath, 'utf8')) : null;

/** The custom properties declared in the first rule whose selector matches. */
function block(css, selector) {
  const at = css.indexOf(selector);
  if (at < 0) return null;
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  const tokens = {};
  for (const match of css.slice(open + 1, close).matchAll(/(--[A-Za-z0-9-]+)\s*:\s*([^;]+);/g)) tokens[match[1]] = match[2].trim();
  return tokens;
}

function luminance(hex) {
  let value = hex.replace('#', '');
  if (value.length === 3) value = [...value].map((digit) => digit + digit).join('');
  assert.match(value, /^[0-9a-fA-F]{6}$/, `${hex} is a hex colour`);
  const [r, g, b] = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const cssName = (name) => (name.startsWith('--') ? name : `--${name}`);

test('both themes define the same tokens, and the two dark blocks agree', { skip }, () => {
  const css = readFileSync(cssPath, 'utf8');
  const light = block(css, ':root {') ?? block(css, ':root{');
  const system = block(css, ':root:not([data-theme="light"])');
  const chosen = block(css, ':root[data-theme="dark"]');
  assert.ok(light, 'a :root block with the light tokens');
  assert.ok(system, 'a prefers-color-scheme: dark block for :root:not([data-theme="light"])');
  assert.ok(chosen, 'a :root[data-theme="dark"] block for an explicit choice');
  assert.deepEqual(Object.keys(system).sort(), Object.keys(light).sort(), 'dark defines every light token');
  assert.deepEqual(chosen, system, 'the system dark block and the data-theme="dark" block are the same');
});

test('the generated files come from the design system named in build/framework.json', { skip: skip || (!config.designSystem && 'no designSystem in build/framework.json') }, () => {
  const { id, out } = config.designSystem;
  assert.ok(generated, `${theme.tokens} exists (regenerate: scripts/design-system.mjs build ${id} --out ${out})`);
  assert.equal(generated.designSystem?.id, id, `${theme.tokens} was generated from '${generated.designSystem?.id}', but build/framework.json says '${id}'; regenerate`);
  assert.ok(readFileSync(cssPath, 'utf8').includes(`design-systems/${id} `), `${theme.css} was generated from another design system than '${id}'; regenerate`);
});

test('every listed colour pair meets its contrast in light and dark', { skip }, (t) => {
  const css = readFileSync(cssPath, 'utf8');
  const themes = { light: block(css, ':root {') ?? block(css, ':root{'), dark: block(css, ':root[data-theme="dark"]') };
  const pairs = [...(generated?.contrast?.pairs ?? []), ...(theme.pairs ?? [])];
  assert.ok(pairs.length > 0, 'pairs to check: the design system\'s (theme.tokens) or the project\'s own (theme.pairs)');
  for (const [name, tokens] of Object.entries(themes)) {
    for (const pair of pairs) {
      if (pair.themes && !pair.themes.includes(name)) continue;
      const fg = tokens[cssName(pair.fg)];
      const bg = tokens[cssName(pair.bg)];
      assert.ok(fg && bg, `${name}: ${cssName(pair.fg)} and ${cssName(pair.bg)} are defined`);
      const ratio = contrast(fg, bg);
      assert.ok(ratio >= pair.min, `${name}: ${pair.fg} on ${pair.bg} is ${ratio.toFixed(2)}:1, needs ${pair.min}:1`);
    }
  }
  for (const pair of generated?.contrast?.known ?? []) {
    t.diagnostic(`known exception: ${pair.fg} on ${pair.bg} below ${pair.min}:1 (${pair.reason})`);
  }
});
