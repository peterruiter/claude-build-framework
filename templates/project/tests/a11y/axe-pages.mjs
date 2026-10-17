#!/usr/bin/env node
// ===========================================================================
// Accessibility check: axe-core over the pages in tests/a11y/pages.json, in
// light and dark, at each width, against a running local app with demo data.
// Rules: WCAG 2.0, 2.1 and 2.2 A and AA. Optional probes (--probes) for what
// axe cannot see: skip link first, one h1, lang, visible focus on the first
// tab stops, focus not hidden behind a sticky bar, 24px targets, no sideways
// scrolling.
//
//   node tests/a11y/axe-pages.mjs [--config tests/a11y/pages.json] [--base http://127.0.0.1:5080]
//        [--widths 1440,390] [--themes light,dark] [--page name-part] [--probes [strict]]
//        [--json out.json]
//
// Playwright and axe-core are not dependencies of the product. Install them
// anywhere, pinned, and point A11Y_TOOLS at that folder (default:
// tests/a11y/node_modules):
//
//   npm i --prefix <folder> playwright@<pinned> axe-core@<pinned>
//
// The browser is Playwright's Chromium, or a channel from the config or
// --channel (msedge, chrome) so nothing is downloaded. A violation fails the
// run (exit 1) unless allowed in tests/a11y/known.json with its reason; keep
// that list in step with the accessibility statement's known limitations.
// ===========================================================================
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => {
  if (value.startsWith('--')) pairs.push([value.slice(2), all[index + 1]?.startsWith('--') || all[index + 1] === undefined ? 'true' : all[index + 1]]);
  return pairs;
}, []));

const configPath = resolve(args.config ?? resolve(here, 'pages.json'));
const config = JSON.parse(await readFile(configPath, 'utf8'));
const tools = resolve(process.env.A11Y_TOOLS ?? resolve(here, 'node_modules'));
if (!existsSync(resolve(tools, 'node_modules', 'playwright')) && !existsSync(resolve(tools, 'playwright'))) {
  console.error(`Playwright not found under ${tools}. npm i --prefix <folder> playwright@<pinned> axe-core@<pinned> and set A11Y_TOOLS=<folder>.`);
  process.exit(2);
}
const require = createRequire(resolve(tools, 'package.json'));
const { chromium } = require('playwright');
const axeSource = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8');

const base = (args.base ?? config.base ?? 'http://127.0.0.1:5080').replace(/\/$/, '');
const widths = (args.widths ?? (config.widths ?? [1440, 390]).join(',')).split(',').map(Number);
const themes = (args.themes ?? (config.themes ?? ['light', 'dark']).join(',')).split(',');
const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];
const knownPath = resolve(dirname(configPath), config.known ?? 'known.json');
const known = existsSync(knownPath) ? JSON.parse(await readFile(knownPath, 'utf8')) : { allow: [] };
const pages = (config.pages ?? []).filter((page) => !args.page || page.name.includes(args.page));
const signInModule = config.signIn ? (await import(pathToFileURL(resolve(dirname(configPath), config.signIn)).href)).default : null;
const allowed = (id, name, nodes = []) => known.allow.find((rule) => rule.id === id && (!rule.page || name.includes(rule.page))
  && (!rule.target || nodes.every((node) => node.target.includes(rule.target))))?.reason ?? null;

