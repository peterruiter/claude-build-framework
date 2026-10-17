// Exercises the Dataverse stand-in the way a connector uses it.
// Run: node --test "tests/standins/*.test.mjs"
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startDataverseStandin } from './dataverse.mjs';

const TENANT = '00000000-0000-0000-0000-00000000000a';
const CLIENT = '00000000-0000-0000-0000-00000000000b';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

let standin;
let token;
let api;

async function getToken(secret = 'any-secret') {
  return fetch(`${standin.url}/${TENANT}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT, client_secret: secret, scope: `${standin.url}/.default` })
  });
}

function call(method, path, { body, headers = {} } = {}) {
  return fetch(path.startsWith('http') ? path : `${api}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers
    },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
  });
}

const control = (path) => fetch(`${standin.url}/_standin/${path}`, { method: 'POST' });
const state = async () => (await fetch(`${standin.url}/_standin/state`)).json();

before(async () => {
  standin = await startDataverseStandin({ port: 0 });
  api = `${standin.url}/api/data/v9.2/`;
});

after(async () => {
  await standin.close();
});

test('client credentials: a token for a good secret, AADSTS7000215 for a wrong one', async () => {
  const good = await getToken();
  assert.equal(good.status, 200);
  token = (await good.json()).access_token;
  assert.ok(token);

  const bad = await getToken('wrong');
  assert.equal(bad.status, 401);
  assert.match((await bad.json()).error_description, /AADSTS7000215/);
});

test('WhoAmI and metadata', async () => {
  const who = await call('GET', 'WhoAmI');
  assert.equal(who.status, 200);
  assert.ok((await who.json()).OrganizationId);

  const sets = await (await call('GET', `EntityDefinitions?$select=LogicalName,EntitySetName&$filter=${encodeURIComponent("LogicalName eq 'contact' or LogicalName eq 'lead'")}`)).json();
  assert.deepEqual(sets.value.map((row) => row.EntitySetName).sort(), ['contacts', 'leads']);

  const lengths = await (await call('GET', "EntityDefinitions(LogicalName='contact')/Attributes/Microsoft.Dynamics.CRM.StringAttributeMetadata?$select=LogicalName,MaxLength")).json();
  assert.equal(lengths.value.find((row) => row.LogicalName === 'firstname').MaxLength, 50);

  const lookups = await (await call('GET', "EntityDefinitions(LogicalName='lead')/ManyToOneRelationships")).json();
  assert.equal(lookups.value[0].ReferencingEntityNavigationPropertyName, 'parentcontactid');
});

test('contacts: create with a chosen id, duplicate key, duplicate detection, validation', async () => {
  const created = await call('POST', 'contacts', { body: { contactid: id(1), firstname: 'Ana', lastname: 'Silva', emailaddress1: 'ana@example.com' } });
  assert.equal(created.status, 204);
  assert.match(created.headers.get('OData-EntityId'), new RegExp(`contacts\\(${id(1)}\\)$`));

  const again = await call('POST', 'contacts', { body: { contactid: id(1), lastname: 'Silva' } });
  assert.equal(again.status, 412);
  assert.equal((await again.json()).error.code, '0x80040237');

  const duplicate = await call('POST', 'contacts', { body: { lastname: 'Other', emailaddress1: 'ANA@example.com' }, headers: { 'MSCRM.SuppressDuplicateDetection': 'false' } });
  assert.equal(duplicate.status, 412);
  assert.equal((await duplicate.json()).error.code, '0x80040333');

  const unknown = await call('POST', 'contacts', { body: { nosuchcolumn: 'x' } });
  assert.equal(unknown.status, 400);

  const tooLong = await call('POST', 'contacts', { body: { firstname: 'x'.repeat(51) } });
  assert.equal(tooLong.status, 400);
  assert.equal((await tooLong.json()).error.code, '0x80044331');
});

test('PATCH: upsert by id, If-None-Match create-only, If-Match update-only and ETags', async () => {
  const upsert = await call('PATCH', `contacts(${id(2)})`, { body: { lastname: 'Jansen', emailaddress1: 'jan@example.com' } });
  assert.equal(upsert.status, 204);

  const createOnly = await call('PATCH', `contacts(${id(2)})`, { body: { lastname: 'Jansen' }, headers: { 'If-None-Match': '*' } });
  assert.equal(createOnly.status, 412);

  const updateOnly = await call('PATCH', `contacts(${id(99)})`, { body: { lastname: 'Nobody' }, headers: { 'If-Match': '*' } });
  assert.equal(updateOnly.status, 404);

  const read = await call('GET', `contacts(${id(2)})?$select=lastname`);
  const etag = read.headers.get('ETag');
  assert.equal((await read.json()).lastname, 'Jansen');

  assert.equal((await call('PATCH', `contacts(${id(2)})`, { body: { jobtitle: 'Chair' }, headers: { 'If-Match': etag } })).status, 204);
  const stale = await call('PATCH', `contacts(${id(2)})`, { body: { jobtitle: 'Host' }, headers: { 'If-Match': etag } });
  assert.equal(stale.status, 412);
  assert.equal((await stale.json()).error.code, '0x80060882');
});

test('leads bind to contacts by navigation property; a missing contact is refused', async () => {
  const lead = await call('POST', 'leads', { body: { subject: 'Stand visit', lastname: 'Jansen', 'parentcontactid@odata.bind': `/contacts(${id(2)})` }, headers: { 'If-None-Match': 'null' } });
  assert.equal(lead.status, 204);
  const missing = await call('POST', 'leads', { body: { subject: 'Ghost', 'parentcontactid@odata.bind': `/contacts(${id(98)})` } });
  assert.equal(missing.status, 404);
  const found = await (await call('GET', `leads?$select=subject&$filter=${encodeURIComponent(`_parentcontactid_value eq ${id(2)}`)}`)).json();
  assert.equal(found.value.length, 1);
});

