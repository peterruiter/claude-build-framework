// Light and dark themes (src/styles/tokens.css): both themes define the same tokens, the system dark
// block and the explicit data-theme="dark" block agree, and every colour pair listed under "theme"
// in build/framework.json meets its WCAG contrast ratio in both themes (text 4.5:1, large text and
// UI parts such as the focus ring 3:1).
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
const skip = !cssPath || !existsSync(cssPath) ? 'no theme.css configured in build/framework.json' : false;

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

test('every listed colour pair meets its contrast in light and dark', { skip }, () => {
  const css = readFileSync(cssPath, 'utf8');
  const themes = { light: block(css, ':root {') ?? block(css, ':root{'), dark: block(css, ':root[data-theme="dark"]') };
  assert.ok((theme.pairs ?? []).length > 0, 'build/framework.json lists theme.pairs');
  for (const [name, tokens] of Object.entries(themes)) {
    for (const pair of theme.pairs) {
      const fg = tokens[pair.fg];
      const bg = tokens[pair.bg];
      assert.ok(fg && bg, `${name}: ${pair.fg} and ${pair.bg} are defined`);
      const ratio = contrast(fg, bg);
      assert.ok(ratio >= pair.min, `${name}: ${pair.fg} on ${pair.bg} is ${ratio.toFixed(2)}:1, needs ${pair.min}:1`);
    }
  }
});
