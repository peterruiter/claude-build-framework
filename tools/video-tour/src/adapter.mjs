// The studio adapter: the one place a product's own knowledge lives. The tool records any web app;
// what it cannot know (how to sign in, how to make demo data, what to tidy on screen) the product
// supplies in a small ES module named by config paths.adapter. Every member is optional:
//
//   export default {
//     async beforeAll({ base, config, log }) {},          once per recording run, app up
//     async afterAll({ base, config, log }) {},
//     async dressContext({ context, doc, lang, vars, base, flags, log }) {},
//                                                          every browser context the recorder makes:
//                                                          routes that tidy responses, cookies, storage
//     setup: { async name(value, ctx) {} },                steps for a script's setup: and cleanup:
//     actions: { async name(value, actor) {} },            filmed actions for a step's do:
//     words(key, lang, kind) {},                           text for {@key} when no uiStrings bundle has it
//   }
//
// ctx (setup steps) = { context, page, base, lang, vars, fill, pick, log, cacheDir, config }.
// actor (actions)   = the recorder's Actor: page, scope, context, base, lang, vars, text(), locate(),
//                     target(), moveTo(), run(action), settle(), cacheDir, log. See README.
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { config } from './config.mjs';
import { fill, pick, log, sleep, ensureDir } from './util.mjs';
import { useAdapterWords } from './strings.mjs';
import { join } from 'node:path';

let loaded = null;

export async function loadAdapter() {
  if (loaded) return loaded;
  const file = config().dirs.adapter;
  if (!file) { loaded = {}; return loaded; }
  if (!existsSync(file)) throw new Error(`The adapter ${file} (config paths.adapter) does not exist`);
  const mod = await import(pathToFileURL(file).href);
  loaded = mod.default ?? mod;
  useAdapterWords(loaded.words?.bind(loaded));
  return loaded;
}

export function adapterNames(adapter) {
  return { actions: Object.keys(adapter.actions ?? {}), setupSteps: Object.keys(adapter.setup ?? {}) };
}

/**
 * Runs set-up or clean-up steps (not filmed). Built in:
 *   api: { method, path, body, save, optional }   a request with the browser's cookies; `save` keeps fields as vars
 *   eval: "js"                                    runs in a page of the site; a returned object adds to the vars
 *   storage: { key: value }                       localStorage on the site's origin
 *   goto: path                                    opens a page (to set cookies, warm caches)
 *   wait: ms
 * Anything else is the adapter's `setup[name]`.
 */
export async function runSetup(context, page, entries, { base, lang, vars }) {
  const adapter = await loadAdapter();
  const c = config();
  const ctx = { context, page, base, lang, vars, fill, pick: (v) => pick(v, lang, c.narration.language), log, cacheDir: ensureDir(join(c.dirs.cache, 'adapter')), config: c };
  for (const entry of entries ?? []) {
    const [name, value] = Object.entries(entry)[0];
    if (name === 'api') {
      const path = fill(value.path, vars);
      const response = await context.request.fetch(`${base}${path}`, {
        method: value.method ?? 'GET',
        data: value.body ? JSON.parse(fill(JSON.stringify(value.body), vars)) : undefined,
        headers: { 'Content-Type': 'application/json', ...(value.headers ?? {}) }
      });
      if (!response.ok() && !value.optional) throw new Error(`setup ${value.method ?? 'GET'} ${path}: ${response.status()} ${(await response.text()).slice(0, 200)}`);
      if (value.save) {
        const json = await response.json().catch(() => ({}));
        for (const [as, field] of Object.entries(value.save)) {
          let v = field.split('.').reduce((o, k) => o?.[k], json);
          // Links the server writes with its public address open on the site being recorded.
          if (typeof v === 'string' && c.app.publicUrl) v = v.replace(c.app.publicUrl.replace(/\/$/, ''), base);
          vars[as] = v;
        }
      }
    } else if (name === 'eval') {
      if (!page.url().startsWith(base)) await page.goto(`${base}/`).catch(() => {});
      const result = await page.evaluate(fill(pick(value, lang, c.narration.language), vars));
      if (result && typeof result === 'object') Object.assign(vars, result);
    } else if (name === 'storage') {
      if (!page.url().startsWith(base)) await page.goto(`${base}/`).catch(() => {});
      await page.evaluate((pairs) => { for (const [k, v] of Object.entries(pairs)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); },
        JSON.parse(fill(JSON.stringify(value), vars)));
    } else if (name === 'goto') {
      await page.goto(`${base}${fill(pick(value, lang, c.narration.language), vars)}`, { waitUntil: 'load' });
    } else if (name === 'wait') {
      await sleep(Number(value));
    } else if (adapter.setup?.[name]) {
      const result = await adapter.setup[name](value, ctx);
      if (result && typeof result === 'object') Object.assign(vars, result);
    } else throw new Error(`unknown setup step "${name}" (not built in, not in the adapter)`);
  }
}
