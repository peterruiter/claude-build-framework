#!/usr/bin/env node
// video-tour: narrated feature tours of a web product from YAML scripts. See README.md.
//
//   init [--dir D] [--force]          a config, an example script, adapter and sample page
//   list | validate [part...]         the scripts; validate also checks config, translations, adapter names
//   i18n [part...]                    what still needs translating (JSON, with src hashes)
//   estimate                          characters and cost of the narration, and what was spent
//   tts [part...]                     synthesise (and cache) narration only
//   dry [part...]                     rehearse: no voice, no assembly, a contact sheet per script
//   record [part...]                  record (frames + timings into the work folder)
//   assemble [part...]                cards, sound, MP4, subtitles, thumbnail, poster from the last recording
//   render [part...]                  record + assemble + manifest (the usual command)
//   manifest [part...]                subtitles, manifest.json and youtube.md again from the last render
//   review [part...] [--at 5,60]      contact sheet and stills of a rendered video
//   qa [part...]                      transcribe the narration back and flag lost words (Azure)
//   library [--strict]                catalogue JSON + posters + VTTs for a self-hosted library
//   youtube <plan|apply|playlist|captions|daily|replace|upload|catchup|quota> [part...]
//
// Options: --config FILE, --no-voice (silent narration), --offline, --keep, --attempts N, --fps N,
// --base URL, --no-start, --burn-in LANG, --client FILE (YouTube OAuth client).
import { readFileSync, existsSync, rmSync, writeFileSync, readdirSync, copyFileSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { loadConfig, config, CONFIG_NAME } from './config.mjs';
import { toolDir, ensureDir, log, formatDuration, ffmpeg, ffmpegPath } from './util.mjs';

const argv = process.argv.slice(2);
const command = argv.shift();
const flags = {};
const rest = [];
const BOOLEAN = new Set(['no-voice', 'offline', 'keep', 'no-start', 'force', 'strict', 'verbose']);
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) {
    const [k, v] = argv[i].slice(2).split('=');
    flags[k] = v ?? (BOOLEAN.has(k) || !argv[i + 1] || argv[i + 1].startsWith('--') ? true : argv[++i]);
  } else rest.push(argv[i]);
}

const HELP = readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).slice(0, 21).map((l) => l.slice(3)).join('\n');

async function pickScripts(args = rest) {
  const { listScripts, findScript } = await import('./script.mjs');
  if (!args.length || args[0] === 'all') return listScripts();
  return args.map((one) => findScript(one));
}

/** Copies the example project into `dir`, without overwriting anything unless --force. */
function init() {
  const target = resolve(flags.dir ?? '.');
  const source = join(toolDir, 'example');
  const copied = [];
  const skipped = [];
  const walk = (from, to) => {
    for (const name of readdirSync(from)) {
      if (['.work', '.cache', 'output', 'library', 'youtube-state.json', 'node_modules'].includes(name)) continue;
      const a = join(from, name);
      const b = join(to, name);
      if (statSync(a).isDirectory()) { mkdirSync(b, { recursive: true }); walk(a, b); continue; }
      if (existsSync(b) && !flags.force) { skipped.push(relative(target, b)); continue; }
      copyFileSync(a, b);
      copied.push(relative(target, b));
    }
  };
  ensureDir(target);
  walk(source, target);
  // The start command points at this tool wherever it lives.
  const cfg = join(target, CONFIG_NAME);
  if (copied.includes(CONFIG_NAME)) {
    const json = JSON.parse(readFileSync(cfg, 'utf8'));
    if (json.app?.start?.command) json.app.start.command = json.app.start.command.replace('{tool}', relative(target, toolDir).replace(/\\/g, '/') || '.');
    writeFileSync(cfg, JSON.stringify(json, null, 2) + '\n');
  }
  console.log(`Copied ${copied.length} file(s) into ${target}:`);
  for (const f of copied) console.log(`  ${f}`);
  if (skipped.length) console.log(`Kept ${skipped.length} existing file(s) (use --force to overwrite): ${skipped.join(', ')}`);
  console.log(`\nNext:\n  node ${relative(process.cwd(), join(toolDir, 'src', 'cli.mjs')).replace(/\\/g, '/')} validate\n  node ${relative(process.cwd(), join(toolDir, 'src', 'cli.mjs')).replace(/\\/g, '/')} render all --no-voice\n` +
    'Then edit video-tour.config.json (product, brand, app, narration, languages) and the scripts. Add video-tour/.work, .cache and output to .gitignore (the example has one).');
}