test('paging follows @odata.nextLink until it is gone', async () => {
  for (let n = 10; n < 15; n++) await call('PATCH', `contacts(${id(n)})`, { body: { lastname: `Page ${n}`, emailaddress1: `page${n}@example.com` } });
  const seen = [];
  let next = `contacts?$select=lastname&$filter=${encodeURIComponent("startswith(lastname,'Page')")}`;
  while (next) {
    const answer = await (await call('GET', next, { headers: { Prefer: 'odata.maxpagesize=2' } })).json();
    seen.push(...answer.value.map((row) => row.lastname));
    next = answer['@odata.nextLink'];
  }
  assert.deepEqual(seen, ['Page 10', 'Page 11', 'Page 12', 'Page 13', 'Page 14']);
});

test('$batch with continue-on-error: one refused part, the others written', async () => {
  const boundary = 'batch_test';
  const part = (method, path, body) => [
    `--${boundary}`, 'Content-Type: application/http', 'Content-Transfer-Encoding: binary', '',
    `${method} ${api}${path} HTTP/1.1`, 'Content-Type: application/json; type=entry', '', JSON.stringify(body), ''
  ].join('\r\n');
  const body = [
    part('PATCH', `contacts(${id(20)})`, { lastname: 'Batch one' }),
    part('PATCH', `contacts(${id(21)})`, { lastname: 'x'.repeat(60) }),
    part('PATCH', `contacts(${id(22)})`, { lastname: 'Batch three' }),
    `--${boundary}--`, ''
  ].join('\r\n');

  const answer = await call('POST', '$batch', { body, headers: { 'Content-Type': `multipart/mixed; boundary=${boundary}`, Prefer: 'odata.continue-on-error' } });
  assert.equal(answer.status, 200);
  const text = await answer.text();
  assert.equal(text.match(/HTTP\/1\.1 204/g)?.length, 2);
  assert.equal(text.match(/HTTP\/1\.1 400/g)?.length, 1);
  const names = (await state()).records.contacts.map((row) => row.lastname);
  assert.ok(names.includes('Batch one') && names.includes('Batch three'));
});

test('$batch without continue-on-error stops at the first failure; a failed change set is rolled back', async () => {
  const boundary = 'batch_stop';
  const changeset = 'changeset_one';
  const request = (path, body) => [
    'Content-Type: application/http', 'Content-Transfer-Encoding: binary', '',
    `PATCH ${api}${path} HTTP/1.1`, 'Content-Type: application/json; type=entry', '', JSON.stringify(body), ''
  ].join('\r\n');
  const body = [
    `--${boundary}`, `Content-Type: multipart/mixed; boundary=${changeset}`, '',
    `--${changeset}`, request(`contacts(${id(30)})`, { lastname: 'Rolled back' }),
    `--${changeset}`, request(`contacts(${id(31)})`, { lastname: 'x'.repeat(60) }),
    `--${changeset}--`,
    `--${boundary}`, request(`contacts(${id(32)})`, { lastname: 'Never sent' }),
    `--${boundary}--`, ''
  ].join('\r\n');

  const answer = await call('POST', '$batch', { body, headers: { 'Content-Type': `multipart/mixed; boundary=${boundary}` } });
  assert.equal(answer.status, 400);
  const names = (await state()).records.contacts.map((row) => row.lastname);
  assert.ok(!names.includes('Rolled back') && !names.includes('Never sent'));
});

test('429 with Retry-After when throttled, then normal again', async () => {
  await control('throttle?times=1&retryAfter=7');
  const throttled = await call('GET', 'WhoAmI');
  assert.equal(throttled.status, 429);
  assert.equal(throttled.headers.get('Retry-After'), '7');
  assert.equal((await call('GET', 'WhoAmI')).status, 200);
});

test('a custom trigger is recorded; a missing attribute is refused', async () => {
  const signal = {
    msdynmkt_signalingestiontimestamp: '2026-01-01T10:00:00Z',
    msdynmkt_signaltimestamp: '2026-01-01T10:00:00Z',
    msdynmkt_signaluserauthid: id(2),
    msdynmkt_profileid: id(2),
    msdynmkt_bindingid: 'registration-1',
    msdynmkt_itemname: ''
  };
  assert.equal((await call('POST', 'msdynmkt_examplesignal_1', { body: signal })).status, 204);
  const { msdynmkt_bindingid: _, ...missing } = signal;
  assert.equal((await call('POST', 'msdynmkt_examplesignal_1', { body: missing })).status, 400);
  const calls = (await state()).triggerCalls;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.msdynmkt_bindingid, 'registration-1');
});

test('static list members, seeded through the controls', async () => {
  const seeded = await fetch(`${standin.url}/_standin/seed`, {
    method: 'POST',
    body: JSON.stringify({ lists: [{ listid: id(50), listname: 'Newsletter', members: [id(1), id(2)] }] })
  });
  assert.equal(seeded.status, 204);
  const members = await (await call('GET', `lists(${id(50)})/listcontact_association?$select=emailaddress1`)).json();
  assert.deepEqual(members.value.map((row) => row.emailaddress1).sort(), ['ana@example.com', 'jan@example.com']);
});

test('expired tokens are refused with 401', async () => {
  await control('expire-tokens');
  assert.equal((await call('GET', 'WhoAmI')).status, 401);
  token = (await (await getToken()).json()).access_token;
  assert.equal((await call('GET', 'WhoAmI')).status, 200);
});
