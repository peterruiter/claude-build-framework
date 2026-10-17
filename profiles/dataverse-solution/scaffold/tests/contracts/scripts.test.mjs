// The offline scripts run: every PowerShell file parses, translations are complete, the
// privacy register builds. Skipped (and reported as skipped) without PowerShell 7.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { root } from './dataverse-lib.mjs';

const pwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' });
const hasPwsh = pwsh.status === 0 && Number(pwsh.stdout.trim()) >= 7;
const run = (script, ...args) => spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', `build/${script}`, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, CI: 'true' } });

test('every PowerShell file parses', { skip: !hasPwsh && 'PowerShell 7 (pwsh) not found' }, () => {
  const r = run('Test-Scripts.ps1');
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('Test-Translations.ps1: no gaps', { skip: !hasPwsh && 'PowerShell 7 (pwsh) not found' }, () => {
  const r = run('Test-Translations.ps1');
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('Export-PrivacyRegister.ps1 builds the register', { skip: !hasPwsh && 'PowerShell 7 (pwsh) not found' }, () => {
  const r = run('Export-PrivacyRegister.ps1', '-Out', 'out/privacy-register.md');
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

// pac as the scripts see it (PowerShell's PATH), which may be another install than a shell's.
const pac = hasPwsh ? spawnSync('pwsh', ['-NoProfile', '-Command', 'pac'], { encoding: 'utf8' }) : { stdout: '', stderr: '' };
const hasPac = /Version: \d+\.\d+\.\d+/.test(`${pac.stdout ?? ''}${pac.stderr ?? ''}`);
const noPac = 'pac not installed: the pack round trip did not run here. Install it (dotnet tool install --global Microsoft.PowerApps.CLI.Tool) or rely on the CI job "pack", which installs it';

test('Build-Solution.ps1 -RoundTrip: the source packs and unpacks to the same files', { skip: (!hasPwsh && 'PowerShell 7 (pwsh) not found') || (!hasPac && noPac) }, () => {
  const r = run('Build-Solution.ps1', '-RoundTrip');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /round trip: \d+ files identical/);
});

test('scripts that reach an environment refuse to start without a real tenant', { skip: !hasPwsh && 'PowerShell 7 (pwsh) not found' }, () => {
  // environments.json in git carries the placeholder tenant: nothing may connect.
  const r = run('Import-Solution.ps1', '-Environment', 'test', '-Path', 'environments.json');
  assert.notEqual(r.status, 0, 'Import-Solution must refuse');
  assert.match(r.stdout + r.stderr, /placeholder tenantId/);
});