async function main() {
  if (!command || command === 'help' || flags.help) { console.log(HELP); return; }
  if (command === 'init') return init();

  const c = loadConfig(flags.config);
  const { setProvider } = await import('./tts.mjs');
  if (flags['no-voice']) setProvider('silent');
  const { loadAdapter, adapterNames } = await import('./adapter.mjs');
  const adapter = await loadAdapter();
  const names = adapterNames(adapter);
  const lang = c.narration.language;
  const outDir = c.dirs.output;

  if (command === 'validate' || command === 'list') {
    const { checkScript, narratedSteps } = await import('./script.mjs');
    const { scriptChars, estimateSeconds } = await import('./tts.mjs');
    let failed = false;
    let total = 0;
    if (command === 'validate') {
      for (const note of checkConfig(c)) console.log(`config: ${note}`);
    }
    for (const doc of await pickScripts()) {
      const { errors, warnings } = checkScript(doc, names);
      const seconds = narratedSteps(doc).reduce((s, { step }) => s + estimateSeconds(step.say[lang] ?? '') + 0.6, 0) + c.timing.introSeconds + c.timing.outroSeconds;
      total += seconds;
      console.log(`${String(doc.order).padStart(2)} ${String(doc.id).padEnd(28)} ${doc.frame.padEnd(7)} ~${formatDuration(seconds)}  ${doc.title?.[lang] ?? ''}${command === 'list' ? `  (${scriptChars(doc)} chars)` : ''}`);
      for (const e of errors) console.log(`     error: ${e}`);
      if (command === 'validate') for (const w of warnings) console.log(`     note: ${w}`);
      if (errors.length) failed = true;
    }
    console.log(`\n~${formatDuration(total)} in all${failed ? '; errors stop a render' : ''}`);
    process.exitCode = failed ? 1 : 0;
    return;
  }

  if (command === 'i18n') {
    const { translationTodo } = await import('./script.mjs');
    for (const doc of await pickScripts()) console.log(JSON.stringify(translationTodo(doc), null, 2));
    return;
  }

  if (command === 'estimate') {
    const { scriptChars } = await import('./tts.mjs');
    const { listScripts } = await import('./script.mjs');
    let chars = 0;
    for (const doc of listScripts()) chars += scriptChars(doc);
    const price = c.narration.pricePerMillion;
    console.log(`All scripts, one render of every narrated step and title: ${chars.toLocaleString('en')} characters (${c.narration.voice}, $${price}/M) = $${((chars / 1e6) * price).toFixed(2)}`);
    console.log('Re-renders of unchanged text cost nothing: narration is cached.');
    const usage = join(c.dirs.cache, 'usage.jsonl');
    if (existsSync(usage)) {
      const rows = readFileSync(usage, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
      const spent = rows.reduce((s, r) => s + r.chars, 0);
      console.log(`Spent so far (requests that reached Azure): ${spent.toLocaleString('en')} characters in ${rows.length} requests = $${((spent / 1e6) * price).toFixed(2)}`);
    }
    return;
  }

  if (command === 'tts') {
    const { narrate, synthesise } = await import('./tts.mjs');
    for (const doc of await pickScripts()) {
      log(doc.id);
      await narrate(doc, { offline: Boolean(flags.offline) });
      await synthesise(doc.title[lang], { offline: Boolean(flags.offline) });
    }
    return;
  }

  if (command === 'qa') {
    const { provider, narrate } = await import('./tts.mjs');
    if (provider() !== 'azure') { console.log(`qa compares Azure's narration with the script; the provider is "${provider()}". Nothing to check.`); return; }
    const { transcribe, wordLoss } = await import('./qa.mjs');
    const { narratedSteps, writtenText } = await import('./script.mjs');
    const threshold = Number(flags.threshold ?? 0.15);
    let flagged = 0;
    for (const doc of await pickScripts()) {
      const clips = await narrate(doc, { offline: true }).catch((error) => {
        throw new Error(`${doc.id}: qa listens to the cached Azure narration; synthesise it first ("tts" or "render"). ${error.message}`);
      });
      for (const { step } of narratedSteps(doc)) {
        const heard = await transcribe(clips.get(step.key).file);
        const loss = wordLoss(writtenText(step.say[lang]), heard);
        const bad = loss.ratio > threshold;
        if (bad) flagged++;
        console.log(`${bad ? 'CHECK' : 'ok   '} ${doc.id} ${step.key} lost ${(loss.ratio * 100).toFixed(0)}%${loss.missing.length ? ` (${loss.missing.slice(0, 6).join(', ')})` : ''}`);
        if (flags.verbose || bad) console.log(`      heard: ${heard}`);
      }
    }
    console.log(flagged ? `\n${flagged} step(s) to listen to: give them "take: 1" (a fresh rendering) or a lexicon entry, then render again.` : '\nEvery step came back as written.');
    process.exitCode = flagged ? 1 : 0;
    return;
  }

  if (command === 'review') {
    const { baseName } = await import('./script.mjs');
    for (const doc of await pickScripts()) {
      const mp4 = join(outDir, baseName(doc), `${baseName(doc)}.${lang}.mp4`);
      if (!existsSync(mp4)) { console.log(`${doc.id}: not rendered`); continue; }
      const dir = ensureDir(join(c.dirs.work, 'review', doc.id));
      const every = Number(flags.every ?? 4);
      await ffmpeg(['-i', mp4, '-vf', `fps=1/${every},scale=480:-1,tile=6x8:padding=4`, '-frames:v', '1', join(dir, 'sheet.png')]);
      for (const at of String(flags.at ?? '').split(',').filter(Boolean)) await ffmpeg(['-ss', at, '-i', mp4, '-frames:v', '1', join(dir, `t${at}.png`)]);
      console.log(`${doc.id}: ${dir}`);
    }
    return;
  }

  if (command === 'manifest' || command === 'subtitles') {
    const { writeSubtitles, chaptersOf } = await import('./assemble.mjs');
    const { updateManifest } = await import('./manifest.mjs');
    const { baseName } = await import('./script.mjs');
    for (const doc of await pickScripts()) {
      const file = join(c.dirs.work, doc.id, 'assembled.json');
      if (!existsSync(file)) { console.log(`${doc.id}: not rendered here yet`); continue; }
      const { result, timing } = JSON.parse(readFileSync(file, 'utf8'));
      const { subtitles, speeds } = writeSubtitles(doc, timing, join(outDir, baseName(doc)));
      updateManifest(outDir, doc, { ...result, subtitles, chapters: chaptersOf(timing.scenes, timing.mainAt), readingSpeed: speeds });
      console.log(`${doc.id}: subtitles in ${Object.keys(subtitles).join(', ')}; manifest updated`);
    }
    console.log(`${join(outDir, 'manifest.json')}\n${join(outDir, 'youtube.md')}`);
    return;
  }

  if (command === 'library') {
    const { buildLibrary } = await import('./library.mjs');
    await buildLibrary({ strict: flags.strict ? true : undefined });
    return;
  }

  if (command === 'youtube') {
    const { youtube } = await import('./youtube.mjs');
    const [sub, ...parts] = rest;
    await youtube(sub, parts, { client: flags.client });
    return;
  }

  if (['dry', 'record', 'assemble', 'render'].includes(command)) return recording(command, adapter, names);

  console.log(HELP);
  process.exitCode = 2;
}

/** Notes about the config: languages without words, keys not set, ffmpeg. */
function checkConfig(c) {
  const notes = [];
  for (const l of c.languages) {
    if (l === 'en') continue;
    const missing = ['series', 'seriesShort', 'tryIt', 'note'].filter((k) => !c.text[l]?.[k]);
    if (missing.length) notes.push(`text.${l} has no ${missing.join(', ')} (English is used in ${l} descriptions and cards)`);
  }
  if (c.narration.provider === 'azure' && c.narration.auth !== 'entra' && !process.env[c.narration.keyEnv]) notes.push(`${c.narration.keyEnv} is not set: render with --no-voice, or set it in your shell (never in the config)`);
  if (c.narration.provider === 'azure' && !c.narration.region && !c.narration.endpoint) notes.push('narration.region or narration.endpoint is needed for Azure Speech');
  if (!ffmpegPath) notes.push('no ffmpeg: npm install in tools/video-tour, or put ffmpeg on the PATH');
  if (c.dirs.logo && !existsSync(c.dirs.logo)) notes.push(`brand.logo ${c.dirs.logo} does not exist`);
  if (c.dirs.font && !existsSync(c.dirs.font)) notes.push(`brand.font.file ${c.dirs.font} does not exist`);
  return notes;
}

async function recording(mode, adapter, names) {
  const c = config();
  const lang = c.narration.language;
  const { checkScript, narratedSteps, baseName } = await import('./script.mjs');
  const { narrate, synthesise, estimateSeconds, setProvider } = await import('./tts.mjs');
  const { launchBrowser } = await import('./browser.mjs');
  const { record } = await import('./recorder.mjs');
  const { assemble } = await import('./assemble.mjs');
  const { updateManifest } = await import('./manifest.mjs');
  const { runSetup } = await import('./adapter.mjs');
  const { withApp } = await import('./app.mjs');
  if (mode === 'dry') setProvider('silent');
  const docs = await pickScripts();
  const fps = Number(flags.fps ?? (mode === 'dry' ? 10 : c.video.fps));
  const outDir = ensureDir(c.dirs.output);
  const failed = [];
  const problemCount = {};

  const run = async (base) => {
    if (adapter.beforeAll && mode !== 'assemble') await adapter.beforeAll({ base, config: c, log });
    const browser = await launchBrowser();
    try {
      for (const doc of docs) {
        // One video failing does not stop the series: it is reported at the end, the rest go on.
        try {
          const { errors } = checkScript(doc, names);
          if (errors.length) throw new Error(errors.join('; '));
          const dir = join(c.dirs.work, mode === 'dry' ? `${doc.id}-dry` : doc.id);
          let rec;
          if (mode !== 'assemble') {
            log(`${doc.id} (${base})`);
            const narration = mode === 'dry'
              ? new Map(narratedSteps(doc).map(({ step }) => [step.key, { seconds: estimateSeconds(step.say[lang]) }]))
              : await narrate(doc, { offline: Boolean(flags.offline) });
            // A recording against a live system can stumble (a slow response, a restart): try again.
            for (let attempt = 1; !rec; attempt++) {
              rmSync(dir, { recursive: true, force: true });
              ensureDir(dir);
              const vars = { run: Date.now().toString(36).slice(-5) };
              try {
                rec = await record(browser, doc, narration, { base, fps, dir, vars });
              } catch (error) {
                for (const p of error.problems ?? []) log(`  problem at ${p.at} (${p.kind}): ${p.text}`);
                if (attempt >= Number(flags.attempts ?? 2)) throw error;
                log(`  attempt ${attempt} failed, trying again: ${error.message.split('\n')[0]}`);
              } finally {
                if (doc.cleanup) {
                  const ctx = await browser.newContext();
                  await runSetup(ctx, await ctx.newPage(), doc.cleanup, { base, lang, vars }).catch((error) => log(`  cleanup: ${error.message}`));
                  await ctx.close();
                }
              }
            }
            problemCount[doc.id] = rec.problems.length;
          } else {
            const file = join(dir, 'recording.json');
            if (!existsSync(file)) throw new Error('not recorded yet (run "record" first)');
            rec = JSON.parse(readFileSync(file, 'utf8'));
            problemCount[doc.id] = rec.problems?.length ?? 0;
          }
          if (mode === 'dry') {
            const every = Number(flags.every ?? 3);
            const picks = rec.frames.filter((_, i) => i % Math.max(1, every * fps) === Math.floor(fps / 2));
            const list = join(dir, 'sheet.txt');
            writeFileSync(list, picks.map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n'));
            const cols = 5; const rows = Math.max(1, Math.ceil(picks.length / cols));
            const sheet = join(dir, `${doc.id}.sheet.png`);
            await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-vf', `scale=480:-1,tile=${cols}x${rows}:padding=4`, '-frames:v', '1', sheet]);
            console.log(`${doc.id}: ${rec.seconds.toFixed(0)} s, contact sheet (a frame every ${every} s): ${sheet}`);
            console.log(`  steps: ${rec.steps.map((s) => `${s.key}@${s.start.toFixed(1)}`).join(' ')}`);
            continue;
          }
          if (mode === 'record') { console.log(`${doc.id}: recorded (${rec.seconds.toFixed(1)} s); "assemble" makes the video`); continue; }
          const titleClip = await synthesise(doc.title[lang], { offline: Boolean(flags.offline) });
          const result = await assemble(browser, doc, rec, titleClip, { dir, outDir, burnIn: flags['burn-in'] });
          updateManifest(outDir, doc, result);
          if (!flags.keep) rmSync(join(dir, 'frames'), { recursive: true, force: true });
          console.log(`${doc.id}: ${relative(process.cwd(), result.mp4)}`);
        } catch (error) {
          failed.push(doc.id);
          console.error(`FAILED ${doc.id}: ${error.message.split('\n')[0]}`);
        }
      }
    } finally {
      await browser.close();
      if (adapter.afterAll && mode !== 'assemble') await adapter.afterAll({ base, config: c, log }).catch((e) => log(`afterAll: ${e.message}`));
    }
  };

  if (mode === 'assemble') await run(c.app.base);
  else {
    if (flags.base) c.app.base = String(flags.base).replace(/\/$/, '');
    await withApp(run, { noStart: Boolean(flags['no-start']) });
  }
  const withProblems = Object.entries(problemCount).filter(([, n]) => n);
  if (withProblems.length) console.log(`\nProblems seen on screen (console errors, failed requests, broken pictures): ${withProblems.map(([id, n]) => `${id} ${n}`).join(', ')}. Details in each recording.json under ${c.dirs.work}.`);
  if (failed.length) { console.error(`Not done: ${failed.join(' ')}`); process.exitCode = 1; }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
