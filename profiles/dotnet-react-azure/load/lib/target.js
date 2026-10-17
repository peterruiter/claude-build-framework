// ===========================================================================
// Where a load test may run, decided once for every scenario.
//
//   BASE_URL      the API, http://127.0.0.1:5080 by default (build/Start-Local.ps1)
//   TARGET        local (default) or loadtest: a separate environment made for
//                 the test, in its own resource group (see load/README.md)
//   OWNER_GO      required for TARGET=loadtest: the date the owner said yes to
//                 this run, such as 2026-10-17. Approval is per run.
//   PRODUCTION_HOSTS  comma-separated host names that are production; a test
//                 against any of them is refused, always.
//
// A load test against production is never started from here. If the owner
// ever wants one, that is a separate, written decision with a time window,
// and this guard is changed for that run in a reviewed commit.
// ===========================================================================

const base = (__ENV.BASE_URL || 'http://127.0.0.1:5080').replace(/\/$/, '');
const target = __ENV.TARGET || 'local';
const host = base.replace(/^https?:\/\//, '').split('/')[0].split(':')[0].toLowerCase();
const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host);
const production = (__ENV.PRODUCTION_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);

if (production.includes(host)) {
  throw new Error(`Refusing ${base}: ${host} is listed in PRODUCTION_HOSTS. Load tests never run against production.`);
}
if (target === 'local' && !loopback) {
  throw new Error(`Refusing ${base}: TARGET=local runs against a loopback address only. For a load-test environment set TARGET=loadtest and OWNER_GO.`);
}
if (target === 'loadtest' && !/^\d{4}-\d{2}-\d{2}$/.test(__ENV.OWNER_GO || '')) {
  throw new Error('TARGET=loadtest needs OWNER_GO=<yyyy-mm-dd>: the day the owner approved this run against the load-test environment.');
}
if (!['local', 'loadtest'].includes(target)) {
  throw new Error(`TARGET must be local or loadtest, not ${target}.`);
}

export const BASE_URL = base;
export const TARGET = target;

/**
 * A made-up client address per virtual user, so per-address rate limits partition by user. Only a LOCAL
 * API believes it (no ingress in front); behind Azure's ingress the real address wins, as it should.
 */
export function clientHeaders() {
  return TARGET === 'local' ? { 'X-Forwarded-For': `10.${(__VU >> 16) & 255}.${(__VU >> 8) & 255}.${__VU & 255}` } : {};
}

/** Thresholds every scenario shares: tune per journey, keep them in the scenario file. */
export function thresholds(p95Ms, errorRate = 0.01) {
  return {
    http_req_failed: [`rate<${errorRate}`],
    http_req_duration: [`p(95)<${p95Ms}`],
    checks: ['rate>0.99']
  };
}
