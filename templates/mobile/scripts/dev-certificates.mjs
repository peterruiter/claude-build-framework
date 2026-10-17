// ===========================================================================
// Keeps CI from filling the team's development certificates.
//
// Every archive on a fresh macOS runner uses automatic signing, and Xcode makes
// a new "Apple Development: Created via API" certificate for it because the
// runner's keychain is empty. A team may hold only a few; a full set stops
// every iOS build. The certificate is needed only while archiving: the App
// Store export is re-signed with Apple's cloud-managed distribution certificate.
//
//   node scripts/dev-certificates.mjs list  <file>   before the archive: today's ids
//   node scripts/dev-certificates.mjs prune <file>   after the export: revoke the new ones
//
// Only DEVELOPMENT certificates named "Created via API" that were not in the
// list are revoked: never a distribution certificate, a Pass Type ID
// certificate or one a person made in Xcode. Needs KEY_ID, ISSUER_ID and
// KEY_PATH (the App Store Connect API key the archive used). Node only.
// ===========================================================================
import { readFileSync, writeFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const [command, file] = process.argv.slice(2);
const { KEY_ID, ISSUER_ID, KEY_PATH } = process.env;
if (!['list', 'prune'].includes(command) || !file || !KEY_ID || !ISSUER_ID || !KEY_PATH) {
  console.error('Usage: KEY_ID=... ISSUER_ID=... KEY_PATH=... node scripts/dev-certificates.mjs list|prune <file>');
  process.exit(2);
}

// App Store Connect API token: ES256 JWT, at most 20 minutes.
function token() {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${part({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' })}.${part({ iss: ISSUER_ID, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' })}`;
  const signature = createSign('SHA256').update(unsigned).sign({ key: readFileSync(KEY_PATH, 'utf8'), dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${unsigned}.${signature}`;
}

async function api(method, path) {
  const response = await fetch(`https://api.appstoreconnect.apple.com${path}`, { method, headers: { Authorization: `Bearer ${token()}` } });
  if (!response.ok && response.status !== 404) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
  return response.status === 204 || method === 'DELETE' ? null : response.json();
}

async function createdViaApi() {
  const found = await api('GET', '/v1/certificates?limit=200&filter[certificateType]=DEVELOPMENT&fields[certificates]=name,displayName');
  return found.data
    .filter((certificate) => /Created via API/i.test(`${certificate.attributes.name} ${certificate.attributes.displayName}`))
    .map((certificate) => certificate.id);
}

if (command === 'list') {
  const ids = await createdViaApi();
  writeFileSync(file, JSON.stringify(ids));
  console.log(`${ids.length} development certificate(s) made through the API before this build.`);
} else {
  let before;
  try {
    before = new Set(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    // Without the list from before, nothing can be told apart: leave everything.
    console.log('No list from before the archive; nothing revoked.');
    process.exit(0);
  }
  const fresh = (await createdViaApi()).filter((id) => !before.has(id));
  for (const id of fresh) {
    await api('DELETE', `/v1/certificates/${id}`);
    console.log(`Revoked development certificate ${id}, made for this build.`);
  }
  if (fresh.length === 0) console.log('This build made no development certificate.');
}
