// Small shared helpers: hashing, running ffmpeg, logging, language picking, a seeded random.
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** The tool's own folder (tools/video-tour). */
export const toolDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const templatesDir = join(toolDir, 'src', 'templates');

/** ffmpeg: FFMPEG, else ffmpeg-static, else ffmpeg on the PATH. */
export const ffmpegPath = (() => {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  try { const p = require('ffmpeg-static'); if (p && existsSync(p)) return p; } catch { /* not installed */ }
  const probe = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  if (probe.status === 0) return 'ffmpeg';
  return null;
})();

export function ensureDir(path) {
  mkdirSync(path, { recursive: true });
  return path;
}

export function sha(text, length = 16) {
  return createHash('sha256').update(text).digest('hex').slice(0, length);
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export const sleep = (ms) => new Promise((done) => setTimeout(done, Math.max(0, ms)));

let quiet = false;
export function setQuiet(value) { quiet = value; }
export function log(...parts) { if (!quiet) console.log(...parts); }

/**
 * Runs ffmpeg and resolves with its stderr (where ffmpeg writes everything it has to say).
 * Rejects with the last lines of stderr when it fails.
 */
export function ffmpeg(args, { cwd } = {}) {
  if (!ffmpegPath) return Promise.reject(new Error('No ffmpeg: run npm install in tools/video-tour (ffmpeg-static), put ffmpeg on the PATH, or set FFMPEG.'));
  return new Promise((done, fail) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-y', ...args], { cwd, windowsHide: true });
    let err = '';
    child.stderr.on('data', (chunk) => { err += chunk; if (err.length > 4_000_000) err = err.slice(-2_000_000); });
    child.stdout.on('data', () => {});
    child.on('error', fail);
    child.on('close', (code) => {
      if (code === 0) done(err);
      else fail(new Error(`ffmpeg exited with ${code}:\n${err.split('\n').slice(-25).join('\n')}`));
    });
  });
}

/** Seconds of a media file, from ffmpeg's own report (ffmpeg-static ships no ffprobe). */
export async function mediaDuration(path) {
  const out = await new Promise((done) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-i', path], { windowsHide: true });
    let err = '';
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('close', () => done(err));
  });
  const match = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(out);
  if (!match) throw new Error(`No duration for ${path}`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

/** The project's languages (narration and subtitles), set when the config loads. */
let knownLanguages = null;
export function setLanguages(list) { knownLanguages = new Set(list); }

/**
 * True for a { lang: text } object (as opposed to a plain value or a target spec such as
 * { css: ... }): every key is one of the project's languages.
 */
export function isLangMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).filter((k) => k !== 'src');
  if (!keys.length) return false;
  return keys.every((k) => (knownLanguages ? knownLanguages.has(k) : /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(k)));
}

/**
 * Picks a language's value from { en: ..., de: ... }, or returns a plain value. `fallback` is the
 * narration language: a missing translation shows the narrated text rather than nothing.
 */
export function pick(value, lang, fallback) {
  if (value === null || value === undefined) return value;
  if (isLangMap(value)) return value[lang] ?? (fallback ? value[fallback] : undefined);
  return value;
}

export function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds - m * 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** {name} placeholders from an object; unknown names stay as they are. */
export function fill(text, vars) {
  return String(text).replace(/\{(\w+)\}/g, (all, key) => (vars && key in vars ? vars[key] : all));
}

/** A small seeded random (mulberry32), so typing rhythm and other jitter are the same every render. */
export function seededRandom(seed) {
  let a = Number.parseInt(sha(String(seed), 8), 16) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** The language's own name for itself ("Deutsch", "Nederlands"), from the platform's ICU data. */
export function nativeName(code) {
  try {
    const name = new Intl.DisplayNames([code], { type: 'language' }).of(code);
    return name ? name.charAt(0).toLocaleUpperCase(code) + name.slice(1) : code;
  } catch { return code; }
}

/** ISO 639-2 codes for MP4 metadata (ffmpeg wants three letters); 'und' when unknown. */
const ISO3 = { en: 'eng', nl: 'nld', de: 'deu', fr: 'fra', es: 'spa', it: 'ita', pt: 'por', da: 'dan', sv: 'swe', nb: 'nob', no: 'nor', fi: 'fin', pl: 'pol', cs: 'ces', sk: 'slk', hu: 'hun', ro: 'ron', el: 'ell', tr: 'tur', ru: 'rus', uk: 'ukr', ja: 'jpn', zh: 'zho', ko: 'kor', ar: 'ara', he: 'heb', hi: 'hin', id: 'ind', vi: 'vie', th: 'tha' };
export function iso3(code) { return ISO3[String(code).slice(0, 2)] ?? 'und'; }

export function fileExists(path) { return existsSync(path); }
