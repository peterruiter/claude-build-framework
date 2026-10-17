#!/usr/bin/env node
// ===========================================================================
// Test data for the load test: makes a test tenant with realistic data through
// the product's own API, and writes the fixture journeys.k6.js reads (ids,
// codes, cookies, keys). With --cleanup it deletes what it made.
//
//   node tests/load/generate.mjs [--base http://127.0.0.1:5080] [--customers 3000]
//        [--concurrency 25] [--out tests/load/out/fixture.json]
//   node tests/load/generate.mjs --cleanup tests/load/out/fixture.json
//
// The three functions marked PROJECT are the product-specific part; the load-test
// skill fills them in. Local only unless ALLOW_REMOTE=yes (a planned run with the
// owner's go, against a test tenant in a separate environment; never real data).
// Node's own modules only.
// ===========================================================================
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, index, all) => {
  if (arg.startsWith('--')) pairs.push([arg.slice(2), all[index + 1]?.startsWith('--') || all[index + 1] === undefined ? 'true' : all[index + 1]]);
  return pairs;
}, []));

const base = new URL(args.base ?? 'http://127.0.0.1:5080');
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(base.hostname) && process.env.ALLOW_REMOTE !== 'yes') {
  console.error(`Refusing ${base.origin}: not local. A remote run needs the owner's go and ALLOW_REMOTE=yes.`);
  process.exit(2);
}
const tag = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
const out = resolve(args.out ?? `tests/load/out/fixture-${tag}.json`);
const concurrency = Number(args.concurrency ?? 25);

/** Calls the API; throws with the answer when it is not 2xx. */
export async function api(method, path, body, headers = {}) {
  const response = await fetch(new URL(path, base), { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

/** Runs work(item) for every item, n at a time, and returns the results in order. */
export async function inParallel(items, n, work) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const at = next++; results[at] = await work(items[at], at); }
  }));
  return results;
}

// ---------------------------------------------------------------------------
// PROJECT: make the test tenant and everything the journeys need.
// ---------------------------------------------------------------------------
async function makeTenant() {
  // e.g. const tenant = await api('POST', '/api/tenants', { name: `Load test ${tag}` }, adminHeaders);
  throw new Error('makeTenant: fill in for this product (the load-test skill does this)');
}

// PROJECT: one realistic customer (own address, own session cookie), made the way a real user would be.
async function makeCustomer(tenant, index) {
  void tenant; void index;
  throw new Error('makeCustomer: fill in for this product');
}

// PROJECT: delete everything the fixture lists.
async function cleanup(fixture) {
  void fixture;
  throw new Error('cleanup: fill in for this product');
}

if (args.cleanup) {
  const fixture = JSON.parse(await readFile(resolve(args.cleanup), 'utf8'));
  await cleanup(fixture);
  console.log(`Cleaned up ${fixture.tag}.`);
  process.exit(0);
}

const started = Date.now();
const tenant = await makeTenant();
const count = Number(args.customers ?? 1000);
const customers = await inParallel(Array.from({ length: count }, (_, index) => index), concurrency, (index) => makeCustomer(tenant, index));
const fixture = {
  tag,
  base: base.origin,
  made: new Date().toISOString(),
  runId: randomUUID(),
  tenant,
  customers,
  visitors: customers.map((customer) => ({ email: `load+${tag}-${customer.index ?? 0}@example.com`, offerId: tenant.offerId })),
  tickets: customers.map((customer) => ({ code: customer.code })).filter((ticket) => ticket.code),
  admins: tenant.admins ?? [],
  apiKeys: tenant.apiKeys ?? [],
  staffToken: tenant.staffToken ?? null,
};
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(fixture, null, 2));
console.log(`Fixture ${out}: ${customers.length} customers in ${Math.round((Date.now() - started) / 1000)} s. Clean up with --cleanup ${out}`);
