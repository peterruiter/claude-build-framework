#!/usr/bin/env node
// One design system drives every output a project makes. This script reads
// design-systems/<id>/ (design-system.json + tokens.json in the Claude Design System format) and
// generates what each part of a project needs: CSS custom properties for light and dark, tokens for
// JavaScript, a Fluent UI v9 theme, a Dataverse model-driven app theme, an email palette, a chart
// palette, a video-tour brand block and an Office theme mapping. It also checks a design system:
// unique names, both themes for every semantic token, and the contrast of its documented pairs.
//
//   node scripts/design-system.mjs list
//   node scripts/design-system.mjs build <id> --out <dir> [--targets css,ts,fluent,dataverse,email,charts,video,office]
//   node scripts/design-system.mjs check <id> [--json]
//   node scripts/design-system.mjs show <id> --target <target>     (one target to stdout; paths absolute)
//
// --root <folder> reads design systems from another folder than this repository's design-systems/.
// Node's own modules only. Output is deterministic (no dates), so regenerating gives a clean diff.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { join, resolve, dirname, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'design-systems');
export const TARGETS = ['css', 'ts', 'fluent', 'dataverse', 'email', 'charts', 'video', 'office'];
const THEMES = ['light', 'dark'];

// ------------------------------------------------------------------------------------- colours

/** Parses #rgb, #rrggbb, #rrggbbaa, rgb(a)() and hsl(a)() into { r, g, b, a } (0-255, alpha 0-1). */
export function parseColor(text) {
  const value = String(text).trim().toLowerCase();
  let match = /^#([0-9a-f]{3,8})$/.exec(value);
  if (match) {
    let hex = match[1];
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((digit) => digit + digit).join('');
    if (hex.length !== 6 && hex.length !== 8) return null;
    const [r, g, b] = [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16));
    return { r, g, b, a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1 };
  }
  match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(value);
  if (match) return { r: +match[1], g: +match[2], b: +match[3], a: alpha(match[4]) };
  match = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(value);
  if (match) {
    const [h, s, l] = [+match[1] / 360, +match[2] / 100, +match[3] / 100];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const channel = (t) => {
      const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
      const v = x < 1 / 6 ? p + (q - p) * 6 * x : x < 1 / 2 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p;
      return Math.round(v * 255);
    };
    return { r: channel(h + 1 / 3), g: channel(h), b: channel(h - 1 / 3), a: alpha(match[4]) };
  }
  return null;
}
const alpha = (text) => (text === undefined ? 1 : text.endsWith('%') ? parseFloat(text) / 100 : parseFloat(text));

const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
const toHex = ({ r, g, b }) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

/** A colour as opaque #rrggbb; a translucent colour is laid over `over` (white when not given). */
export function opaqueHex(text, over = '#ffffff') {
  const color = parseColor(text);
  if (!color) throw new Error(`'${text}' is not a colour`);
  if (color.a >= 1) return toHex(color);
  const base = parseColor(opaqueHex(over));
  const mix = (top, bottom) => top * color.a + bottom * (1 - color.a);
  return toHex({ r: mix(color.r, base.r), g: mix(color.g, base.g), b: mix(color.b, base.b) });
}

