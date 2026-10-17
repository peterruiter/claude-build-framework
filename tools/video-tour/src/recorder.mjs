// Records one video: drives the browser through the script's steps, holding each step until its
// narration has been spoken, and captures the screen through Chrome's screencast (sharp JPEG frames
// with timestamps, far better than a VP8 screen recording). Frames are bucketed to the output
// frame rate on the screencast's own clock, so the timing in the video is the timing of the run.
import { readFileSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.mjs';
import { toolDir, ensureDir, sleep, pick, log, fill, seededRandom, isLangMap } from './util.mjs';
import { words } from './strings.mjs';
import { runSetup, loadAdapter } from './adapter.mjs';
import { phoneRoutes, PHONE, rgb } from './stage.mjs';

function overlayScript() {
  const c = config();
  return readFileSync(join(toolDir, 'src', 'overlay.js'), 'utf8')
    .replaceAll('__VS_HL__', rgb(c.brand.colors.highlight))
    .replaceAll('__VS_ZOOM_ROOT__', JSON.stringify(c.app.zoomRoot ?? null));
}

/** Screencast frames bucketed to the output frame rate: the last frame in each tick is kept. */
class FrameSink {
  constructor(dir, fps) {
    this.dir = dir; this.fps = fps; this.cdp = null;
    this.ticks = new Map(); this.pending = null; this.writes = []; this.t0 = null; this.count = 0;
  }
  listen(cdp) {
    cdp.on('Page.screencastFrame', (frame) => {
      cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
      if (this.t0 === null || cdp !== this.cdp) return;
      const t = frame.metadata.timestamp ?? Date.now() / 1000;
      const tick = Math.max(0, Math.floor((t - this.t0) * this.fps));
      if (this.pending && this.pending.tick !== tick) this.flush();
      this.pending = { tick, data: frame.data };
      this.count++;
    });
  }
  flush() {
    if (!this.pending) return;
    const file = join(this.dir, `f${String(this.pending.tick).padStart(6, '0')}.jpg`);
    this.ticks.set(this.pending.tick, file);
    this.writes.push(writeFile(file, Buffer.from(this.pending.data, 'base64')));
    this.pending = null;
  }
  async start(cdp) {
    this.t0 = Date.now() / 1000;
    await this.switchTo(cdp);
  }
  /** Films another page from now on (a scene in the phone after one in the browser), on the same clock. */
  async switchTo(cdp) {
    if (this.cdp === cdp) return;
    if (this.cdp) await this.cdp.send('Page.stopScreencast').catch(() => {});
    this.flush();
    if (!cdp.__vsListening) { this.listen(cdp); cdp.__vsListening = true; }
    this.cdp = cdp;
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 });
  }
  /** Seconds since the recording started, on the frames' clock. */
  now() { return Date.now() / 1000 - this.t0; }
  async stop() {
    if (this.cdp) await this.cdp.send('Page.stopScreencast').catch(() => {});
    this.flush();
    await Promise.all(this.writes);
  }
  /** One file per output frame from 0 to `seconds`, repeating the last frame where nothing changed. */
  sequence(seconds) {
    const total = Math.round(seconds * this.fps);
    const known = [...this.ticks.keys()].sort((a, b) => a - b);
    const out = [];
    let k = 0; let current = known.length ? this.ticks.get(known[0]) : null;
    for (let i = 0; i < total; i++) {
      while (k < known.length && known[k] <= i) { current = this.ticks.get(known[k]); k++; }
      out.push(current);
    }
    return out;
  }
}

const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

/** Waits for a page or frame to have loaded, without waiting for a network that never goes quiet (a live stream, polling). */
export async function settle(target, ms = 900) {
  await target.waitForLoadState('load').catch(() => {});
  await target.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => {});
  await sleep(ms);
}

/**
 * Records `doc`. `narration`: Map(step.key -> { file, seconds }). Returns the recording (frames,
 * step and scene timings, problems) and writes it to <dir>/recording.json.
 */
