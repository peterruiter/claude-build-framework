// Narration, cached by what was asked for. Three providers:
//
//   azure   Azure AI Speech (REST, SSML): the voice the videos are published with.
//   system  the machine's own voice (Windows SAPI, macOS `say`, espeak-ng on Linux): rough, but it
//           needs no account; good for rehearsing timing with sound.
//   silent  no sound at all, each clip as long as the text would take to say (charsPerSecond):
//           the --no-voice mode, for trying a script or running the pipeline without keys.
//
// Each step is synthesised on its own, so the recorder knows how long every sentence is and makes
// the screen wait for it. A clip is made once per (provider, voice, settings, text): changing one
// sentence re-synthesises one sentence. Every Azure request is added to <cache>/usage.jsonl with its
// billable characters, which `estimate` reads.
import { readFileSync, writeFileSync, existsSync, appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { config } from './config.mjs';
import { speechHeaders, forgetToken, ttsUrl } from './azure.mjs';
import { ensureDir, sha, log, sleep, ffmpeg } from './util.mjs';
import { readWav, writeWav, trimSilence, silence } from './wav.mjs';
import { spokenSsml, spokenPlain, writtenText, narratedSteps } from './script.mjs';

const OUTPUT = 'riff-48khz-16bit-mono-pcm';
const RATE = 48000;
const ttsDir = () => ensureDir(join(config().dirs.cache, 'tts'));

let override = null;
/** --no-voice: every clip silent, whatever the config says. */
export function setProvider(name) { override = name; }
export function provider() { return override ?? config().narration.provider; }

export function ssmlFor(text) {
  const n = config().narration;
  let body = spokenSsml(text, n.language, n);
  if (n.rate && !n.hd) body = `<prosody rate="${n.rate}">${body}</prosody>`;
  const params = n.parameters ? ` parameters="${n.parameters}"` : '';
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${n.locale}">`
    + `<voice name="${n.voice}"${params}>${body}</voice></speak>`;
}

/** Billable characters as Azure counts them: the text spoken, aliases included, tags not. */
export function billableChars(ssml) {
  const aliases = [...ssml.matchAll(/alias="([^"]*)"/g)].map((m) => m[1]).join('');
  const text = ssml.replace(/<sub alias="[^"]*">[^<]*<\/sub>/g, '').replace(/<[^>]+>/g, '');
  return text.length + aliases.length;
}

/** Seconds a text would take to say, from its length: the silent provider and `dry` use it. */
export function estimateSeconds(text) {
  const n = config().narration;
  const pauses = [...String(text).matchAll(/\[pause\s*(\d+)/gi)].reduce((s, m) => s + Number(m[1]) / 1000, 0);
  return Math.max(0.8, writtenText(text).length / n.charsPerSecond + pauses);
}

function cacheKey(text, take) {
  const n = config().narration;
  const p = provider();
  if (p === 'azure') return `azure|${n.voice}|${n.parameters ?? ''}|${n.rate ?? ''}|${OUTPUT}|${ssmlFor(text)}|${take ?? 0}`;
  if (p === 'system') return `system|${n.systemVoice ?? ''}|${process.platform}|${spokenPlain(text, n.language)}|${take ?? 0}`;
  return `silent|${n.charsPerSecond}|${writtenText(text)}`;
}

/**
 * The narration of one piece of text: { file, seconds, cached }. `take` asks for a fresh
 * rendering of the same text (neural voices vary a little each time).
 */
export async function synthesise(text, { take = 0, offline = false } = {}) {
  const n = config().narration;
  const p = provider();
  const file = join(ttsDir(), `${n.language}-${p}-${sha(cacheKey(text, take))}.wav`);
  if (existsSync(file)) return { file, seconds: duration(file), cached: true };
  if (p === 'silent') {
    writeFileSync(file, writeWav(silence(estimateSeconds(text), RATE), RATE));
    return { file, seconds: duration(file), cached: false };
  }
  if (offline) throw new Error(`Not cached and --offline: "${writtenText(text).slice(0, 60)}"`);
  if (p === 'system') {
    await systemVoice(spokenPlain(text, n.language), file);
    return { file, seconds: duration(file), cached: false };
  }
  if (p !== 'azure') throw new Error(`Unknown narration.provider "${p}" (azure, system or silent)`);

  const ssml = ssmlFor(text);
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(ttsUrl(), {
      method: 'POST',
      headers: { ...(await speechHeaders()), 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': OUTPUT, 'User-Agent': 'video-tour' },
      body: ssml
    });
    if (response.ok) {
      const wav = trimSilence(readWav(Buffer.from(await response.arrayBuffer())));
      writeFileSync(file, writeWav(wav.samples, wav.sampleRate));
      appendFileSync(join(config().dirs.cache, 'usage.jsonl'), JSON.stringify({ at: new Date().toISOString(), voice: n.voice, chars: billableChars(ssml) }) + '\n');
      return { file, seconds: duration(file), cached: false };
    }
    const detail = (await response.text()).slice(0, 300);
    if (response.status === 401 && attempt === 1 && n.auth === 'entra') { forgetToken(); continue; }
    if ((response.status === 429 || response.status >= 500) && attempt < 6) {
      await sleep((Number(response.headers.get('retry-after')) || 1.5 * attempt) * 1000);
      continue;
    }
    throw new Error(`Speech ${response.status}: ${detail || response.statusText}`);
  }
}

/** The operating system's voice into a 48 kHz mono WAV. */
async function systemVoice(text, file) {
  const raw = `${file}.raw`;
  const n = config().narration;
  let result;
  if (process.platform === 'win32') {
    // Text through the environment, never the command line: no quoting to get wrong.
    const ps = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer;`
      + (n.systemVoice ? ` $s.SelectVoice($env:VT_VOICE);` : '')
      + ` $s.SetOutputToWaveFile($env:VT_OUT); $s.Speak($env:VT_TEXT); $s.Dispose()`;
    result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { env: { ...process.env, VT_TEXT: text, VT_OUT: `${raw}.wav`, VT_VOICE: n.systemVoice ?? '' }, windowsHide: true });
  } else if (process.platform === 'darwin') {
    result = spawnSync('say', [...(n.systemVoice ? ['-v', n.systemVoice] : []), '-o', `${raw}.wav`, '--data-format=LEI16@22050', text]);
  } else {
    result = spawnSync('espeak-ng', [...(n.systemVoice ? ['-v', n.systemVoice] : []), '-w', `${raw}.wav`, text]);
    if (result.error) result = spawnSync('espeak', ['-w', `${raw}.wav`, text]);
  }
  if (result.error || result.status !== 0 || !existsSync(`${raw}.wav`)) {
    throw new Error(`The system voice failed (${result.error?.message ?? String(result.stderr).slice(0, 200)}). Use narration.provider "silent" or --no-voice.`);
  }
  await ffmpeg(['-i', `${raw}.wav`, '-ar', String(RATE), '-ac', '1', '-c:a', 'pcm_s16le', `${raw}.48k.wav`]);
  const wav = trimSilence(readWav(readFileSync(`${raw}.48k.wav`)));
  writeFileSync(file, writeWav(wav.samples, wav.sampleRate));
  rmSync(`${raw}.wav`, { force: true });
  rmSync(`${raw}.48k.wav`, { force: true });
}

function duration(file) {
  const wav = readWav(readFileSync(file));
  return wav.samples.length / wav.sampleRate;
}

/** Narration for every step of a script: Map(step.key -> { file, seconds }). A few requests at once. */
export async function narrate(doc, { offline = false } = {}) {
  const lang = config().narration.language;
  const steps = narratedSteps(doc);
  const out = new Map();
  let made = 0;
  const queue = [...steps];
  async function worker() {
    while (queue.length) {
      const { step } = queue.shift();
      const take = typeof step.take === 'object' ? step.take?.[lang] : step.take;
      const clip = await synthesise(step.say[lang], { offline, take: take ?? 0 });
      if (!clip.cached) made++;
      out.set(step.key, clip);
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  log(`  narration (${provider()}): ${steps.length} steps, ${made} made, ${steps.length - made} from cache`);
  return out;
}

/** Characters a script would bill, cached or not (title included). */
export function scriptChars(doc) {
  const lang = config().narration.language;
  return narratedSteps(doc).reduce((sum, { step }) => sum + billableChars(ssmlFor(step.say[lang] ?? '')), billableChars(ssmlFor(doc.title?.[lang] ?? '')));
}