function luminance(text) {
  const { r, g, b } = parseColor(opaqueHex(text));
  const [lr, lg, lb] = [r, g, b].map((v) => v / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

/** WCAG contrast ratio; a translucent foreground is laid over the background first. */
export function contrast(fg, bg) {
  const ground = opaqueHex(bg);
  const [a, b] = [luminance(opaqueHex(fg, ground)), luminance(ground)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

// OKLab, for a brand ramp that keeps its hue while it gets lighter and darker.
const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function toOklch(text) {
  const { r, g, b } = parseColor(opaqueHex(text));
  const [lr, lg, lb] = [r, g, b].map((v) => linear(v / 255));
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(A, B), H: Math.atan2(B, A) };
}
function fromOklch({ L, C, H }) {
  const A = C * Math.cos(H);
  const B = C * Math.sin(H);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ];
  return { inGamut: rgb.every((c) => c >= -0.0005 && c <= 1.0005), hex: toHex({ r: gamma(Math.max(0, Math.min(1, rgb[0]))) * 255, g: gamma(Math.max(0, Math.min(1, rgb[1]))) * 255, b: gamma(Math.max(0, Math.min(1, rgb[2]))) * 255 }) };
}
function inGamut(L, C, H) {
  let chroma = C;
  for (let i = 0; i < 60; i++) {
    const out = fromOklch({ L, C: chroma, H });
    if (out.inGamut) return out.hex;
    chroma *= 0.95;
  }
  return fromOklch({ L, C: 0, H }).hex;
}

/** A 16-step ramp, 10 (darkest) to 160 (lightest), with the key colour exactly at 80. */
export function brandRamp(key) {
  const { L, C, H } = toOklch(key);
  const ramp = {};
  const darkest = Math.min(0.2, L * 0.45);
  const lightest = Math.max(0.97, L);
  for (let step = 10; step <= 160; step += 10) {
    if (step === 80) { ramp[step] = opaqueHex(key); continue; }
    if (step < 80) {
      const t = (step - 10) / 70; // 0 at 10, 1 at 80
      ramp[step] = inGamut(darkest + (L - darkest) * t, C * (0.55 + 0.45 * t), H);
    } else {
      const t = (step - 80) / 80; // 0 at 80, 1 at 160
      ramp[step] = inGamut(L + (lightest - L) * (1 - (1 - t) ** 1.4), C * (1 - 0.85 * t), H);
    }
  }
  return ramp;
}

// ------------------------------------------------------------------------------------- loading

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

export function listSystems(root = defaultRoot) {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => existsSync(join(root, name, 'design-system.json')))
    .sort()
    .map((name) => {
      const manifest = readJson(join(root, name, 'design-system.json'));
      return { id: manifest.id, name: manifest.name, version: manifest.version, description: manifest.description, dir: join(root, name) };
    });
}

// A role is a job a colour does in every design system (background, text, accent...). Generators
// that are not the design system's own CSS (Fluent, Dataverse, email, video) work from roles, so
// they need nothing system-specific. A role a system leaves out falls back to a related one.
export const ROLES = {
  background: null, surface: null, text: null, textMuted: null, border: null, accent: null, textInverse: null, focus: null, danger: null,
  surfaceSubtle: 'surface', surfaceAlt: 'surface', textDisabled: 'textMuted', divider: 'border',
  accentHover: 'accent', accentPressed: 'accentHover', link: 'accent', linkHover: 'link', active: 'accent', highlight: 'active',
  dangerSurface: 'surface', successSurface: 'surface',
  heavy: 'accent', textOnHeavy: 'textInverse', heavyHover: 'heavy', heavyPressed: 'heavyHover', heavySelected: 'heavyPressed', focusOnHeavy: 'textOnHeavy'
};

/** Loads design-systems/<id> into a model with resolvers. Throws with a readable message. */
export function loadSystem(id, root = defaultRoot) {
  const dir = join(root, id);
  const manifestPath = join(dir, 'design-system.json');
  if (!existsSync(manifestPath)) {
    const known = listSystems(root).map((one) => one.id).join(', ') || 'none';
    throw new Error(`No design system '${id}' in ${root} (known: ${known})`);
  }
  const manifest = readJson(manifestPath);
  const tokens = readJson(join(dir, manifest.files?.tokens ?? 'tokens.json'));
  return model(manifest, tokens, dir);
}

/** The model over a manifest and a tokens.json (also used by the tests with in-memory data). */
export function model(manifest, tokens, dir = null) {
  const primitives = new Map();
  const semantic = new Map();
  for (const token of tokens.color?.tokens ?? []) {
    if (token.value && typeof token.value === 'object') semantic.set(token.name, token);
    else primitives.set(token.name, token);
  }
  const themeIds = (tokens.color?.themes ?? []).map((theme) => theme.id);

  function resolveToken(name, theme, seen = []) {
    if (seen.includes(name)) throw new Error(`token reference loop: ${[...seen, name].join(' -> ')}`);
    const primitive = primitives.get(name);
    if (primitive) return refOrValue(primitive.value, theme, [...seen, name]);
    const token = semantic.get(name);
    if (!token) throw new Error(`unknown token '${name}'`);
    const raw = token.value[theme];
    if (raw === undefined) throw new Error(`token '${name}' has no ${theme} value`);
    return refOrValue(raw, theme, [...seen, name]);
  }
  function refOrValue(raw, theme, seen) {
    const ref = /^\{([^}]+)\}$/.exec(String(raw).trim());
    return ref ? resolveToken(ref[1], theme, seen) : String(raw).trim();
  }
  /** A colour spec: "#hex", "token", "token@dark" (a fixed theme), resolved for `theme`. */
  function value(spec, theme) {
    if (spec === undefined || spec === null) return null;
    if (/^(#|rgb|hsl)/i.test(spec)) return spec;
    const [name, fixed] = String(spec).split('@');
    return resolveToken(name, fixed ?? theme);
  }
  function roleSpec(role) {
    let current = role;
    for (let i = 0; i < 10 && current; i++) {
      if (manifest.roles?.[current]) return manifest.roles[current];
      current = ROLES[current];
    }
    return null;
  }
  /** A role's colour as opaque hex for `theme` (translucent colours laid over the background role). */
  function role(name, theme) {
    const spec = roleSpec(name);
    if (!spec) throw new Error(`role '${name}' is not mapped in design-system.json`);
    const raw = value(spec, theme);
    const ground = name === 'background' ? '#ffffff' : opaqueHex(value(roleSpec('background'), theme));
    return opaqueHex(raw, ground);
  }
  return { manifest, tokens, dir, primitives, semantic, themeIds, resolveToken, value, role, roleSpec };
}

// ------------------------------------------------------------------------------------- check

/** Validates a design system. Returns { errors, known, findings, passed, notes }: known are the
 *  exceptions the design system documents; findings are shortfalls in the source that are recorded
 *  (documented: false) but not documented by the design system itself. Neither fails the check. */
export function checkSystem(ds) {
  const errors = [];
  const notes = [];
  const passed = [];
  const known = [];
  const findings = [];
  const { manifest, tokens } = ds;

  for (const field of ['id', 'name', 'version']) if (!manifest[field]) errors.push(`design-system.json: '${field}' is missing`);
  for (const theme of THEMES) if (!ds.themeIds.includes(theme)) errors.push(`tokens.json: color.themes has no '${theme}' theme`);

  // Unique names: every token becomes a CSS custom property, so names are unique across groups.
  const seen = new Map();
  const add = (name, group) => {
    if (!name) { errors.push(`${group}: a token without a name`); return; }
    if (seen.has(name)) errors.push(`token name '${name}' is used twice (${seen.get(name)} and ${group})`);
    else seen.set(name, group);
  };
  for (const token of tokens.color?.tokens ?? []) add(token.name, 'color');
  for (const group of ['spacing', 'radius', 'shadow']) for (const token of tokens[group]?.tokens ?? []) add(token.name, group);
  const styleNames = new Set();
  for (const group of tokens.type?.groups ?? []) for (const style of group.styles ?? []) {
    if (styleNames.has(style.name)) errors.push(`type style '${style.name}' is used twice`);
    styleNames.add(style.name);
  }

  // Every colour resolves; every semantic token has every theme.
  for (const [name, token] of ds.primitives) {
    try { if (!parseColor(ds.resolveToken(name, 'light'))) errors.push(`'${name}': '${token.value}' is not a colour`); } catch (error) { errors.push(`'${name}': ${error.message}`); }
  }
  for (const [name, token] of ds.semantic) {
    for (const theme of ds.themeIds) {
      if (token.value[theme] === undefined) { errors.push(`semantic token '${name}' has no ${theme} value`); continue; }
      try { if (!parseColor(ds.resolveToken(name, theme))) errors.push(`'${name}' (${theme}) does not resolve to a colour`); } catch (error) { errors.push(`'${name}' (${theme}): ${error.message}`); }
    }
    for (const theme of Object.keys(token.value)) if (!ds.themeIds.includes(theme)) errors.push(`semantic token '${name}' has a value for unknown theme '${theme}'`);
  }

  // Roles point at real tokens.
  for (const [roleName, spec] of Object.entries(manifest.roles ?? {})) {
    if (!(roleName in ROLES)) errors.push(`design-system.json: unknown role '${roleName}' (known: ${Object.keys(ROLES).join(', ')})`);
    for (const theme of THEMES) { try { ds.value(spec, theme); } catch (error) { errors.push(`role '${roleName}': ${error.message}`); } }
  }
  for (const [roleName, fallback] of Object.entries(ROLES)) if (fallback === null && !manifest.roles?.[roleName]) errors.push(`design-system.json: role '${roleName}' is required`);

  // Files the manifest names exist.
  if (ds.dir) {
    const files = [manifest.files?.tokens, manifest.files?.readme, manifest.files?.use, manifest.files?.wordTemplate, manifest.files?.fontLicence,
      ...Object.values(manifest.files?.components ?? {}).filter((one) => typeof one === 'string' && /\.(css|js|ts)$/.test(one)),
      ...Object.values(manifest.logos?.files ?? {}), ...(tokens.type?.fonts ?? []).map((font) => font.file)].filter(Boolean);
    for (const file of files) if (!existsSync(join(ds.dir, file))) errors.push(`file '${file}' named in the design system does not exist`);
  }

  // Contrast: documented pairs must pass in each theme they apply to; known exceptions are reported.
  const pairs = manifest.contrast?.pairs ?? [];
  if (!pairs.length) errors.push('design-system.json: contrast.pairs lists no pairs');
  for (const pair of pairs) {
    for (const theme of pair.themes ?? THEMES) {
      let ratio;
      try { ratio = contrast(ds.value(pair.fg, theme), ds.value(pair.bg, theme)); } catch (error) { errors.push(`contrast ${pair.fg} on ${pair.bg}: ${error.message}`); continue; }
      const line = `${pair.fg} on ${pair.bg} (${theme}): ${ratio.toFixed(2)}:1, needs ${pair.min}:1`;
      if (ratio + 1e-9 < pair.min) errors.push(`contrast ${line}`); else passed.push(line);
    }
  }
  for (const pair of manifest.contrast?.known ?? []) {
    for (const theme of pair.themes ?? THEMES) {
      try {
        const ratio = contrast(ds.value(pair.fg, theme), ds.value(pair.bg, theme));
        (pair.documented === false ? findings : known).push(`${pair.fg} on ${pair.bg} (${theme}): ${ratio.toFixed(2)}:1 against ${pair.min}:1; ${pair.reason}`);
      } catch (error) { errors.push(`known pair ${pair.fg} on ${pair.bg}: ${error.message}`); }
    }
    if (!pair.reason) errors.push(`known pair ${pair.fg} on ${pair.bg} needs a reason`);
  }

  // What the generated targets pair up must read too (only once the tokens themselves resolve).
  const tokensResolve = !errors.length;
  let pairsOfTargets = [];
  try { if (tokensResolve) pairsOfTargets = targetPairs(ds); } catch (error) { errors.push(`targets: ${error.message}`); }
  {
    for (const [label, fg, bg, min, themes] of pairsOfTargets) {
      for (const theme of themes) {
        let ratio;
        try { ratio = contrast(fg(theme), bg(theme)); } catch (error) { errors.push(`target ${label}: ${error.message}`); continue; }
        const line = `${label} (${theme}): ${ratio.toFixed(2)}:1, needs ${min}:1`;
        if (ratio + 1e-9 < min) errors.push(`target ${line}`); else passed.push(`target ${line}`);
      }
    }
  }

  // The Office mapping agrees with the tokens it names.
  try {
    const office = officeTheme(ds);
    for (const slot of office.mismatches ?? []) errors.push(`word template: ${slot}`);
  } catch (error) { errors.push(`office theme: ${error.message}`); }

  let charts = { light: [], dark: [] };
  try { if (tokensResolve) charts = chartPalette(ds); } catch (error) { errors.push(`charts: ${error.message}`); }
  for (const theme of ['light', 'dark']) {
    for (const series of charts[theme]) if (series.contrast < 3) notes.push(`chart series ${series.token ?? series.hex} (${theme}) is ${series.contrast.toFixed(2)}:1 against the background: label it directly and give the chart a table`);
  }
  return { errors, known, findings, passed, notes };
}

/** Pairs the generated outputs rely on: [label, fg(theme), bg(theme), min, themes]. */
function targetPairs(ds) {
  const r = (name) => (theme) => ds.role(name, theme);
  const pairs = [
    ['email/fluent: textInverse on accent (button)', r('textInverse'), r('accent'), 4.5, THEMES],
    ['email/fluent: textInverse on accentHover', r('textInverse'), r('accentHover'), 4.5, THEMES],
    ['email: text on background', r('text'), r('background'), 4.5, THEMES],
    ['email: textOnHeavy on heavy (header)', r('textOnHeavy'), r('heavy'), 4.5, THEMES],
    ['dataverse header: textOnHeavy on heavyHover', r('textOnHeavy'), r('heavyHover'), 4.5, ['light']],
    ['dataverse header: textOnHeavy on heavyPressed', r('textOnHeavy'), r('heavyPressed'), 4.5, ['light']],
    ['dataverse header: textOnHeavy on heavySelected', r('textOnHeavy'), r('heavySelected'), 4.5, ['light']]
  ];
  const video = videoColors(ds);
  pairs.push(['video: text on background', () => video.text, () => video.background, 4.5, ['light']]);
  pairs.push(['video: onAccent on accent', () => video.onAccent, () => video.accent, 4.5, ['light']]);
  return pairs;
}

// ------------------------------------------------------------------------------------- targets

const banner = (ds, comment) => {
  const text = `Generated by scripts/design-system.mjs from design-systems/${ds.manifest.id} (${ds.manifest.name} ${ds.manifest.version}). Do not edit; change the design system and regenerate.`;
  return comment === 'css' ? `/* ${text} */\n` : comment === 'xml' ? `<!-- ${text} -->\n` : `// ${text}\n`;
};

const quoteFamily = (stack) => stack.split(',').map((one) => one.trim()).filter(Boolean)
  .map((one) => (/^["']/.test(one) || /^[a-z-]+$/i.test(one) ? one : `"${one}"`)).join(', ');

/** Every type style with its family resolved and a smaller size below a width, if its usage says so. */
function typeStyles(ds) {
  const families = ds.tokens.type?.families ?? {};
  const styles = [];
  for (const group of ds.tokens.type?.groups ?? []) {
    for (const style of group.styles ?? []) {
      const familyKey = style.family ?? group.family ?? 'sans';
      const step = /steps? down to (\d+)px below (\d+)px/i.exec(style.usage ?? '');
      styles.push({ ...style, familyKey, familyStack: families[familyKey] ?? families.sans ?? 'system-ui, sans-serif', smaller: step ? { fontSize: `${step[1]}px`, below: +step[2] } : null });
    }
  }
  return styles;
}

const unit = (v) => (typeof v === 'number' ? String(v) : v);

/** tokens.css: semantic colours per theme, then everything theme-independent, then a few base rules. */
export function css(ds) {
  const out = [banner(ds, 'css')];
  out.push('/* Light is the default; dark follows the system unless the user chose (data-theme on <html>).\n   The two dark blocks are identical on purpose; the theme contract test checks that. */\n');
  for (const font of ds.tokens.type?.fonts ?? []) {
    out.push(`@font-face {\n  font-family: "${font.family}";\n  src: url("fonts/${basename(font.file)}") format("woff2");\n  font-weight: ${font.weight};\n  font-style: ${font.style ?? 'normal'};\n  font-display: swap;\n}\n`);
  }
  const semanticBlock = (theme, indent) => [...ds.semantic.keys()].map((name) => `${indent}--${name}: ${ds.resolveToken(name, theme)};`).join('\n');
  out.push(`:root {\n  color-scheme: light;\n${semanticBlock('light', '  ')}\n}\n`);
  out.push(`@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {\n    color-scheme: dark;\n${semanticBlock('dark', '    ')}\n  }\n}\n`);
  out.push(`:root[data-theme="dark"] {\n  color-scheme: dark;\n${semanticBlock('dark', '  ')}\n}\n`);

  const shared = [];
  for (const [name] of ds.primitives) shared.push(`  --${name}: ${ds.resolveToken(name, 'light')};`);
  for (const [key, stack] of Object.entries(ds.tokens.type?.families ?? {})) shared.push(`  --font-${key}: ${quoteFamily(stack)};`);
  for (const group of ['spacing', 'radius', 'shadow']) for (const token of ds.tokens[group]?.tokens ?? []) shared.push(`  --${token.name}: ${token.value};`);
  const styles = typeStyles(ds);
  for (const style of styles) {
    shared.push(`  --type-${style.name}-family: var(--font-${style.familyKey});`);
    shared.push(`  --type-${style.name}-size: ${unit(style.fontSize)};`);
    shared.push(`  --type-${style.name}-line-height: ${unit(style.lineHeight)};`);
    shared.push(`  --type-${style.name}-weight: ${style.fontWeight};`);
    if (style.letterSpacing !== undefined) shared.push(`  --type-${style.name}-letter-spacing: ${unit(style.letterSpacing)};`);
  }
  // Roles: the same names in every design system, for code that should survive a switch.
  for (const roleName of Object.keys(ROLES)) {
    const spec = ds.roleSpec(roleName);
    if (spec && !/^(#|rgb|hsl)/i.test(spec) && !spec.includes('@')) shared.push(`  --ds-${kebab(roleName)}: var(--${spec});`);
    else if (spec) shared.push(`  --ds-${kebab(roleName)}: ${ds.value(spec, 'light')};`);
  }
  out.push(`/* Theme-independent: palette, fonts, spacing, radius, shadow, type scale and role aliases (--ds-*). */\n:root {\n${shared.join('\n')}\n}\n`);

  const smaller = styles.filter((style) => style.smaller);
  for (const below of [...new Set(smaller.map((style) => style.smaller.below))]) {
    out.push(`@media (max-width: ${below - 0.02}px) {\n  :root {\n${smaller.filter((style) => style.smaller.below === below).map((style) => `    --type-${style.name}-size: ${style.smaller.fontSize};`).join('\n')}\n  }\n}\n`);
  }
  for (const style of styles) {
    const lines = [`  font-family: var(--type-${style.name}-family);`, `  font-size: var(--type-${style.name}-size);`, `  line-height: var(--type-${style.name}-line-height);`, `  font-weight: var(--type-${style.name}-weight);`];
    if (style.letterSpacing !== undefined) lines.push(`  letter-spacing: var(--type-${style.name}-letter-spacing);`);
    if (style.fontStyle) lines.push(`  font-style: ${style.fontStyle};`);
    out.push(`.type-${style.name} {\n${lines.join('\n')}\n}\n`);
  }
  const body = ds.tokens.type?.families?.sans ? '  font-family: var(--font-sans);\n' : '';
  out.push(`/* Base: the page colours (zero specificity, so app styles win), a visible focus ring of at least
   3:1 (2.4.7, 1.4.11) and less motion for those who ask for it (2.3.3). */
:where(html) {
  background-color: var(--ds-background);
  color: var(--ds-text);
${body}}

:focus-visible {
  outline: 2px solid var(--ds-focus);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
`);
  return out.join('\n');
}

const kebab = (name) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** The tokens for JavaScript and for the theme contract test: resolved per theme, plus the pairs. */
export function tokensJson(ds) {
  const themes = Object.fromEntries(THEMES.map((theme) => [theme, Object.fromEntries([...ds.semantic.keys()].map((name) => [name, ds.resolveToken(name, theme)]))]));
  const roles = Object.fromEntries(THEMES.map((theme) => [theme, Object.fromEntries(Object.keys(ROLES).filter((name) => ds.roleSpec(name)).map((name) => [name, ds.role(name, theme)]))]));
  return {
    $comment: banner(ds, 'json').slice(3).trim(),
    designSystem: { id: ds.manifest.id, name: ds.manifest.name, version: ds.manifest.version },
    themes,
    roles,
    palette: Object.fromEntries([...ds.primitives.keys()].map((name) => [name, ds.resolveToken(name, 'light')])),
    fonts: { families: ds.tokens.type?.families ?? {}, files: (ds.tokens.type?.fonts ?? []).map((font) => ({ ...font, file: `fonts/${basename(font.file)}` })) },
    type: Object.fromEntries(typeStyles(ds).map(({ name, familyKey, fontSize, lineHeight, fontWeight, letterSpacing, fontStyle, smaller }) => [name, { family: familyKey, fontSize, lineHeight, fontWeight, letterSpacing, fontStyle, smaller }])),
    spacing: Object.fromEntries((ds.tokens.spacing?.tokens ?? []).map((token) => [token.name, token.value])),
    radius: Object.fromEntries((ds.tokens.radius?.tokens ?? []).map((token) => [token.name, token.value])),
    shadow: Object.fromEntries((ds.tokens.shadow?.tokens ?? []).map((token) => [token.name, token.value])),
    contrast: { pairs: ds.manifest.contrast?.pairs ?? [], known: ds.manifest.contrast?.known ?? [] }
  };
}

export function ts(ds) {
  const data = tokensJson(ds);
  delete data.$comment;
  return `${banner(ds, 'ts')}
export const designSystem = ${JSON.stringify(data, null, 2)} as const;

export type ThemeName = keyof typeof designSystem.themes;
export type ColorToken = keyof typeof designSystem.themes.light;
export type Role = keyof typeof designSystem.roles.light;

/** A token as a CSS custom property reference, for inline styles: cssVar('text-primary'). */
export const cssVar = (name: ColorToken | Role | string): string => \`var(--\${name})\`;

/** A resolved colour for places that cannot use CSS variables (canvas, charts, emails). */
export const color = (name: ColorToken, theme: ThemeName = 'light'): string => designSystem.themes[theme][name];

/** A role's colour: the same names in every design system. */
export const role = (name: Role, theme: ThemeName = 'light'): string => designSystem.roles[theme][name];
`;
}

// Fluent UI v9: a BrandVariants ramp (10-160) and overrides that put the design system's semantic
// colours on the Fluent tokens the controls read.
const FLUENT = {
  colorNeutralBackground1: 'surface', colorNeutralBackground2: 'surfaceSubtle', colorNeutralBackground3: 'surfaceAlt',
  colorNeutralForeground1: 'text', colorNeutralForeground2: 'textMuted', colorNeutralForeground3: 'textMuted', colorNeutralForegroundDisabled: 'textDisabled',
  colorNeutralStroke1: 'border', colorNeutralStroke2: 'divider',
  colorBrandBackground: 'accent', colorBrandBackgroundHover: 'accentHover', colorBrandBackgroundPressed: 'accentPressed', colorNeutralForegroundOnBrand: 'textInverse',
  colorBrandForeground1: 'link', colorBrandForegroundLink: 'link', colorBrandForegroundLinkHover: 'linkHover', colorCompoundBrandStroke: 'active',
  colorStrokeFocus2: 'focus', colorPaletteRedForeground1: 'danger', colorPaletteRedBackground1: 'dangerSurface', colorPaletteGreenBackground1: 'successSurface'
};

export function fluent(ds) {
  const brand = brandRamp(ds.value(ds.manifest.brandColor ?? ds.roleSpec('accent'), 'light'));
  const overrides = Object.fromEntries(THEMES.map((theme) => [theme, Object.fromEntries(Object.entries(FLUENT).map(([token, roleName]) => [token, ds.role(roleName, theme)]))]));
  const families = ds.tokens.type?.families ?? {};
  const fonts = {};
  if (families.sans) fonts.fontFamilyBase = quoteFamily(families.sans);
  if (families.mono) fonts.fontFamilyMonospace = quoteFamily(families.mono);
  const radius = Object.fromEntries((ds.tokens.radius?.tokens ?? []).map((token) => [token.name, token.value]));
  if (radius['radius-sm']) fonts.borderRadiusMedium = radius['radius-sm'];
  return { brand, light: { ...overrides.light, ...fonts }, dark: { ...overrides.dark, ...fonts }, mapping: FLUENT };
}

export function fluentTs(ds) {
  const theme = fluent(ds);
  return `${banner(ds, 'ts')}// Fluent UI v9 themes for React and PCF code components:
//   <FluentProvider theme={lightTheme}> ... or darkTheme when the user or the system chose dark.
// In a model-driven app a PCF control should normally follow the host's theme
// (context.fluentDesignLanguage); use these where the component must carry the brand itself.
import { createDarkTheme, createLightTheme, type BrandVariants, type Theme } from '@fluentui/react-components';

export const brand: BrandVariants = ${JSON.stringify(theme.brand, null, 2)};

export const lightTheme: Theme = {
  ...createLightTheme(brand),
  ...${JSON.stringify(theme.light, null, 2).replace(/\n/g, '\n  ')}
};

export const darkTheme: Theme = {
  ...createDarkTheme(brand),
  ...${JSON.stringify(theme.dark, null, 2).replace(/\n/g, '\n  ')}
};
`;
}

// Dataverse model-driven apps (modern look): a CustomTheme XML web resource for the "Custom theme
// definition" setting, with the 16 palette slots set from the same ramp (darker70..primary..lighter80)
// and the app header colours. Format: learn.microsoft.com/power-apps/maker/model-driven-apps/modern-theme-overrides
const SLOTS = ['darker70', 'darker60', 'darker50', 'darker40', 'darker30', 'darker20', 'darker10', 'primary', 'lighter10', 'lighter20', 'lighter30', 'lighter40', 'lighter50', 'lighter60', 'lighter70', 'lighter80'];

export function dataverse(ds) {
  const brand = fluent(ds).brand;
  const palette = Object.fromEntries(SLOTS.map((slot, index) => [slot, brand[(index + 1) * 10].toUpperCase()]));
  const header = {
    background: ds.role('heavy', 'light'), foreground: ds.role('textOnHeavy', 'light'),
    backgroundHover: ds.role('heavyHover', 'light'), foregroundHover: ds.role('textOnHeavy', 'light'),
    backgroundPressed: ds.role('heavyPressed', 'light'), foregroundPressed: ds.role('textOnHeavy', 'light'),
    backgroundSelected: ds.role('heavySelected', 'light'), foregroundSelected: ds.role('textOnHeavy', 'light')
  };
  for (const key of Object.keys(header)) header[key] = header[key].toUpperCase();
  const font = (ds.tokens.type?.families?.sans ?? 'Segoe UI, sans-serif').split(',').map((one) => one.trim()).map((one) => (/\s/.test(one) && !/^['"]/.test(one) ? `'${one}'` : one)).join(', ');
  return {
    customTheme: { basePaletteColor: palette.primary, lockPrimary: 'true', font, ...palette },
    appHeaderColors: header,
    notes: [
      'Upload dataverse-theme.xml as a Data (XML) web resource and set it in the "Custom theme definition" setting (or dataverse-app-header.xml in "Override app header color" for the header only). The Custom theme definition wins when both are set.',
      'Model-driven apps have no dark mode for custom themes; the light values are used.',
      `The font only renders where it is installed or already loaded; model-driven apps do not load the design system's web fonts.`,
      'For a logo, add an image web resource (about 156 x 48 px, the lockup for the header background) and add logoWebResource="<prefix>_<name>" and logoTooltip to CustomTheme.'
    ]
  };
}

const xmlAttrs = (object, indent) => Object.entries(object).map(([key, value]) => `${indent}${key}="${String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`).join('\n');

export function dataverseXml(ds) {
  const theme = dataverse(ds);
  return `${banner(ds, 'xml')}<CustomTheme\n${xmlAttrs(theme.customTheme, '    ')}\n>\n  <AppHeaderColors\n${xmlAttrs(theme.appHeaderColors, '    ')}\n  />\n</CustomTheme>\n`;
}

export function dataverseHeaderXml(ds) {
  return `${banner(ds, 'xml')}<AppHeaderColors\n${xmlAttrs(dataverse(ds).appHeaderColors, '  ')}\n/>\n`;
}

// Emails: opaque hex only (clients drop variables and mangle alpha), light and dark.
export function email(ds) {
  const pick = (theme) => ({
    background: ds.role('background', theme), surface: ds.role('surface', theme), text: ds.role('text', theme), textMuted: ds.role('textMuted', theme),
    link: ds.role('link', theme), border: ds.role('border', theme), divider: ds.role('divider', theme), danger: ds.role('danger', theme),
    buttonBackground: ds.role('accent', theme), buttonText: ds.role('textInverse', theme),
    headerBackground: ds.role('heavy', theme), headerText: ds.role('textOnHeavy', theme)
  });
  const logos = ds.manifest.logos?.files ?? {};
  return {
    light: pick('light'),
    dark: pick('dark'),
    fontFamily: quoteFamily(ds.tokens.type?.families?.sans ?? 'Arial, sans-serif'),
    logo: { onHeader: logos.lockupOnDarkPng ?? null, onLight: logos.lockupOnLightPng ?? null },
    notes: [
      'Use the light values inline; repeat the dark ones in a @media (prefers-color-scheme: dark) block in <style>, with <meta name="color-scheme" content="light dark">.',
      'Logos in emails are PNG (many clients do not show SVG), served over https from the product, with width and height set and alt text.',
      'Web fonts do not load in most mail clients; the stack falls back to the next font.'
    ].concat(ds.manifest.logos?.rules ? ['Logo rules: see the design system (clear space, minimum size, never recolour).'] : [])
  };
}

export function chartPalette(ds) {
  const charts = ds.manifest.charts ?? {};
  const series = (theme) => (charts[theme] ?? charts.light ?? []).map((spec) => {
    const hex = opaqueHex(ds.value(spec, theme));
    return { token: /^#/.test(spec) ? null : spec.split('@')[0], hex, contrast: Math.round(contrast(hex, ds.role('background', theme)) * 100) / 100 };
  });
  return {
    source: charts.source ?? null,
    light: series('light'),
    dark: series('dark'),
    notes: ['Use the series in this order. Give every chart a table and label series directly; colour alone never carries the meaning. Series under 3:1 against the background need a direct label.']
  };
}

function videoColors(ds) {
  const spec = ds.manifest.video ?? {};
  const pick = (key, fallback) => opaqueHex(ds.value(spec[key] ?? fallback, 'light'));
  return {
    background: pick('background', `${ds.roleSpec('heavy')}`),
    backgroundAlt: pick('backgroundAlt', ds.roleSpec('heavyHover')),
    accent: pick('accent', ds.roleSpec('accent')),
    accentAlt: pick('accentAlt', ds.roleSpec('accentHover')),
    text: pick('text', ds.roleSpec('textOnHeavy')),
    textMuted: pick('textMuted', ds.roleSpec('textOnHeavy')),
    onAccent: pick('onAccent', ds.roleSpec('textInverse')),
    highlight: pick('highlight', ds.roleSpec('active'))
  };
}

/** The brand block for tools/video-tour (`brand` in video-tour.config.json). `base` prefixes paths. */
export function video(ds, base) {
  const spec = ds.manifest.video ?? {};
  const family = spec.font?.family ?? (ds.tokens.type?.families?.sans ?? 'Inter').split(',')[0].trim();
  const fontFile = spec.font?.file ?? null;
  const logo = spec.logo ? ds.manifest.logos?.files?.[spec.logo] ?? spec.logo : null;
  return {
    designSystem: ds.manifest.id,
    colors: videoColors(ds),
    font: { family, file: fontFile ? base(fontFile, 'font') : null },
    logo: logo ? base(logo, 'logo') : null
  };
}

// Office (Word, PowerPoint): the theme slots. A design system with a Word template description
// (word-template.md) is read from its Theme table; otherwise the manifest's office block is used.
export function officeTheme(ds) {
  const spec = ds.manifest.office ?? {};
  const colors = {};
  const fonts = { major: spec.fonts?.major ?? null, minor: spec.fonts?.minor ?? null };
  const mismatches = [];
  const result = { source: null, fonts, colors };
  const templatePath = ds.dir && ds.manifest.files?.wordTemplate ? join(ds.dir, ds.manifest.files.wordTemplate) : null;
  if (templatePath && existsSync(templatePath)) {
    const text = readFileSync(templatePath, 'utf8');
    result.source = ds.manifest.files.wordTemplate;
    const cells = (line) => line.split('|').slice(1, -1).map((cell) => cell.trim().replace(/`/g, ''));
    for (const line of text.split(/\r?\n/).filter((one) => one.startsWith('|'))) {
      const [slot, value, token] = cells(line);
      if (/^(dk1|lt1|dk2|lt2|accent[1-6]|hlink|folHlink)$/.test(slot) && /^#[0-9a-f]{6}$/i.test(value)) {
        colors[slot] = value.toUpperCase();
        if (token && ds.primitives.has(token) && opaqueHex(ds.resolveToken(token, 'light')).toUpperCase() !== value.toUpperCase()) mismatches.push(`${slot} is ${value} but ${token} is ${ds.resolveToken(token, 'light')}`);
      }
      if (/^major font/i.test(slot)) fonts.major ??= value;
      if (/^minor font/i.test(slot)) fonts.minor ??= value;
    }
    const page = /^## Page\s+([\s\S]*?)(?=\n## )/m.exec(text);
    if (page) result.page = page[1].trim().replace(/\s*\n\s*/g, ' ');
    const styles = /^## Styles to write against[\s\S]*?(\|[\s\S]*?)\n\n/m.exec(text);
    if (styles) {
      result.styles = styles[1].split(/\r?\n/).filter((line) => line.startsWith('|') && !/^\|\s*-/.test(line)).slice(1)
        .map((line) => { const [name, size, color, use] = cells(line); return { name, size: size === '—' ? null : size, color: color === '—' ? null : color, use }; });
    }
    const classification = /^## Footer classification[\s\S]*?((?:^- .*\n?)+)/m.exec(text);
    if (classification) result.classification = classification[1].trim().split('\n').map((line) => line.replace(/^- /, '').replace(/\.$/, ''));
  }
  for (const [slot, value] of Object.entries(spec.colors ?? {})) colors[slot] ??= opaqueHex(ds.value(value, 'light')).toUpperCase();
  for (const slot of ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink']) {
    if (!colors[slot]) throw new Error(`no colour for Office slot ${slot} (add it to office.colors in design-system.json)`);
  }
  result.colors = Object.fromEntries(['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'].map((slot) => [slot, colors[slot]]));
  if (!fonts.major || !fonts.minor) throw new Error('no Office fonts (office.fonts.major and .minor in design-system.json)');
  if (mismatches.length) result.mismatches = mismatches;
  return result;
}

// ------------------------------------------------------------------------------------- build

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

/** Writes the chosen targets into `out`. Returns the list of files written (relative to out). */
export function build(ds, out, targets = TARGETS) {
  const unknown = targets.filter((target) => !TARGETS.includes(target));
  if (unknown.length) throw new Error(`unknown target(s): ${unknown.join(', ')} (known: ${TARGETS.join(', ')})`);
  const { errors } = checkSystem(ds);
  if (errors.length) throw new Error(`design system '${ds.manifest.id}' does not pass its check:\n  ${errors.join('\n  ')}`);
  mkdirSync(out, { recursive: true });
  const written = [];
  const write = (name, content) => { mkdirSync(dirname(join(out, name)), { recursive: true }); writeFileSync(join(out, name), content); written.push(name); };
  const copy = (from, to) => { mkdirSync(dirname(join(out, to)), { recursive: true }); copyFileSync(join(ds.dir, from), join(out, to)); written.push(to); };

  write('tokens.json', json(tokensJson(ds)));
  if (targets.includes('css')) write('tokens.css', css(ds));
  if (targets.includes('ts')) write('tokens.ts', ts(ds));
  if (targets.includes('fluent')) { write('fluent-theme.ts', fluentTs(ds)); write('fluent-theme.json', json(fluent(ds))); }
  if (targets.includes('dataverse')) { write('dataverse-theme.xml', dataverseXml(ds)); write('dataverse-app-header.xml', dataverseHeaderXml(ds)); write('dataverse-theme.json', json(dataverse(ds))); }
  if (targets.includes('email')) write('email-palette.json', json(rewritePaths(email(ds), (path) => `logos/${basename(path)}`)));
  if (targets.includes('charts')) write('chart-palette.json', json(chartPalette(ds)));
  if (targets.includes('video')) write('video-brand.json', json(video(ds, (path, kind) => (kind === 'font' ? `fonts/${basename(path)}` : `logos/${basename(path)}`))));
  if (targets.includes('office')) write('office-theme.json', json(officeTheme(ds)));

  // The files the outputs point at travel with them, so the output folder works on its own.
  const fonts = ds.tokens.type?.fonts ?? [];
  if (fonts.length && targets.some((target) => ['css', 'video'].includes(target))) {
    for (const font of fonts) copy(font.file, `fonts/${basename(font.file)}`);
    if (ds.manifest.files?.fontLicence) copy(ds.manifest.files.fontLicence, 'fonts/LICENCE.txt');
  }
  const logos = Object.values(ds.manifest.logos?.files ?? {});
  if (logos.length && targets.some((target) => ['css', 'email', 'video'].includes(target))) for (const logo of [...new Set(logos)]) copy(logo, `logos/${basename(logo)}`);
  if (ds.manifest.files?.use) copy(ds.manifest.files.use, 'BRAND-USE.md');
  return written;
}

function rewritePaths(object, rewrite) {
  const copy = structuredClone(object);
  for (const key of Object.keys(copy.logo ?? {})) if (copy.logo[key]) copy.logo[key] = rewrite(copy.logo[key]);
  return copy;
}

/** One target as text, with paths absolute (for tools that read a design system directly). */
export function show(ds, target) {
  const abs = (path) => resolve(ds.dir, path);
  switch (target) {
    case 'css': return css(ds);
    case 'ts': return ts(ds);
    case 'json': return json(tokensJson(ds));
    case 'fluent': return json(fluent(ds));
    case 'dataverse': return dataverseXml(ds);
    case 'email': return json(rewritePaths(email(ds), abs));
    case 'charts': return json(chartPalette(ds));
    case 'video': return json(video(ds, abs));
    case 'office': return json(officeTheme(ds));
    default: throw new Error(`unknown target '${target}' (known: json, ${TARGETS.join(', ')})`);
  }
}

// ------------------------------------------------------------------------------------- CLI

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const [key, inline] = arg.slice(2).split('=');
      if (inline !== undefined) args[key] = inline;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) args[key] = argv[++i];
      else args[key] = true;
    } else args._.push(arg);
  }
  return args;
}

function main(argv) {
  const args = parseArgs(argv);
  const [command, id] = args._;
  const root = args.root ? resolve(args.root) : defaultRoot;
  const usage = 'Usage:\n  design-system.mjs list\n  design-system.mjs build <id> --out <dir> [--targets css,ts,fluent,dataverse,email,charts,video,office]\n  design-system.mjs check <id> [--json]\n  design-system.mjs show <id> --target <target>\nOptions: --root <folder with design systems>';
  if (command === 'list') {
    const systems = listSystems(root);
    if (args.json) { process.stdout.write(json(systems.map(({ dir, ...rest }) => rest))); return 0; }
    for (const one of systems) console.log(`${one.id.padEnd(20)} ${one.name} ${one.version}  ${one.description ?? ''}`);
    if (!systems.length) console.log(`No design systems in ${root}`);
    return 0;
  }
  if (!['build', 'check', 'show'].includes(command) || !id) { console.error(usage); return 2; }
  const ds = loadSystem(id, root);
  if (command === 'check') {
    const result = checkSystem(ds);
    if (args.json) { process.stdout.write(json(result)); return result.errors.length ? 1 : 0; }
    console.log(`${ds.manifest.name} ${ds.manifest.version}: ${result.passed.length} contrast checks passed, ${result.known.length} known exceptions, ${result.findings.length} findings in the source, ${result.errors.length} problems`);
    for (const line of result.known) console.log(`  known: ${line}`);
    for (const line of result.findings) console.log(`  finding: ${line}`);
    for (const line of result.notes) console.log(`  note: ${line}`);
    for (const line of result.errors) console.log(`  FAIL: ${line}`);
    return result.errors.length ? 1 : 0;
  }
  if (command === 'show') {
    if (!args.target) { console.error(usage); return 2; }
    process.stdout.write(show(ds, args.target));
    return 0;
  }
  if (!args.out || args.out === true) { console.error('build needs --out <dir>'); return 2; }
  const targets = typeof args.targets === 'string' ? args.targets.split(',').map((one) => one.trim()).filter(Boolean) : TARGETS;
  const out = resolve(args.out);
  const written = build(ds, out, targets);
  console.log(`${ds.manifest.name} ${ds.manifest.version} -> ${relative(process.cwd(), out) || '.'}: ${written.length} files (${targets.join(', ')})`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