export async function record(browser, doc, narration, { base, fps, dir, vars = {} }) {
  const c = config();
  const lang = c.narration.language;
  const adapter = await loadAdapter();
  const timing = { ...c.timing, ...doc.timing };
  const today = new Date();
  vars.today ??= today.toISOString().slice(0, 10);
  vars.base ??= base;
  for (const [key, value] of Object.entries(doc.vars ?? {})) vars[key] = fill(pick(value, lang), vars);

  // What a viewer should see instead of the development address (and anything the script or config
  // rewrites: real names and emails that must not be on screen).
  const host = new URL(base).host;
  const publicUrl = c.app.publicUrl ? new URL(c.app.publicUrl) : null;
  const replace = [
    ...(publicUrl && publicUrl.host !== host ? [[`http://${host}`, publicUrl.origin], [host, publicUrl.host]] : []),
    ...Object.entries(c.app.replaceText ?? {}), ...Object.entries(doc.replaceText ?? {})
  ];
  // Requests for these origins are answered by the app being recorded: links the server writes with
  // its public address (or a CDN, an auth domain) open locally, never on production.
  const routes = [
    ...(publicUrl && publicUrl.host !== host ? [{ from: publicUrl.origin, to: base }] : []),
    ...(c.app.hostRoutes ?? []).map((r) => ({ from: r.from.replace(/\/$/, ''), to: fill(r.to, { base }).replace(/\/$/, '') }))
  ];
  const own = [base, ...routes.map((r) => r.from)];
  const ignore = (c.app.ignoreProblems ?? []).map((p) => new RegExp(p));
  const now = today.toISOString();
  const storage = Object.fromEntries(Object.entries(doc.storage ?? {}).map(([k, v]) => [k, fill((typeof v === 'string' ? v : JSON.stringify(v)).replaceAll('{now}', now), vars)]));
  const hideCss = doc.hideCss ? [].concat(doc.hideCss).join(', ') + ' { display: none !important; }' : null;
  const overlay = overlayScript();

  // What went wrong on screen while recording, per step: errors in the console, uncaught exceptions,
  // the app's own requests that failed, and pictures that did not load. Third parties are left out:
  // their own requests come and go.
  const problems = [];
  let at = 'start';
  const note = (kind, text) => {
    if (ignore.some((re) => re.test(text))) return;
    if (!problems.some((one) => one.at === at && one.kind === kind && one.text === text)) problems.push({ at, kind, text });
  };
  const isOwn = (url) => own.some((o) => url.startsWith(o));
  const short = (url) => { for (const o of own) if (url.startsWith(o)) return url.slice(o.length) || '/'; return url; };
  function watch(page) {
    page.on('console', (message) => { if (message.type() === 'error' && !/^(Failed to load resource|Blocked script execution in 'about:srcdoc')/.test(message.text())) note('console', message.text().slice(0, 300)); });
    page.on('pageerror', (error) => note('exception', error.message.split('\n')[0].slice(0, 300)));
    page.on('response', (response) => { if (response.status() >= 400 && isOwn(response.url())) note('http', `${response.status()} ${response.request().method()} ${short(response.url())}`); });
    page.on('requestfailed', (request) => { const failure = request.failure()?.errorText ?? ''; if (isOwn(request.url()) && !/ERR_ABORTED/.test(failure)) note('request', `${failure} ${short(request.url())}`); });
  }
  async function brokenPictures(stage) {
    const look = () => [...document.images].filter((img) => img.src && img.complete && img.naturalWidth === 0 && img.getClientRects().length).map((img) => (img.getAttribute('src') ?? '').slice(0, 160));
    const pages = [stage.page, ...(stage.phone ? [stage.page.frame({ name: 'app' })] : [])].filter(Boolean);
    for (const target of pages) for (const src of await target.evaluate(look).catch(() => [])) note('picture', src);
  }

  async function makeContext(kind, from) {
    const phone = kind === 'phone';
    // Chrome's screencast delivers frames at CSS-pixel size whatever the device scale, so the browser
    // is 1920 x 1080 at scale 1: every pixel sharp, nothing upscaled. `uiZoom` makes the interface
    // larger with CSS zoom (100vh layouts can then run off the screen: use with care); the `zoom`
    // action enlarges a detail instead.
    const vp = phone ? { width: 1920, height: 1080, zoom: 1 } : { ...c.app.viewport, zoom: doc.uiZoom ?? 1, ...doc.viewport };
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1,
      locale: c.app.locale?.[lang] ?? c.narration.locale ?? lang, timezoneId: doc.timezone ?? c.app.timezone, colorScheme: doc.colorScheme ?? c.app.colorScheme,
      reducedMotion: 'no-preference',
      // A second stage starts signed in as the first: the same cookies and storage.
      storageState: from ? await from.storageState() : undefined
    });
    await context.addInitScript((pairs) => { window.__vsReplace = pairs; }, replace);
    for (const r of routes) {
      const pattern = new RegExp(`^${r.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`);
      await context.route(pattern, async (route) => {
        const url = new URL(route.request().url());
        const response = await route.fetch({ url: `${r.to}${url.pathname}${url.search}` });
        await route.fulfill({ response });
      });
    }
    await context.addInitScript({ content: overlay });
    if (Object.keys(storage).length) await context.addInitScript((p) => { try { for (const [k, v] of Object.entries(p)) localStorage.setItem(k, v); } catch { /* sandboxed */ } }, storage);
    if (vp.zoom && vp.zoom !== 1) await context.addInitScript((z) => {
      // On <body>, so the drawn cursor and rings (beside it, on <html>) stay in screen pixels.
      if (window.top !== window) return;
      const add = () => { const s = document.createElement('style'); s.id = '__vs-zoom'; s.textContent = `body { zoom: ${z} !important; }`; (document.head || document.documentElement).appendChild(s); };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add, { once: true }); else add();
    }, vp.zoom);
    if (hideCss) await context.addInitScript((css) => {
      const add = () => { const s = document.createElement('style'); s.textContent = css; (document.head || document.documentElement).appendChild(s); };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add, { once: true }); else add();
    }, hideCss);
    const page = await context.newPage();
    watch(page);
    page.setDefaultTimeout(doc.timeoutMs ?? 30_000);
    return { kind, phone, vp, context, page, flags: { ...(doc.flags ?? {}) } };
  }

  async function dress(stage) {
    if (adapter.dressContext) await adapter.dressContext({ context: stage.context, page: stage.page, doc, lang, vars, base, flags: stage.flags, log });
    // Ids the app hands out while recording (a new record's), for the clean-up afterwards.
    for (const want of doc.capture ?? []) {
      stage.page.on('response', async (response) => {
        try {
          const request = response.request();
          if (request.method() !== (want.method ?? 'POST') || !new RegExp(want.url).test(new URL(response.url()).pathname)) return;
          const json = await response.json();
          for (const [as, field] of Object.entries(want.save)) {
            const value = field.split('.').reduce((o, k) => o?.[k], json);
            if (value !== undefined) vars[as] = value;
          }
        } catch { /* not JSON */ }
      });
    }
  }

  /** Opens a stage at a path: the browser at the path, the phone with the app at the path in its screen. */
  async function open(stage, path) {
    if (stage.phone) {
      await phoneRoutes(stage.context, { appSrc: path, eyebrow: pick(doc.title, lang) });
      await stage.page.goto(`${base}/__studio/phone.html`, { waitUntil: 'load' });
      await settle(stage.page.frame({ name: 'app' }), 600);
      stage.scope = stage.page.frameLocator('#app');
      await syncStatusBar(stage.page);
      stage.cursor = { x: 0, y: 0 };
    } else {
      await stage.page.goto(`${base}${path}`, { waitUntil: 'load' });
      await settle(stage.page, 300);
      stage.scope = stage.page;
      stage.cursor = { x: stage.vp.width * 0.62, y: stage.vp.height * 0.55 };
      await stage.page.mouse.move(stage.cursor.x, stage.cursor.y);
    }
  }

  const firstKind = doc.scenes[0]?.frame ?? doc.frame;
  const stages = {};
  stages[firstKind] = await makeContext(firstKind);
  const first = stages[firstKind];
  await dress(first);
  await runSetup(first.context, first.page, doc.setup, { base, lang, vars });
  await open(first, fill(pick(doc.scenes[0]?.start ?? doc.start, lang), vars));
  await sleep(doc.settleMs ?? timing.settleMs);

  const framesDir = ensureDir(join(dir, 'frames'));
  const sink = new FrameSink(framesDir, fps);
  first.cdp = await first.context.newCDPSession(first.page);
  const actor = new Actor({ doc, lang, vars, base, sink, adapter, cacheDir: ensureDir(join(c.dirs.cache, 'adapter')) });
  actor.use(first);

  await sink.start(first.cdp);
  await sleep(timing.leadInMs);
  const steps = [];
  const scenes = [];
  let current = first;
  try {
    for (const [index, scene] of doc.scenes.entries()) {
      const kind = scene.frame ?? doc.frame;
      if (kind !== current.kind || (index > 0 && scene.start)) {
        // Another stage: made once (signed in as the first), opened at the scene's start, filmed from now.
        let stage = stages[kind];
        if (!stage) {
          stage = stages[kind] = await makeContext(kind, first.context);
          await dress(stage);
          await open(stage, fill(pick(scene.start ?? doc.start, lang), vars));
          stage.cdp = await stage.context.newCDPSession(stage.page);
        } else if (scene.start) {
          const target = stage.phone ? stage.page.frame({ name: 'app' }) : stage.page;
          await target.goto(`${base}${fill(pick(scene.start, lang), vars)}`, { waitUntil: 'load' }).catch(() => {});
          await settle(target, 500);
        }
        if (stage !== current) {
          await stage.page.bringToFront();
          await sink.switchTo(stage.cdp);
          current = stage;
          actor.use(stage);
        }
      }
      const sceneStart = sink.now();
      const caption = pick(scene.caption, lang);
      if (current.phone) await current.page.evaluate(([cap, n]) => window.setCaption?.(cap, n), [caption ?? '', pick(scene.note, lang) ?? '']);
      for (const step of scene.steps) {
        const clip = narration.get(step.key);
        at = step.key;
        const stepStart = sink.now();
        actor.step = { key: step.key, start: stepStart, audio: clip?.seconds ?? 0 };
        if (step.note && current.phone) await current.page.evaluate(([cap, n]) => window.setCaption?.(cap, n), [caption ?? '', pick(step.note, lang)]);
        for (const action of step.do) {
          try {
            await actor.run(action);
          } catch (error) {
            throw new Error(`${doc.id} ${step.key} ${JSON.stringify(action)}: ${error.message.split('\n')[0]}`);
          }
        }
        // The step holds until its narration has been said, plus its own hold and the gap.
        const minEnd = stepStart + (clip?.seconds ?? 0) + (step.hold ?? 0) / 1000 + timing.stepGapMs / 1000;
        await sleep((minEnd - sink.now()) * 1000);
        await brokenPictures(current);
        steps.push({ key: step.key, scene: scene.id, start: stepStart, seconds: clip?.seconds ?? 0, file: clip?.file });
      }
      await sleep(timing.sceneGapMs - timing.stepGapMs);
      scenes.push({ id: scene.id, start: sceneStart, end: sink.now(), caption, chapter: pick(scene.chapter, lang) ?? caption, frame: current.kind });
    }
    await sleep(timing.tailMs);
  } catch (error) {
    // Let the frames already on their way land before the caller clears the folder for a retry.
    await sink.stop().catch(() => {});
    for (const stage of Object.values(stages)) await stage.context.close().catch(() => {});
    error.problems = problems;
    throw error;
  }
  const seconds = sink.now();
  await sink.stop();
  const frames = sink.sequence(seconds);
  log(`  recorded: ${seconds.toFixed(1)} s, ${sink.count} screencast frames`);
  for (const one of problems) log(`  problem at ${one.at} (${one.kind}): ${one.text}`);
  for (const stage of Object.values(stages)) await stage.context.close();
  const result = { id: doc.id, lang, seconds, fps, frames, steps, scenes, phone: doc.frame === 'phone', screenRect: PHONE.screenRect, problems, vars: { ...vars }, recorded: new Date().toISOString() };
  writeFileSync(join(dir, 'recording.json'), JSON.stringify(result, null, 1));
  return result;
}

