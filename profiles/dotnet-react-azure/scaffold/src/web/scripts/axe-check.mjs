// ===========================================================================
// Accessibility check with axe-core (WCAG 2.2 AA rules) over the main pages,
// in both themes and at two widths, against a running API (build/Start-Local.ps1).
//
//   npm i -D playwright @axe-core/playwright && npx playwright install chromium
//   node scripts/axe-check.mjs [--base http://127.0.0.1:5080] [--pages /app/,/portal/]
//
// Not part of npm run build (it needs a browser and a running server); run it
// in the quality gate before a release and after any UI change. axe finds about
// a third of WCAG problems: also do a keyboard pass (Tab through every page:
// skip link first, focus always visible, nothing trapped) and check reflow at
// 320px. Exit code 1 on any violation; 2 when the tools are not installed.
// ===========================================================================
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => {
  if (arg.startsWith('--')) pairs.push([arg.slice(2), all[i + 1]]);
  return pairs;
}, []));
const base = args.base ?? 'http://127.0.0.1:5080';
const pages = (args.pages ?? '/app/,/portal/').split(',');

let chromium, AxeBuilder;
try {
  ({ chromium } = await import('playwright'));
  ({ default: AxeBuilder } = await import('@axe-core/playwright'));
} catch {
  console.error('Not run: install the tools first: npm i -D playwright @axe-core/playwright && npx playwright install chromium');
  process.exit(2);
}

const browser = await chromium.launch();
let violations = 0;
try {
  for (const colorScheme of ['light', 'dark']) {
    for (const width of [390, 1440]) {
      const context = await browser.newContext({ colorScheme, viewport: { width, height: 900 } });
      const page = await context.newPage();
      for (const path of pages) {
        await page.goto(new URL(path, base).href, { waitUntil: 'networkidle' });
        const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
        const sideways = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        for (const v of result.violations) {
          violations++;
          console.error(`${path} ${colorScheme} ${width}px: ${v.id} (${v.impact}) ${v.help} - ${v.nodes.length} element(s)`);
        }
        if (sideways) { violations++; console.error(`${path} ${colorScheme} ${width}px: scrolls sideways`); }
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
}

if (violations) { console.error(`${violations} accessibility problem(s).`); process.exit(1); }
console.log(`axe: no violations on ${pages.length} page(s), light and dark, 390 and 1440px.`);
