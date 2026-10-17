// ===========================================================================
// Load test by user journey, for k6 (https://k6.io). Stack-neutral: the
// journeys (steps of requests) and the scenario shapes come from
// tests/load/journeys.json; ids, codes and cookies from the fixture that
// tests/load/generate.mjs writes.
//
//   k6 run tests/load/journeys.k6.js -e BASE_URL=http://127.0.0.1:5080 \
//      -e FIXTURE=tests/load/out/fixture.json [-e ONLY=sales_rush,checkin_burst] [-e SCALE=0.1]
//
// Safety: refuses any host but localhost unless ALLOW_REMOTE=yes, which is set
// only for a planned run the owner approved (a separate environment, or
// off-peak against a test tenant; never real users' data).
// SCALE multiplies every rate and VU count (0.1 for a local trial).
// ===========================================================================
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const BASE = (__ENV.BASE_URL || 'http://127.0.0.1:5080').replace(/\/$/, '');
const host = BASE.replace(/^https?:\/\//, '').split(/[:/]/)[0];
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host) && __ENV.ALLOW_REMOTE !== 'yes') {
  throw new Error(`Refusing ${BASE}: not local. A remote run needs the owner's go and ALLOW_REMOTE=yes.`);
}

const config = JSON.parse(open(__ENV.JOURNEYS || './journeys.json'));
const fixture = JSON.parse(open(__ENV.FIXTURE || './out/fixture.json'));
const scale = Number(__ENV.SCALE || 1);
const only = (__ENV.ONLY || '').split(',').filter(Boolean);

const stepTime = new Trend('journey_step_ms', true);
const journeyErrors = new Rate('journey_errors');

// Scenarios from the config, scaled; each runs the function named after its journey.
const scenarios = {};
for (const [name, scenario] of Object.entries(config.scenarios)) {
  if (only.length && !only.includes(name)) continue;
  const shape = JSON.parse(JSON.stringify(scenario.shape));
  for (const field of ['rate', 'preAllocatedVUs', 'maxVUs', 'vus', 'startRate']) if (shape[field]) shape[field] = Math.max(1, Math.round(shape[field] * scale));
  if (shape.stages) shape.stages = shape.stages.map((stage) => ({ ...stage, target: Math.max(0, Math.round(stage.target * scale)) }));
  scenarios[name] = { ...shape, exec: 'run', env: { JOURNEY: scenario.journey }, tags: { journey: scenario.journey } };
}

export const options = {
  scenarios,
  thresholds: config.thresholds,
  summaryTrendStats: ['avg', 'p(50)', 'p(95)', 'p(99)', 'max'],
};

const pick = (list) => list[Math.floor(Math.random() * list.length)];

/** Fills {name} in a string from the chosen fixture record (and the fixture's top level). */
function fill(text, record) {
  return String(text).replace(/\{([A-Za-z0-9_.]+)\}/g, (whole, name) => {
    const value = name.split('.').reduce((at, part) => (at == null ? at : at[part]), record) ?? name.split('.').reduce((at, part) => (at == null ? at : at[part]), fixture);
    return value == null ? whole : String(value);
  });
}

export function run() {
  const journey = config.journeys[__ENV.JOURNEY];
  const record = journey.from ? pick(fixture[journey.from]) : {};
  const headers = { 'content-type': 'application/json', ...(journey.headers ? JSON.parse(fill(JSON.stringify(journey.headers), record)) : {}) };
  for (const step of journey.steps) {
    const url = BASE + fill(step.path, record);
    const body = step.body ? fill(JSON.stringify(step.body), record) : null;
    const response = http.request(step.method || 'GET', url, body, { headers, tags: { step: step.name || step.path }, timeout: step.timeout || '30s' });
    const expected = step.expect || [200, 201, 204];
    const ok = check(response, { [`${step.name || step.path} ${expected.join('/')}`]: (r) => expected.includes(r.status) });
    journeyErrors.add(!ok);
    stepTime.add(response.timings.duration, { step: step.name || step.path });
    if (step.think) sleep(step.think * (0.5 + Math.random()));
  }
}
