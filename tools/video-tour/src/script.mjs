// Scripts: one YAML file per part, loading, checking, and the text of each step in each language.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import yaml from 'js-yaml';
import { config } from './config.mjs';
import { sha, isLangMap } from './util.mjs';

/** The recorder's own actions; an adapter adds more (see adapter.mjs). */
export const BUILTIN_ACTIONS = ['goto', 'hash', 'back', 'click', 'tap', 'hover', 'type', 'fill', 'press', 'select', 'upload',
  'scroll', 'highlight', 'unhighlight', 'zoom', 'unzoom', 'wait', 'waitFor', 'cursor', 'drag', 'eval', 'hide', 'flags'];
/** Set-up and clean-up steps every project has; an adapter adds more. */
export const BUILTIN_SETUP = ['api', 'eval', 'storage', 'goto', 'wait'];

/** Every script in the scripts folder, ordered by its `order`. */
export function listScripts() {
  const dir = config().dirs.scripts;
  if (!existsSync(dir)) throw new Error(`No scripts folder at ${dir}`);
  return readdirSync(dir)
    .filter((name) => /\.ya?ml$/.test(name) && !name.startsWith('_'))
    .map((name) => loadScript(join(dir, name)))
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
}

/** By id, file name or part number. */
export function findScript(idOrFile) {
  const all = listScripts();
  const found = all.find((one) => one.id === idOrFile || basename(one.file).replace(/\.ya?ml$/, '') === idOrFile || String(one.order) === String(Number(idOrFile)));
  if (!found) throw new Error(`No script "${idOrFile}". Known: ${all.map((one) => one.id).join(', ')}`);
  return found;
}

/** Text as a language map: a plain string is the narration language's. */
function asMap(value) {
  if (value === undefined || value === null) return value;
  if (typeof value === 'string') return { [config().narration.language]: value };
  return value;
}

export function loadScript(file) {
  const doc = yaml.load(readFileSync(file, 'utf8')) ?? {};
  doc.file = file;
  doc.stale = [];
  doc.frame ??= 'browser';
  doc.scenes ??= [];
  for (const field of ['title', 'thumbTitle', 'subtitle', 'summary']) doc[field] = asMap(doc[field]);
  for (const [sceneIndex, scene] of doc.scenes.entries()) {
    scene.id ??= `scene${sceneIndex + 1}`;
    scene.steps ??= [];
    scene.caption = asMap(scene.caption);
    if (typeof scene.chapter === 'string') scene.chapter = asMap(scene.chapter);
    for (const [stepIndex, step] of scene.steps.entries()) {
      step.key = `${scene.id}.${stepIndex + 1}`;
      step.do ??= [];
      step.say = asMap(step.say);
    }
  }
  mergeTranslations(doc);
  return doc;
}

/**
 * Translations live beside the script in scripts/i18n/<id>.yaml, so the script stays readable in
 * the narration language. Each step's translations carry `src`: a hash of the narrated text they
 * were made from; when that text changes they are stale and left out (and listed by `validate`)
 * rather than shown out of step with what is said. Titles, subtitles, summaries and captions may
 * carry a `src` too.
 */
function mergeTranslations(doc) {
  const file = join(config().dirs.i18n, `${doc.id}.yaml`);
  doc.i18nFile = file;
  if (!existsSync(file)) return;
  const tr = yaml.load(readFileSync(file, 'utf8')) ?? {};
  const lang = config().narration.language;
  const take = (source, translated, label) => {
    if (!translated || !source) return source;
    const { src, ...langs } = translated;
    if (src && String(src) !== sourceHash(source[lang])) { doc.stale.push(label); return source; }
    return { ...langs, ...source };
  };
  for (const field of ['title', 'subtitle', 'summary', 'thumbTitle']) doc[field] = take(doc[field], tr[field], field);
  for (const scene of doc.scenes) {
    scene.caption = take(scene.caption, tr.captions?.[scene.id], `caption ${scene.id}`);
    if (scene.chapter && typeof scene.chapter === 'object') scene.chapter = take(scene.chapter, tr.chapters?.[scene.id], `chapter ${scene.id}`);
    for (const step of scene.steps) step.say = take(step.say, tr.steps?.[step.key], step.key);
  }
}

export function sourceHash(text) {
  return sha(writtenText(text), 10);
}

/** What a translator needs for a script: every text still missing a language, with its src hash. */
export function translationTodo(doc) {
  const c = config();
  const lang = c.narration.language;
  const missingIn = (value) => c.languages.filter((l) => !value?.[l]);
  const entry = (value) => (value && missingIn(value).length ? { src: sourceHash(value[lang]), [lang]: writtenText(value[lang]), missing: missingIn(value) } : undefined);
  const steps = {};
  const captions = {};
  for (const scene of doc.scenes) {
    if (scene.caption && entry(scene.caption)) captions[scene.id] = entry(scene.caption);
    for (const step of scene.steps) if (step.say && entry(step.say)) steps[step.key] = entry(step.say);
  }
  return { id: doc.id, file: doc.i18nFile, title: entry(doc.title), subtitle: entry(doc.subtitle), summary: entry(doc.summary), captions, steps, stale: doc.stale };
}