/** The phone's status bar takes the colour the app asks the browser for. */
async function syncStatusBar(page) {
  const frame = page.frame({ name: 'app' });
  const color = await frame.evaluate(() => {
    const meta = document.querySelector('meta[name="theme-color"]')?.getAttribute('content');
    const header = document.querySelector('header, .app-header, .topbar');
    return meta || (header ? getComputedStyle(header).backgroundColor : '#ffffff');
  }).catch(() => '#ffffff');
  await page.evaluate((bg) => {
    const probe = document.createElement('div'); probe.style.color = bg; document.body.appendChild(probe);
    const [r, g, b] = getComputedStyle(probe).color.match(/\d+/g).map(Number); probe.remove();
    const ink = (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#0f1b2d' : '#ffffff';
    window.setStatus?.(bg, ink);
  }, color);
}

/**
 * Carries out a script's actions with a visible, human-paced cursor. Adapters receive it as
 * `actor` and may use: page, scope, context, base, lang, vars, stage, text(), locate(), target(),
 * moveTo(), run(), settle(), log, cacheDir.
 */
class Actor {
  constructor(o) { Object.assign(this, o); this.step = { start: 0, audio: 0 }; this.stage = null; this.log = log; this.settle = settle; this.fill = fill; }

  /** Acts on another stage (the browser or the phone), each keeping its own cursor. */
  use(stage) {
    if (this.stage) this.stage.cursor = this.cursor;
    this.stage = stage;
    this.page = stage.page; this.context = stage.context; this.scope = stage.scope; this.phone = stage.phone; this.cursor = stage.cursor ?? { x: 0, y: 0 };
  }

  /** The frame actions run in: the page, or the app inside the phone. */
  get frame() { return this.phone ? this.page.frame({ name: 'app' }) : this.page; }

  text(value) { return words(fill(pick(value, this.lang), this.vars), this.lang, this.doc.strings); }

  /** A locator from a script's target: a selector string, or { role, name, text, css, label, placeholder, testId, nth, has, within }. */
  locate(spec) {
    let root = this.scope;
    if (spec && typeof spec === 'object' && spec.within) root = this.locateIn(root, spec.within);
    return this.locateIn(root, spec);
  }
  locateIn(root, spec) {
    let loc;
    if (typeof spec === 'string' || isLangMap(spec)) loc = root.locator(this.text(spec));
    else if (spec.role) loc = root.getByRole(spec.role, spec.name !== undefined ? { name: this.text(spec.name), exact: spec.exact ?? false } : {});
    else if (spec.label) loc = root.getByLabel(this.text(spec.label), { exact: spec.exact ?? false });
    else if (spec.placeholder) loc = root.getByPlaceholder(this.text(spec.placeholder));
    else if (spec.testId) loc = root.getByTestId(spec.testId);
    else if (spec.text) loc = root.getByText(this.text(spec.text), { exact: spec.exact ?? false });
    else if (spec.css) loc = root.locator(this.text(spec.css));
    else throw new Error(`no target in ${JSON.stringify(spec)}`);
    if (typeof spec === 'object' && spec.has) loc = loc.filter({ hasText: this.text(spec.has) });
    if (typeof spec === 'string' || isLangMap(spec) || spec.visible !== false) loc = loc.filter({ visible: true });
    return typeof spec === 'object' && spec.nth !== undefined ? loc.nth(spec.nth) : loc.first();
  }

  async run(action) {
    // `- back` (a bare word) is an action without a value.
    const [name, value] = typeof action === 'string' ? [action, true] : Object.entries(action)[0];
    const builtin = this[`do_${name}`];
    const custom = this.adapter.actions?.[name];
    const fn = builtin ? (v) => builtin.call(this, v) : custom ? (v) => custom(v, this) : null;
    if (!fn) throw new Error(`unknown action ${name}`);
    const optional = value && typeof value === 'object' && (value.optional || value.target?.optional);
    if (!optional) return fn(value);
    // Something that may or may not be on screen (a cookie banner, a tip): a short look, then on.
    const spec = value.target ?? value;
    const present = await this.locate(spec).waitFor({ state: 'visible', timeout: value.timeout ?? 2500 }).then(() => true, () => false);
    if (present) await fn(value).catch(() => {});
  }

  async sleepUntilStep(fraction) {
    const until = this.step.start + this.step.audio * fraction;
    await sleep((until - this.sink.now()) * 1000);
  }

  // ---------------------------------------------------------------- the cursor --
  async moveTo(x, y, { fast = false } = {}) {
    if (this.phone) { await this.page.mouse.move(x, y); this.cursor = { x, y }; return; }
    const from = this.cursor;
    const dist = Math.hypot(x - from.x, y - from.y);
    if (dist < 2) return;
    const ms = fast ? 250 : Math.min(1100, Math.max(420, 300 + dist * 0.45));
    const steps = Math.max(8, Math.round(ms / 16));
    // A slight arc, as a hand moves.
    const nx = -(y - from.y) / dist, ny = (x - from.x) / dist;
    const bend = Math.min(60, dist * 0.08) * (x > from.x ? 1 : -1);
    const cx = (from.x + x) / 2 + nx * bend, cy = (from.y + y) / 2 + ny * bend;
    const started = Date.now();
    for (let i = 1; i <= steps; i++) {
      const k = easeInOut(i / steps);
      const px = (1 - k) * (1 - k) * from.x + 2 * (1 - k) * k * cx + k * k * x;
      const py = (1 - k) * (1 - k) * from.y + 2 * (1 - k) * k * cy + k * k * y;
      await this.page.mouse.move(px, py);
      await sleep(started + (ms * i) / steps - Date.now());
    }
    this.cursor = { x, y };
  }

  async target(spec) {
    const loc = this.locate(spec);
    await loc.waitFor({ state: 'visible' });
    await this.intoView(loc);
    const box = await loc.boundingBox();
    if (!box) throw new Error('target has no box');
    const ox = typeof spec === 'object' && spec.at ? spec.at[0] : 0.5;
    const oy = typeof spec === 'object' && spec.at ? spec.at[1] : 0.5;
    return { loc, box, x: box.x + box.width * ox, y: box.y + box.height * oy };
  }

  /** Smoothly scrolls a target's scrolling box until the target sits comfortably on screen. */
  async intoView(loc, { center = false, ms = 900 } = {}) {
    const plan = await loc.evaluate((el, centerIt) => {
      const r = el.getBoundingClientRect();
      const margin = 90;
      let box = el.parentElement;
      while (box && box !== document.body && !(/(auto|scroll)/.test(getComputedStyle(box).overflowY) && box.scrollHeight > box.clientHeight + 2)) box = box.parentElement;
      const scroller = !box || box === document.body ? document.scrollingElement : box;
      const view = scroller === document.scrollingElement ? { top: 0, bottom: innerHeight } : scroller.getBoundingClientRect();
      const fits = r.top >= view.top + margin && r.bottom <= view.bottom - margin;
      if (fits && !centerIt) return null;
      const z = scroller === document.scrollingElement ? 1 : (scroller.currentCSSZoom || 1);
      const wanted = scroller.scrollTop + ((r.top + r.height / 2) - (view.top + view.bottom) / 2) / z;
      const max = scroller.scrollHeight - scroller.clientHeight;
      const top = Math.max(0, Math.min(max, wanted));
      if (Math.abs(top - scroller.scrollTop) < 4) return null;
      window.__vsScroller = scroller;
      return { delta: top - scroller.scrollTop, top };
    }, center);
    if (!plan) return;
    const duration = Math.min(1400, Math.max(500, Math.abs(plan.delta) * 0.9, ms * 0.6));
    if (this.phone) {
      // A finger swipe drawn over the phone while the content moves.
      const y1 = 560, y2 = Math.max(160, Math.min(760, y1 - Math.sign(plan.delta) * 300));
      void loc.evaluate((el, [a, b, t]) => window.__vs?.swipe(200, a, b, t), [y1, y2, duration]).catch(() => {});
    }
    await loc.evaluate((el, [top, t]) => window.__vs.scrollTo(window.__vsScroller, top, t), [plan.top, duration]);
    await sleep(120);
  }

  // ---------------------------------------------------------------- actions --
  async do_goto(value) {
    const url = this.text(typeof value === 'object' && value.url ? value.url : value);
    await this.frame.goto(`${this.base}${url}`, { waitUntil: 'load' }).catch(() => {});
    await settle(this.frame, 500);
  }

  /** Another view of a single-page app by its address hash, without reloading the page. */
  async do_hash(value) {
    await this.frame.evaluate((h) => { location.hash = h; }, this.text(value));
    await sleep(800);
  }

  async do_back() { await this.frame.goBack(); await sleep(500); }

  async do_click(spec) {
    const t = await this.target(spec);
    await this.moveTo(t.x, t.y);
    await sleep(110);
    await this.page.mouse.down();
    await sleep(80);
    await this.page.mouse.up();
    await sleep(typeof spec === 'object' && spec.after !== undefined ? spec.after : 450);
  }
  async do_tap(spec) { return this.do_click(spec); }

  async do_hover(spec) {
    const t = await this.target(spec);
    await this.moveTo(t.x, t.y);
    await sleep(300);
  }

  /** Typed key by key, at a rhythm that is the same every render (seeded by the step). */
  async do_type(value) {
    const t = await this.target(value.target);
    await this.moveTo(t.x, t.y);
    await sleep(90);
    await this.page.mouse.down(); await sleep(60); await this.page.mouse.up();
    await sleep(200);
    if (value.clear !== false) {
      await t.loc.press('ControlOrMeta+a');
      await t.loc.press('Backspace');
    }
    const text = this.text(value.text);
    const delay = value.delay ?? 55;
    const random = seededRandom(`${this.doc.id}|${this.step.key}|${text}`);
    for (const ch of text) {
      await this.page.keyboard.type(ch);
      await sleep(delay * (0.6 + random() * 0.8));
    }
    await sleep(250);
  }

  async do_fill(value) {
    const t = await this.target(value.target);
    await this.moveTo(t.x, t.y);
    await sleep(90);
    await this.page.mouse.down(); await sleep(60); await this.page.mouse.up();
    await sleep(150);
    await t.loc.fill(this.text(value.text));
    await sleep(350);
  }

  /**
   * Files chosen in a file field: the cursor goes to the drop area or button (`target`) and the
   * files (paths relative to config paths.assets) are handed over as a file dialog would.
   */
  async do_upload(value) {
    const files = [].concat(value.files).map((f) => join(config().dirs.assets, f));
    if (value.target) {
      const chooser = this.page.waitForEvent('filechooser', { timeout: 10_000 });
      await this.do_click({ ...(typeof value.target === 'string' ? { css: value.target } : value.target), after: 0 });
      await (await chooser).setFiles(files);
    } else {
      await this.scope.locator(value.input ?? 'input[type=file]').first().setInputFiles(files);
    }
    await sleep(value.after ?? 800);
  }

  async do_press(key) { await this.page.keyboard.press(key); await sleep(300); }

  async do_select(value) {
    const t = await this.target(value.target);
    await this.moveTo(t.x, t.y);
    await sleep(90);
    await this.page.mouse.down(); await sleep(60); await this.page.mouse.up();
    await this.page.keyboard.press('Escape').catch(() => {});
    await t.loc.selectOption(value.label ? { label: this.text(value.label) } : this.text(value.value));
    await sleep(400);
  }

  async do_scroll(value) {
    if (value.to) {
      const loc = this.locate(value.to);
      await loc.waitFor({ state: 'visible' });
      await this.intoView(loc, { center: value.center ?? true, ms: value.ms ?? 1000 });
      return;
    }
    const loc = value.in ? this.locate(value.in) : null;
    const amount = value.by ?? 500;
    const ms = value.ms ?? Math.min(1600, Math.max(600, Math.abs(amount) * 1.1));
    const frame = this.frame;
    if (this.phone) void frame.evaluate(([a, b, t]) => window.__vs?.swipe(200, a, b, t), [amount > 0 ? 620 : 260, amount > 0 ? 260 : 620, ms]).catch(() => {});
    const scrollIt = (el, [by, t, edge]) => {
      let box = el;
      while (box && box !== document.body && !(/(auto|scroll)/.test(getComputedStyle(box).overflowY) && box.scrollHeight > box.clientHeight + 2)) box = box.parentElement;
      const s = !box || box === document.body ? document.scrollingElement : box;
      const target = edge === 'top' ? 0 : edge === 'bottom' ? s.scrollHeight : s.scrollTop + by;
      return window.__vs.scrollTo(s, Math.max(0, Math.min(s.scrollHeight - s.clientHeight, target)), t);
    };
    const arg = [amount, ms, value.edge ?? null];
    if (loc) await loc.evaluate(scrollIt, arg);
    else await frame.evaluate(([by, t, edge]) => {
      // The page, or the largest scrolling box on it when the page itself does not scroll (an app shell).
      let s = document.scrollingElement;
      if (s.scrollHeight <= s.clientHeight + 2) {
        const boxes = [...document.querySelectorAll('*')].filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 2);
        boxes.sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth);
        if (boxes[0]) s = boxes[0];
      }
      const target = edge === 'top' ? 0 : edge === 'bottom' ? s.scrollHeight : s.scrollTop + by;
      return window.__vs.scrollTo(s, Math.max(0, Math.min(s.scrollHeight - s.clientHeight, target)), t);
    }, arg);
    await sleep(150);
  }

  async do_highlight(value) {
    const spec = value.target ?? value;
    const loc = this.locate(spec);
    await loc.waitFor({ state: 'visible' });
    await this.intoView(loc);
    await loc.evaluate((el, opts) => window.__vs.highlight(el.getBoundingClientRect(), opts), { pad: value.pad ?? 8, spot: value.spot ?? false, radius: value.radius ?? 12 });
    if (value.ms) { await sleep(value.ms); await this.do_unhighlight(); } else await sleep(500);
  }

  async do_unhighlight() {
    await this.page.evaluate(() => window.__vs?.unhighlight());
    if (this.phone) await this.frame.evaluate(() => window.__vs?.unhighlight()).catch(() => {});
    await sleep(250);
  }

  async do_zoom(value) {
    const spec = value.target ?? value;
    const loc = this.locate(spec);
    await loc.waitFor({ state: 'visible' });
    await this.intoView(loc);
    const box = await loc.boundingBox();
    const ms = value.ms ?? 1000;
    await this.page.evaluate(([rect, scale, t]) => window.__vs.zoom(rect, scale, t), [box, value.scale ?? 1.6, ms]);
    await sleep(ms + 100);
  }

  async do_unzoom(value) {
    const ms = (value && value.ms) ?? 900;
    await this.page.evaluate((t) => window.__vs.unzoom(t), ms);
    await sleep(ms + 100);
  }

  /** wait: 800 (ms) | "1.2s" | "60%" (until 60 % of this step's narration has been said). */
  async do_wait(value) {
    if (typeof value === 'string' && value.endsWith('%')) return this.sleepUntilStep(parseFloat(value) / 100);
    if (typeof value === 'string' && value.endsWith('s') && !value.endsWith('ms')) return sleep(parseFloat(value) * 1000);
    return sleep(parseFloat(value));
  }

  async do_waitFor(spec) { await this.locate(spec).waitFor({ state: 'visible', timeout: (typeof spec === 'object' && spec.timeout) || 30_000 }); }

  async do_cursor(value) {
    if (value.target) { const t = await this.target(value.target); await this.moveTo(t.x, t.y); } else await this.moveTo(value.x, value.y);
  }

  async do_drag(value) {
    const from = await this.target(value.from);
    await this.moveTo(from.x, from.y);
    await this.page.mouse.down();
    await sleep(150);
    let to;
    if (value.to) { const t = await this.target(value.to); to = { x: t.x, y: t.y }; } else to = { x: from.x + (value.dx ?? 0), y: from.y + (value.dy ?? 0) };
    await this.moveTo(to.x, to.y);
    await sleep(150);
    await this.page.mouse.up();
    await sleep(400);
  }

  async do_eval(code) {
    const result = await this.frame.evaluate(fill(code, this.vars));
    if (result && typeof result === 'object') Object.assign(this.vars, result);
    await sleep(200);
  }

  async do_hide(css) {
    await this.frame.evaluate((sel) => { const s = document.createElement('style'); s.textContent = `${sel} { display: none !important; }`; document.head.appendChild(s); }, this.text(css));
  }

  /**
   * Changes the flags the adapter dresses the app with from here on (dressContext reads them on
   * every request), then reloads so the app starts with them: { flags: { demoBanner: false } }.
   */
  async do_flags(value) {
    const { reload = true, ...flags } = value;
    Object.assign(this.stage.flags, flags);
    if (reload) { await this.page.reload({ waitUntil: 'load' }); await settle(this.page, 600); }
  }
}
