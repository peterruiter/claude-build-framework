// The colour tokens (src/styles/tokens.css) meet WCAG 2.2 AA in both themes:
// text 4.5:1 (1.4.3), UI components and focus indicators 3:1 (1.4.11, 2.4.11);
// and the two dark blocks (system preference, reader's choice) are identical.
// Add a pair here whenever a component puts a new token on another.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../src/styles/tokens.css'), 'utf8');

/** The custom properties declared in the first block that follows a selector. */
function block(selector) {
  const start = css.indexOf(selector);
  assert.notEqual(start, -1, `tokens.css has no ${selector}`);
  const open = css.indexOf('{', start);
  const body = css.slice(open + 1, css.indexOf('}', open));
  return Object.fromEntries([...body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const themes = {
  light: block(':root {'),
  dark: block(':root[data-theme="dark"]'),
  darkBySystem: block(':root:not([data-theme="light"])')
};

const text = [
  ['color-text', 'color-bg'], ['color-text', 'color-surface'],
  ['color-text-muted', 'color-bg'], ['color-text-muted', 'color-surface'],
  ['color-link', 'color-bg'], ['color-link', 'color-surface'],
  ['color-on-accent', 'color-accent'],
  ['color-danger', 'color-bg'], ['color-success', 'color-bg']
];
const ui = [
  ['color-border-strong', 'color-bg'], ['color-border-strong', 'color-surface'],
  ['color-focus', 'color-bg'], ['color-focus', 'color-surface'],
  ['color-accent', 'color-bg']
];

function luminance(hex) {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? [...value].map((c) => c + c).join('') : value;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

test('the contrast formula matches WCAG for black on white', () => {
  assert.equal(Math.round(contrast('#000000', '#ffffff')), 21);
});

for (const [name, tokens] of Object.entries({ light: themes.light, dark: themes.dark })) {
  test(`${name}: text pairs reach 4.5:1`, () => {
    for (const [fg, bg] of text) {
      const ratio = contrast(tokens[fg], tokens[bg]);
      assert.ok(ratio >= 4.5, `${name}: --${fg} on --${bg} is ${ratio.toFixed(2)}:1`);
    }
  });

  test(`${name}: UI and focus pairs reach 3:1`, () => {
    for (const [fg, bg] of ui) {
      const ratio = contrast(tokens[fg], tokens[bg]);
      assert.ok(ratio >= 3, `${name}: --${fg} on --${bg} is ${ratio.toFixed(2)}:1`);
    }
  });
}

test('both dark blocks hold the same tokens, and every theme has every token', () => {
  assert.deepEqual(themes.darkBySystem, themes.dark);
  assert.deepEqual(Object.keys(themes.dark).sort(), Object.keys(themes.light).sort());
});
