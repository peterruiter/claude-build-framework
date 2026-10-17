#!/usr/bin/env node
// Raises control and solution versions together. The platform caches a control by its version:
// an import with the same version keeps serving the old bundle, so every change that should
// reach an environment raises the control's version, and the solution's.
//
//   control  MAJOR.MINOR.PATCH          (ControlManifest.Input.xml, control/@version)
//   solution MAJOR.MINOR.BUILD.REVISION (solution/src/Other/Solution.xml)
//   patch -> control PATCH+1, solution REVISION+1
//   minor -> control MINOR+1 (PATCH 0), solution MINOR+1 (BUILD, REVISION 0)
//   major -> control MAJOR+1 (MINOR, PATCH 0), solution MAJOR+1 (the rest 0)
//
// Usage: node scripts/bump-version.mjs [patch|minor|major] [--controls A,B] [--no-solution] [--dry-run]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { controlsRoot, findControls, readManifest } from './lib.mjs';

export function bump(version, which) {
  const parts = version.split('.').map(Number);
  if (parts.length === 3) {
    const [major, minor, patch] = parts;
    if (which === 'major') return `${major + 1}.0.0`;
    if (which === 'minor') return `${major}.${minor + 1}.0`;
    return `${major}.${minor}.${patch + 1}`;
  }
  while (parts.length < 4) parts.push(0);
  const [major, minor, build, revision] = parts;
  if (which === 'major') return `${major + 1}.0.0.0`;
  if (which === 'minor') return `${major}.${minor + 1}.0.0`;
  return `${major}.${minor}.${build}.${revision + 1}`;
}

function main() {
  const args = process.argv.slice(2);
  const part = ['patch', 'minor', 'major'].find((one) => args.includes(one)) ?? 'patch';
  const dryRun = args.includes('--dry-run');
  const only = args.includes('--controls') ? args[args.indexOf('--controls') + 1].split(',') : null;
  const changes = [];

  for (const folder of findControls()) {
    const manifest = readManifest(folder);
    if (only && !only.includes(manifest.constructor)) continue;
    const next = bump(manifest.version, part);
    changes.push([relative(controlsRoot, manifest.path), manifest.version, next]);
    if (!dryRun) writeFileSync(manifest.path, manifest.xml.replace(/(<control\b[^>]*\bversion=")[^"]*(")/, `$1${next}$2`));
  }

  const solutionXml = join(controlsRoot, '..', 'solution', 'src', 'Other', 'Solution.xml');
  if (!args.includes('--no-solution') && existsSync(solutionXml)) {
    const xml = readFileSync(solutionXml, 'utf8');
    const current = /<Version>([^<]+)<\/Version>/.exec(xml)?.[1] ?? '1.0.0.0';
    const next = bump(current, part);
    changes.push(['../solution/src/Other/Solution.xml', current, next]);
    if (!dryRun) writeFileSync(solutionXml, xml.replace(/<Version>[^<]+<\/Version>/, `<Version>${next}</Version>`));
  }

  for (const [file, from, to] of changes) console.log(`  ${file}: ${from} -> ${to}`);
  console.log(`${dryRun ? 'Would raise' : 'Raised'} ${changes.length} version(s) (${part}).`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