/** Waits until the page has content and no loading indicators, then a breath for late paints. */
async function settle(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => document.querySelector('main, #root, body')?.textContent?.trim().length > 0, null, { timeout: 15000 }).catch(() => undefined);
  await page.waitForFunction((busy) => !document.querySelector(busy), config.busySelector ?? '.skeleton, .loading, .spinner, [aria-busy="true"]', { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(config.settleMs ?? 500);
}

/** What axe cannot see, measured in the page. */
async function probe(page, entry) {
  const found = [];
  const facts = await page.evaluate(() => {
    const visible = (element) => { const box = element.getBoundingClientRect(); const style = getComputedStyle(element); return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'; };
    const name = (element) => `${element.tagName.toLowerCase()}${element.id ? '#' + element.id : ''} "${(element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 30)}"`;
    const interactive = [...document.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="tab"], [role="checkbox"], [role="radio"], [role="switch"], [tabindex]:not([tabindex="-1"])')]
      .filter((element) => visible(element) && !element.closest('[aria-hidden="true"], [inert]'));
    const boxes = interactive.map((element) => ({ element, box: element.getBoundingClientRect() }));
    const small = [];
    for (const { element, box } of boxes) {
      if (box.width >= 24 && box.height >= 24) continue;
      if (element.tagName === 'A' && getComputedStyle(element).display === 'inline') continue; // a link in a sentence
      const cx = box.left + box.width / 2; const cy = box.top + box.height / 2;
      const crowded = boxes.some((other) => other.element !== element && !other.element.contains(element) && !element.contains(other.element) && (() => {
        const ox = Math.max(other.box.left, Math.min(cx, other.box.right)); const oy = Math.max(other.box.top, Math.min(cy, other.box.bottom));
        return Math.hypot(ox - cx, oy - cy) < (other.box.width >= 24 && other.box.height >= 24 ? 12 : 24);
      })());
      if (crowded) small.push(`${name(element)} ${Math.round(box.width)}x${Math.round(box.height)}`);
    }
    const overflow = document.scrollingElement.scrollWidth > document.documentElement.clientWidth + 1 ? `${document.scrollingElement.scrollWidth} > ${document.documentElement.clientWidth}` : null;
    return { lang: document.documentElement.lang, h1: document.querySelectorAll('h1, [role="heading"][aria-level="1"]').length, small: small.slice(0, 10), smallCount: small.length, overflow };
  });
  if (entry.lang && facts.lang !== entry.lang) found.push({ check: 'lang', detail: `lang="${facts.lang}", expected ${entry.lang}` });
  if (facts.h1 !== 1) found.push({ check: 'h1', detail: `${facts.h1} h1 elements` });
  if (facts.smallCount) found.push({ check: 'target-size', detail: `${facts.smallCount}: ${facts.small.join('; ')}` });
  if (facts.overflow) found.push({ check: 'reflow', detail: facts.overflow });

  // The first tab stops from the top of the page: skip link first, a visible change on each, none covered.
  await page.evaluate(() => { window.scrollTo(0, 0); const start = document.createElement('span'); start.tabIndex = -1; document.body.prepend(start); start.focus(); start.remove(); });
  const stops = [];
  for (let press = 0; press < 25; press++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element || element === document.body) return null;
      const style = getComputedStyle(element);
      const ringed = (one) => one && ((getComputedStyle(one).outlineStyle !== 'none' && parseFloat(getComputedStyle(one).outlineWidth) > 0) || getComputedStyle(one).boxShadow !== 'none');
      const ring = (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none' || ringed(element.parentElement) || ringed(element.closest('label'));
      const box = element.getBoundingClientRect();
      const points = [[box.left + box.width / 2, box.top + box.height / 2], [box.left + 2, box.top + 2], [box.right - 2, box.bottom - 2]];
      const covered = box.width > 0 && box.top < innerHeight && box.bottom > 0 && points.every(([x, y]) => { const top = document.elementFromPoint(x, y); return top && !element.contains(top) && !top.contains(element); });
      const label = `${element.tagName.toLowerCase()} "${(element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 30)}"`;
      return { label, ring, covered, skip: /skip/i.test(element.className) || /^#(main|content)$/.test(element.getAttribute('href') ?? '') };
    });
    if (stop) stops.push(stop);
  }
  if (entry.skipLink !== false && !stops[0]?.skip) found.push({ check: 'skip-link', detail: `first stop ${stops[0]?.label ?? 'none'}` });
  const unringed = [...new Set(stops.filter((stop) => !stop.ring).map((stop) => stop.label))];
  if (unringed.length) found.push({ check: 'focus-visible', detail: unringed.slice(0, 8).join('; ') });
  const obscured = [...new Set(stops.filter((stop) => stop.covered).map((stop) => stop.label))];
  if (obscured.length) found.push({ check: 'focus-obscured', detail: obscured.slice(0, 8).join('; ') });
  return found;
}

const browser = await chromium.launch(args.channel ?? config.channel ? { channel: args.channel ?? config.channel } : {});
const results = [];
let failures = 0;

for (const width of widths) for (const theme of themes) {
  const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, colorScheme: theme, reducedMotion: 'reduce', isMobile: width < 600, hasTouch: width < 600 });
  // A theme the app stored for the user would override the emulated one: store the run's theme the same way.
  if (config.themeStorageKey) await context.addInitScript(([key, value]) => { try { localStorage.setItem(key, value); } catch { /* none */ } }, [config.themeStorageKey, theme]);
  let signedIn = null;
  for (const entry of pages) {
    if (entry.signIn && signedIn === null) signedIn = signInModule ? await signInModule(context, base) : false;
    if (entry.signIn && !signedIn) { results.push({ ...entry, width, theme, skipped: 'not signed in (configure signIn in pages.json)' }); continue; }
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.goto(base + entry.path);
      await settle(page);
      if (entry.open) { const target = page.locator(entry.open).first(); if (await target.count()) { await target.click(); await settle(page); } }
      await page.addScriptTag({ content: axeSource });
      const outcome = await page.evaluate(async (runTags) => {
        // eslint-disable-next-line no-undef
        const run = await axe.run(document, { runOnly: { type: 'tag', values: runTags }, resultTypes: ['violations'] });
        return run.violations.map((violation) => ({ id: violation.id, impact: violation.impact, help: violation.help, nodes: violation.nodes.map((node) => ({ target: node.target.join(' '), summary: node.failureSummary?.split('\n').slice(0, 3).join(' ') })) }));
      }, tags);
      const violations = outcome.map((violation) => ({ ...violation, allowed: allowed(violation.id, entry.name, violation.nodes) }));
      const counted = violations.filter((violation) => !violation.allowed);
      failures += counted.length;
      const probes = args.probes ? (await probe(page, entry)).map((finding) => ({ ...finding, allowed: allowed(finding.check, entry.name) })) : [];
      if (args.probes === 'strict') failures += probes.filter((finding) => !finding.allowed).length;
      results.push({ ...entry, width, theme, errors, violations, probes });
      const line = counted.map((violation) => `${violation.id}(${violation.nodes.length})`).join(' ') + probes.filter((finding) => !finding.allowed).map((finding) => ` [${finding.check}: ${finding.detail.slice(0, 160)}]`).join('');
      console.log(`${counted.length ? 'FAIL' : 'ok  '} ${(entry.surface ?? '').padEnd(10)} ${entry.name.padEnd(28)} ${String(width).padEnd(4)} ${theme.padEnd(5)} ${line}`);
    } catch (error) {
      failures++;
      results.push({ ...entry, width, theme, error: String(error) });
      console.log(`ERR  ${(entry.surface ?? '').padEnd(10)} ${entry.name.padEnd(28)} ${width} ${theme} ${String(error).split('\n')[0]}`);
    }
    await page.close();
  }
  await context.close();
}
await browser.close();

const summary = {};
for (const result of results) {
  const key = result.surface ?? 'pages';
  summary[key] ??= { runs: 0, violations: 0, nodes: 0, rules: {}, probes: {} };
  summary[key].runs++;
  for (const finding of result.probes ?? []) if (!finding.allowed) summary[key].probes[finding.check] = (summary[key].probes[finding.check] ?? 0) + 1;
  for (const violation of result.violations ?? []) {
    if (violation.allowed) continue;
    summary[key].violations++;
    summary[key].nodes += violation.nodes.length;
    summary[key].rules[violation.id] = (summary[key].rules[violation.id] ?? 0) + violation.nodes.length;
  }
}
console.log('\n' + JSON.stringify(summary, null, 2));
if (args.json) await writeFile(args.json, JSON.stringify({ base, when: new Date().toISOString(), summary, results }, null, 2));
process.exit(failures > 0 ? 1 : 0);
