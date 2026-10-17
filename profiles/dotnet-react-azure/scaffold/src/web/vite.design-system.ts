import { cpSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';

// The design system's stylesheet, fonts and logos at stable addresses under the app
// (/app/design-system/tokens.css, /app/design-system/logos/<file>), next to the hashed bundle: for
// pages outside the React apps (the API's start page in wwwroot/index.html) and for what needs a
// fixed URL (the logo in emails, served over https by the app). Only these files: the generated
// TypeScript, JSON and brand notes stay out of the site.
export function designSystemAssets(): Plugin {
  const from = resolve(__dirname, 'src/styles/design-system');
  let outDir = '';
  return {
    name: 'design-system-assets',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    writeBundle() {
      const to = join(outDir, 'design-system');
      cpSync(join(from, 'tokens.css'), join(to, 'tokens.css'));
      for (const folder of ['fonts', 'logos']) {
        if (existsSync(join(from, folder))) cpSync(join(from, folder), join(to, folder), { recursive: true });
      }
    }
  };
}