/** Problems that stop a render (errors) and gaps worth knowing about (warnings). */
export function checkScript(doc, { actions = [], setupSteps = [] } = {}) {
  const c = config();
  const lang = c.narration.language;
  const errors = [];
  const warnings = [];
  const knownActions = new Set([...BUILTIN_ACTIONS, ...actions]);
  const knownSetup = new Set([...BUILTIN_SETUP, ...setupSteps]);
  if (!doc.id) errors.push('no id');
  else if (!/^[a-z0-9-]+$/.test(doc.id)) errors.push(`id "${doc.id}": use lower-case letters, digits and hyphens (it becomes a file name and a URL)`);
  if (!Number.isInteger(doc.order)) errors.push('no order (the part number, an integer)');
  if (!doc.title?.[lang]) errors.push(`title needs ${lang} (the narration language)`);
  if (!['browser', 'phone'].includes(doc.frame)) errors.push(`frame "${doc.frame}" is neither browser nor phone`);
  if (!doc.start && !doc.scenes[0]?.start) errors.push('no start (the path the recording opens)');
  if (!doc.scenes.length) errors.push('no scenes');
  const missing = new Map();
  const note = (l) => missing.set(l, (missing.get(l) ?? 0) + 1);
  for (const field of ['title', 'subtitle', 'summary']) for (const l of c.languages) if (doc[field] && !doc[field][l]) note(l);
  const ids = new Set();
  for (const scene of doc.scenes) {
    if (ids.has(scene.id)) errors.push(`scene id ${scene.id} used twice`);
    ids.add(scene.id);
    if (scene.frame && !['browser', 'phone'].includes(scene.frame)) errors.push(`scene ${scene.id}: frame "${scene.frame}"`);
    if (scene.caption) for (const l of c.languages) if (!scene.caption[l]) note(l);
    for (const step of scene.steps) {
      if (step.say) {
        if (!step.say[lang]) errors.push(`${step.key}: no ${lang} narration`);
        for (const l of c.languages) if (!step.say[l]) note(l);
      }
      if (!Array.isArray(step.do)) { errors.push(`${step.key}: "do" must be a list`); continue; }
      for (const action of step.do) {
        const name = typeof action === 'string' ? action : Object.keys(action ?? {})[0];
        if (!knownActions.has(name)) errors.push(`${step.key}: unknown action "${name}"`);
      }
    }
  }
  for (const list of ['setup', 'cleanup']) {
    for (const entry of doc[list] ?? []) {
      const name = Object.keys(entry ?? {})[0];
      if (!knownSetup.has(name)) errors.push(`${list}: unknown step "${name}" (not built in, not in the adapter)`);
    }
  }
  for (const [l, count] of missing) warnings.push(`${count} text(s) without ${l}`);
  if (doc.stale?.length) warnings.push(`outdated translations (the narrated text changed): ${doc.stale.join(', ')}`);
  return { errors, warnings };
}

/** The written text of a step, as subtitles show it: pause marks out, spaces tidied. */
export function writtenText(text) {
  return String(text ?? '').replace(/\[pause\s*\d+\s*(ms)?\]/gi, ' ').replace(/\s+/g, ' ').trim();
}

let lexicon = null;
export function loadLexicon() {
  const file = config().dirs.lexicon;
  lexicon ??= file && existsSync(file) ? yaml.load(readFileSync(file, 'utf8')) ?? {} : {};
  return lexicon;
}

function escapeXml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Lexicon terms for a language, longest first, with a whole-word pattern each. */
function terms(lang) {
  return Object.entries(loadLexicon()[lang] ?? {})
    .sort((a, b) => b[0].length - a[0].length)
    .map(([term, rule]) => ({ term, rule, pattern: new RegExp(`(?<![\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'gu') }));
}

/** Applies the lexicon, each term once: a term inside another's replacement is left alone. */
function applyLexicon(text, lang, render, escape) {
  let pieces = [{ text: String(text), done: false }];
  for (const { term, rule, pattern } of terms(lang)) {
    const next = [];
    for (const piece of pieces) {
      if (piece.done) { next.push(piece); continue; }
      let last = 0;
      for (const match of piece.text.matchAll(pattern)) {
        if (match.index > last) next.push({ text: piece.text.slice(last, match.index), done: false });
        next.push({ text: render(term, rule), done: true });
        last = match.index + term.length;
      }
      if (last < piece.text.length) next.push({ text: piece.text.slice(last), done: false });
    }
    pieces = next;
  }
  return pieces.map((piece) => (piece.done ? piece.text : escape(piece.text))).join('');
}

/**
 * The SSML body of a step: the lexicon applied, pauses as breaks. HD voices take <sub>, <lang>
 * and <break>; standard voices take <sub> and <phoneme>, and <lang> only when multilingual.
 */
export function spokenSsml(text, lang, voice) {
  const render = (term, rule) => {
    const written = escapeXml(term);
    if (rule.alias) return `<sub alias="${escapeXml(rule.alias)}">${written}</sub>`;
    if (rule.lang && (voice.hd || voice.multilingual)) return `<lang xml:lang="${rule.lang}">${written}</lang>`;
    if (rule.ipa && !voice.hd) return `<phoneme alphabet="ipa" ph="${escapeXml(rule.ipa)}">${written}</phoneme>`;
    return written;
  };
  return applyLexicon(text, lang, render, escapeXml)
    .replace(/\[pause\s*(\d+)\s*(ms)?\]/gi, (_, ms) => `<break time="${ms}ms"/>`)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Plain spoken text for engines without SSML: aliases applied, pause marks out. */
export function spokenPlain(text, lang) {
  return writtenText(applyLexicon(text, lang, (term, rule) => rule.alias ?? term, (t) => t));
}

/** Every step with narration, in order, with its scene. */
export function narratedSteps(doc) {
  const out = [];
  for (const scene of doc.scenes) for (const step of scene.steps) if (step.say) out.push({ scene, step });
  return out;
}

export function findStep(doc, key) {
  for (const scene of doc.scenes) for (const step of scene.steps) if (step.key === key) return step;
  return null;
}

/** File names: <nn>-<id>, as in 01-getting-started. */
export function baseName(doc) { return `${String(doc.order ?? 0).padStart(2, '0')}-${doc.id}`; }

export { isLangMap };
