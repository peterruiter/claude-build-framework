// video-tour.config.json: found with --config, VIDEO_TOUR_CONFIG, or by walking up from the current
// folder. Every path in it is relative to the file's own folder. Secrets are never in it: the
// Speech key is read from the environment variable it names, the YouTube OAuth client from a file
// named at run time.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { setLanguages } from './util.mjs';

export const CONFIG_NAME = 'video-tour.config.json';

const DEFAULTS = {
  product: { name: 'Product', url: null },
  brand: {
    logo: null,
    colors: {
      background: '#0f172a', backgroundAlt: '#1e3a5f', accent: '#38bdf8', accentAlt: '#0ea5e9',
      text: '#ffffff', textMuted: '#cbd5e1', onAccent: '#0f172a', highlight: '#fbbf24'
    },
    font: { family: 'Inter', file: null }
  },
  app: {
    baseUrl: 'http://127.0.0.1:3000',
    publicUrl: null,
    start: null,
    hostRoutes: [],
    replaceText: {},
    viewport: { width: 1920, height: 1080 },
    locale: {},
    timezone: 'Europe/Amsterdam',
    colorScheme: 'light',
    ignoreProblems: [],
    zoomRoot: null
  },
  narration: {
    language: 'en',
    provider: 'azure',
    voice: 'en-US-AvaMultilingualNeural',
    locale: null,
    region: null,
    endpoint: null,
    auth: 'key',
    keyEnv: 'AZURE_SPEECH_KEY',
    subscription: null,
    parameters: null,
    hd: false,
    multilingual: true,
    rate: null,
    systemVoice: null,
    lexicon: null,
    pricePerMillion: 15,
    charsPerSecond: 14.5
  },
  subtitles: { languages: null, burnIn: null, burnInStyle: null },
  timing: { stepGapMs: 280, sceneGapMs: 650, leadInMs: 500, tailMs: 1200, introSeconds: 3.6, outroSeconds: 4, lowerThirdSeconds: 4.5, settleMs: 1200 },
  video: { fps: 30, crf: 19, preset: 'slow', loudness: -16 },
  text: {},
  paths: {
    scripts: 'video-tour/scripts',
    adapter: null,
    uiStrings: {},
    assets: 'video-tour/assets',
    work: 'video-tour/.work',
    cache: 'video-tour/.cache',
    output: 'video-tour/output'
  },
  library: { catalogue: null, assets: null, videoUrl: '/videos/{file}.mp4', posterWidth: 1280, groups: {}, strict: false },
  youtube: {
    channelId: null,
    playlistId: null,
    playlistTitle: null,
    playlistDescription: null,
    clientEnv: 'YT_CLIENT',
    stateFile: 'video-tour/youtube-state.json',
    dailyQuota: 10000,
    costs: { list: 1, update: 50, insert: 50, delete: 50, thumbnail: 50, caption: 400, upload: 1600 },
    categoryId: '28',
    tags: [],
    titleTemplate: '{title} | {product}',
    privacy: 'public',
    madeForKids: false,
    captionOrder: null,
    match: { byPartNumber: true, byTitle: true }
  }
};

/** Words around the videos, per language. Only English ships here; every other language the
 *  project uses gets its own entry in the config's `text` (validate lists the ones missing). */
const TEXT_EN = {
  series: '{product} product tour · Part {n}',
  seriesShort: 'Product tour · Part {n}',
  closing: '',
  tryIt: 'Try it yourself: {url}',
  note: 'Subtitles in {count} languages. The data in this video is made up.',
  playlistLine: 'The whole tour: {playlist}'
};

function merge(base, over) {
  if (over === undefined) return base;
  if (base && typeof base === 'object' && !Array.isArray(base) && over && typeof over === 'object' && !Array.isArray(over)) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over)) out[k] = merge(base[k], v);
    return out;
  }
  return over;
}

export function findConfig(explicit) {
  const given = explicit ?? process.env.VIDEO_TOUR_CONFIG;
  if (given) {
    const file = resolve(given);
    if (!existsSync(file)) throw new Error(`No config at ${file}`);
    return file;
  }
  let dir = process.cwd();
  for (;;) {
    const file = join(dir, CONFIG_NAME);
    if (existsSync(file)) return file;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

let current = null;

/** Loads (once) and returns the config, with absolute paths under `config.dirs`. */
export function loadConfig(explicit) {
  if (current && !explicit) return current;
  const file = findConfig(explicit);
  if (!file) throw new Error(`No ${CONFIG_NAME} here or above. Run "video-tour init" or pass --config <file>.`);
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const config = merge(DEFAULTS, raw);
  config.file = file;
  config.root = dirname(file);
  const at = (p) => (p ? resolve(config.root, p) : null);
  config.dirs = {
    scripts: at(config.paths.scripts),
    i18n: join(at(config.paths.scripts), 'i18n'),
    adapter: at(config.paths.adapter),
    assets: at(config.paths.assets),
    work: at(config.paths.work),
    cache: at(config.paths.cache),
    output: at(config.paths.output),
    lexicon: at(config.narration.lexicon),
    logo: at(config.brand.logo),
    font: at(config.brand.font?.file),
    youtubeState: at(config.youtube.stateFile),
    catalogue: at(config.library.catalogue),
    libraryAssets: at(config.library.assets),
    uiStrings: Object.fromEntries(Object.entries(config.paths.uiStrings ?? {}).map(([k, v]) => [k, at(v)]))
  };
  const narrated = config.narration.language;
  config.narration.locale ??= narrated;
  // The subtitle languages are the project's choice; the narrated language is always one of them.
  const subs = config.subtitles.languages ?? [narrated];
  config.subtitles.languages = [narrated, ...subs.filter((l) => l !== narrated)];
  config.languages = config.subtitles.languages;
  config.text = { [narrated]: {}, ...config.text };
  config.text.en = { ...TEXT_EN, ...(config.text.en ?? {}) };
  config.app.base = (process.env.VIDEO_TOUR_BASE ?? config.app.baseUrl).replace(/\/$/, '');
  setLanguages(config.languages);
  current = config;
  return config;
}

export function config() {
  if (!current) throw new Error('config not loaded');
  return current;
}

/**
 * A boilerplate phrase in a language, with {product}, {url}, {n}, {count}, {playlist} filled in.
 * Falls back to English only when the project left the language out (validate reports that).
 */
export function phrase(key, lang, vars = {}) {
  const c = config();
  const template = c.text[lang]?.[key] ?? c.text.en?.[key] ?? '';
  const all = { product: c.product.name, url: c.product.url ?? '', count: c.languages.length, ...vars };
  return String(template).replace(/\{(\w+)\}/g, (m, k) => (k in all ? all[k] : m));
}
