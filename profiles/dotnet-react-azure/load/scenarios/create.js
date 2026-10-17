// Journey: people create things (a registration rush, an order peak). Writes, so a looser threshold,
// and the shared rate limit is part of what is measured: 429 is expected past 10 a minute per address
// and is NOT counted as a failure here.
//
//   k6 run load/scenarios/create.js
//   k6 run -e RATE=20 -e DURATION=2m load/scenarios/create.js
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { BASE_URL, clientHeaders, thresholds } from '../lib/target.js';

const limited = new Counter('rate_limited');

// 429 is an answer, not a failure: the limit doing its job.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 429));

export const options = {
  scenarios: {
    create: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RATE || 10),
      timeUnit: '1s',
      duration: __ENV.DURATION || '1m',
      preAllocatedVUs: 20,
      maxVUs: 200
    }
  },
  thresholds: {
    ...thresholds(800),
    'http_req_duration{name:create}': ['p(95)<800']
  }
};

export default function () {
  const body = JSON.stringify({ name: `load ${__VU}-${__ITER}`, tag: `load-${__VU % 10}` });
  const response = http.post(`${BASE_URL}/api/items`, body, {
    headers: { 'Content-Type': 'application/json', ...clientHeaders() },
    tags: { name: 'create' }
  });
  if (response.status === 429) limited.add(1);
  check(response, { 'created or limited': (r) => r.status === 201 || r.status === 429 });
}
