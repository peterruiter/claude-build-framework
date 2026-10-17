// Writes www/server.js with the address the app loads, so the offline page's "Try again" goes
// back to the same server capacitor.config.ts points the app at. Run by `npm run sync`.
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const url = (process.env.APP_SERVER_URL ?? '').trim() || 'https://example.com/app/';
const target = resolve(dirname(fileURLToPath(import.meta.url)), '../www/server.js');
await writeFile(target, `// Written by scripts/write-server.mjs; not edited by hand.\nwindow.APP_SERVER = ${JSON.stringify(new URL(url).href)};\n`);
console.log(`www/server.js -> ${new URL(url).href}`);
