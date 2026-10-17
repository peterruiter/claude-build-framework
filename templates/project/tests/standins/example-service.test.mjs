// The generic stand-in (standin.mjs) with the example routes: the way a feature's tests use one.
// Run: node --test "tests/standins/*.test.mjs"
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startStandin } from './standin.mjs';
import service from './example-service.mjs';

let standin;
const key = { authorization: 'Bearer test_123', 'content-type': 'application/json' };
const call = (method, path, body, headers = key) => fetch(`${standin.url}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });

before(async () => { standin = await startStandin(service, { quiet: true }); });
after(async () => { await standin.close(); });

test('a wrong key is refused the way the service refuses it', async () => {
  const response = await call('GET', '/v1/items', null, { authorization: 'Bearer test_bad' });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, 'invalid_key');
});

test('create, read, list with pagination, delete', async () => {
  const made = [];
  for (const name of ['a', 'b', 'c']) made.push(await (await call('POST', '/v1/items', { name })).json());
  assert.equal((await (await call('GET', `/v1/items/${made[1].id}`)).json()).name, 'b');
  const page = await (await call('GET', '/v1/items?limit=2')).json();
  assert.equal(page.data.length, 2);
  assert.equal(page.has_more, true);
  const rest = await (await call('GET', `/v1/items?limit=2&after=${page.data[1].id}`)).json();
  assert.equal(rest.data.length, 1);
  assert.equal((await call('DELETE', `/v1/items/${made[0].id}`)).status, 204);
  assert.equal((await call('GET', `/v1/items/${made[0].id}`)).status, 404);
});

test('an Idempotency-Key makes a retried create return the first result', async () => {
  const headers = { ...key, 'idempotency-key': 'retry-1' };
  const first = await (await call('POST', '/v1/items', { name: 'once' }, headers)).json();
  const second = await (await call('POST', '/v1/items', { name: 'once' }, headers)).json();
  assert.equal(second.id, first.id);
});

test('controls: received calls, a forced failure, reset', async () => {
  await fetch(`${standin.url}/_standin/reset`, { method: 'POST' });
  await fetch(`${standin.url}/_standin/fail`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: 'POST', path: '/v1/items', status: 503 }) });
  assert.equal((await call('POST', '/v1/items', { name: 'x' })).status, 503, 'the next create fails once');
  assert.equal((await call('POST', '/v1/items', { name: 'x' })).status, 201, 'then works again');
  const received = await (await fetch(`${standin.url}/_standin/received?path=/v1/items`)).json();
  assert.equal(received.length, 2);
  assert.equal(received[1].body.name, 'x');
});
