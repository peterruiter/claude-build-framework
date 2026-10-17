// ===========================================================================
// Test data for the load scenarios: N items over M tags through the public API,
// and a fixture file (out/fixture.json) the scenarios read. Node's own modules.
//
//   node load/generate-data.mjs [--base http://127.0.0.1:5080] [--items 500] [--tags 20] [--concurrency 10]
//
// A local Development API only: it refuses any address but loopback, and it
// checks the API answers like the scaffold's (GET /api/locales). Each request
// carries its own X-Forwarded-For so the per-address limit does not stop the
// seeding; only a local API (no ingress in front) believes that header.
//
// Extend it with your product's journeys: make what the scenarios need through
// the same API a user would, so the data has the shape real data has. Never
// write to a database you do not own; never point this at a deployment.
// ===========================================================================
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, index, all) => {
  if (arg.startsWith('--')) pairs.push([arg.slice(2), all[index + 1]]);
  return pairs;
}, []));

const base = new URL(args.base ?? 'http://127.0.0.1:5080');
if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(base.hostname)) {
  console.error(`Refusing ${base}: the generator writes test data and runs against a local API only.`);
  process.exit(2);
}

const items = Number(args.items ?? 500);
const tagCount = Number(args.tags ?? 20);
const concurrency = Number(args.concurrency ?? 10);
const tags = Array.from({ length: tagCount }, (_, i) => `load-${i}`);

const probe = await fetch(new URL('/api/locales', base)).catch((error) => ({ ok: false, statusText: error.message }));
if (!probe.ok) {
  console.error(`${base} does not answer like the API (GET /api/locales: ${probe.status ?? ''} ${probe.statusText}). Start it with build/Start-Local.ps1.`);
  process.exit(1);
}

let next = 0;
let created = 0;
let failed = 0;
const started = performance.now();

async function worker(id) {
  while (next < items) {
    const n = next++;
    const response = await fetch(new URL('/api/items', base), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.99.${(n >> 8) & 255}.${n & 255}` },
      body: JSON.stringify({ name: `seed ${n}`, tag: tags[n % tags.length] })
    }).catch(() => null);
    if (response?.status === 201) created++;
    else { failed++; if (failed <= 5) console.error(`item ${n} (worker ${id}): ${response ? response.status : 'no answer'}`); }
  }
}

await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));

const out = resolve(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, 'fixture.json'), JSON.stringify({ base: base.href, createdUtc: new Date().toISOString(), items: created, tags }, null, 2));
console.log(`${created} items over ${tags.length} tags in ${((performance.now() - started) / 1000).toFixed(1)} s; ${failed} failed. Fixture: ${resolve(out, 'fixture.json')}`);
if (failed > 0) process.exit(1);
