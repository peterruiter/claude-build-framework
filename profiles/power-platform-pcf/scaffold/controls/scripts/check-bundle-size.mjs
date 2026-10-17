#!/usr/bin/env node
// Bundle size after `npm run build:release`. A virtual control gets React and Fluent from the
// platform, so its bundle holds only its own code. The budget (package.json
// config.bundleBudgetKb) catches a library pulled in by accident (a whole icon set, a second
// React). The platform refuses web resources above the environment's maximum attachment size
// (5 MB by default), and a development build can pass the budget check locally while being
// several times larger: this check also refuses a development build.
// Usage: node scripts/check-bundle-size.mjs [--budget <kb>]
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { controlsRoot, findControls, readManifest } from './lib.mjs';

const PLATFORM_LIMIT_KB = 5120;
const pkg = JSON.parse(readFileSync(join(controlsRoot, 'package.json'), 'utf8'));
const index = process.argv.indexOf('--budget');
const budget = Number(index > 0 ? process.argv[index + 1] : pkg.config?.bundleBudgetKb ?? 300);

let failed = false;
const rows = [];
for (const folder of findControls()) {
  const { constructor } = readManifest(folder);
  // Each control project builds into its own out/controls/<Control>/bundle.js.
  const bundle = join(dirname(folder), 'out', 'controls', constructor, 'bundle.js');
  if (!existsSync(bundle)) {
    console.error(`  ✗ ${constructor}: no ${bundle}; run npm run build:release first`);
    failed = true;
    continue;
  }
  const kb = Math.round(statSync(bundle).size / 102.4) / 10;
  // webpack development builds wrap every module in eval() with source maps.
  const development = readFileSync(bundle, 'utf8').includes('eval(');
  const verdict = kb > PLATFORM_LIMIT_KB ? 'over the platform limit' : kb > budget ? 'over budget' : development ? 'a development build' : 'ok';
  if (verdict !== 'ok') failed = true;
  rows.push(`  ${verdict === 'ok' ? '✓' : '✗'} ${constructor.padEnd(24)} ${String(kb).padStart(8)} KB  (budget ${budget} KB)${verdict === 'ok' ? '' : ` ${verdict}`}`);
}
console.log(rows.join('\n'));
if (failed) {
  console.error('Bundle size: not OK. Build with npm run build:release, import single components rather than whole libraries, and take React and Fluent from the platform.');
  process.exit(1);
}
console.log('Bundle size: OK');
