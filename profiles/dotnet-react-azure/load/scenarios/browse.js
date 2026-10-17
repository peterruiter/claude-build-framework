// Journey: a visitor opens the app and reads. The most common path, so the tightest threshold.
//
//   k6 run load/scenarios/browse.js
//   k6 run -e VUS=50 -e DURATION=5m load/scenarios/browse.js
import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { BASE_URL, thresholds } from '../lib/target.js';

export const options = {
  scenarios: {
    browse: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: Number(__ENV.VUS || 20) },
        { duration: __ENV.DURATION || '1m', target: Number(__ENV.VUS || 20) },
        { duration: '15s', target: 0 }
      ],
      gracefulRampDown: '10s'
    }
  },
  thresholds: {
    ...thresholds(400),
    'http_req_duration{name:items}': ['p(95)<300']
  }
};

export default function () {
  group('open the app', () => {
    const page = http.get(`${BASE_URL}/app/`, { tags: { name: 'app' } });
    check(page, { 'app page 200': (r) => r.status === 200 });
    const locales = http.get(`${BASE_URL}/api/locales`, { tags: { name: 'locales' } });
    check(locales, { 'locales 200': (r) => r.status === 200 });
  });

  group('read the list', () => {
    const items = http.get(`${BASE_URL}/api/items?take=20`, { tags: { name: 'items' } });
    check(items, { 'items 200': (r) => r.status === 200, 'items is a list': (r) => Array.isArray(r.json()) });
  });

  // Think time: a person reads before clicking again.
  sleep(1 + Math.random() * 2);
}
