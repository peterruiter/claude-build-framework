// The peak hour: readers and writers at once, from the fixture the generator wrote. Use this one to
// size replicas (app.maxReplicas, httpConcurrency) and the database ceiling (database.maxVCores):
// watch the container app's replica count and the database's workers_percent while it runs.
//
//   node load/generate-data.mjs            (once, against a local API)
//   k6 run load/scenarios/mixed.js
//   k6 run -e READERS=20 -e RAMP=5s -e DURATION=20s -e WRITE_START=5s -e WRITE_DURATION=20s load/scenarios/mixed.js   (a quick trial)
import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { BASE_URL, clientHeaders, thresholds } from '../lib/target.js';

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 429));

const fixture = new SharedArray('tags', () => {
  try { return JSON.parse(open(__ENV.FIXTURE || '../out/fixture.json')).tags; }
  catch { return ['load-0']; }
});

export const options = {
  scenarios: {
    readers: {
      executor: 'ramping-vus',
      exec: 'read',
      stages: [
        { duration: __ENV.RAMP || '1m', target: Number(__ENV.READERS || 50) },
        { duration: __ENV.DURATION || '3m', target: Number(__ENV.READERS || 50) },
        { duration: __ENV.RAMP || '30s', target: 0 }
      ]
    },
    writers: {
      executor: 'constant-arrival-rate',
      exec: 'write',
      rate: Number(__ENV.WRITES_PER_SECOND || 5),
      timeUnit: '1s',
      duration: __ENV.WRITE_DURATION || '4m',
      startTime: __ENV.WRITE_START || '30s',
      preAllocatedVUs: 10,
      maxVUs: 100
    }
  },
  thresholds: {
    ...thresholds(600),
    'http_req_duration{scenario:readers}': ['p(95)<400'],
    'http_req_duration{scenario:writers}': ['p(95)<900']
  }
};

export function read() {
  const response = http.get(`${BASE_URL}/api/items?take=50`, { tags: { name: 'items' } });
  check(response, { 'items 200': (r) => r.status === 200 });
  sleep(1 + Math.random() * 3);
}

export function write() {
  const tag = fixture[Math.floor(Math.random() * fixture.length)];
  const response = http.post(`${BASE_URL}/api/items`, JSON.stringify({ name: `peak ${__VU}-${__ITER}`, tag }), {
    headers: { 'Content-Type': 'application/json', ...clientHeaders() },
    tags: { name: 'create' }
  });
  check(response, { 'created or limited': (r) => r.status === 201 || r.status === 429 });
}
