// manifest.json (for a website, an in-app help, the library and the YouTube step) and youtube.md
// (the titles and descriptions to paste into YouTube by hand, per video and language).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { config, phrase } from './config.mjs';
import { formatDuration, nativeName, fill } from './util.mjs';
import { baseName } from './script.mjs';

export function manifestFile(outDir) { return join(outDir, 'manifest.json'); }

export function readManifest(outDir) {
  const file = manifestFile(outDir);
  if (!existsSync(file)) throw new Error(`No manifest at ${file}: render (or run "manifest") first.`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function updateManifest(outDir, doc, result) {
  const c = config();
  const lang = c.narration.language;
  const file = manifestFile(outDir);
  const manifest = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { product: c.product.name, videos: [] };
  manifest.product = c.product.name;
  manifest.generated = new Date().toISOString();
  manifest.narration = lang;
  manifest.languages = c.languages;
  const rel = (path) => relative(outDir, path).replace(/\\/g, '/');
  const entry = {
    id: doc.id,
    part: doc.order,
    file: baseName(doc),
    group: doc.group ?? null,
    frame: doc.frame,
    title: strip(doc.title),
    thumbTitle: doc.thumbTitle ? strip(doc.thumbTitle) : null,
    subtitle: doc.subtitle ? strip(doc.subtitle) : null,
    summary: doc.summary ? strip(doc.summary) : null,
    tags: doc.tags ?? [],
    helpSections: doc.helpSections ?? [],
    // Chapter names per scene in every language that has them.
    scenes: doc.scenes.map((scene) => ({ id: scene.id, chapter: strip({ ...(scene.caption ?? {}), ...(scene.chapter && typeof scene.chapter === 'object' ? scene.chapter : {}) }) })),
    video: {
      lang,
      file: rel(result.mp4),
      poster: rel(result.poster),
      thumbnail: rel(result.thumbnail),
      seconds: Math.round(result.seconds * 10) / 10,
      duration: formatDuration(result.seconds),
      bytes: result.size,
      chapters: result.chapters.map((ch) => ({ at: Math.round(ch.at * 10) / 10, scene: ch.scene, title: ch.title })),
      subtitles: Object.fromEntries(Object.entries(result.subtitles).map(([l, s]) => [l, { vtt: rel(s.vtt), srt: rel(s.srt) }])),
      burnedIn: Object.fromEntries(Object.entries(result.burned ?? {}).map(([l, f]) => [l, rel(f)])),
      readingSpeed: result.readingSpeed,
      problems: (result.problems ?? []).length,
      rendered: new Date().toISOString()
    }
  };
  manifest.videos = manifest.videos.filter((one) => one.id !== doc.id).concat(entry).sort((a, b) => (a.part ?? 0) - (b.part ?? 0));
  writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
  writeYouTubeText(outDir, manifest);
  return manifest;
}

function strip(map) {
  if (!map || typeof map !== 'object') return map;
  const { src, ...rest } = map;
  return rest;
}

/** YouTube shows chapters when the first is at 0:00, there are three or more, each at least 10 s. */
export function youTubeChapters(video, lang) {
  const keep = [];
  for (const ch of video.video?.chapters ?? []) {
    if (keep.length && ch.at - keep[keep.length - 1].at < 10) continue;
    keep.push(ch);
  }
  if (keep.length < 3 || keep[0].at !== 0) return [];
  const name = (ch) => video.scenes?.find((s) => s.id === ch.scene)?.chapter?.[lang] ?? ch.title;
  return keep.map((ch) => `${formatDuration(Math.floor(ch.at))} ${name(ch)}`);
}

/**
 * The YouTube title and description of a video in a language, or null when the video has no title
 * in it. `playlist` (a URL) adds the line pointing to the whole tour.
 */
export function youTubeText(video, lang, { playlist } = {}) {
  const c = config();
  const title = video.title?.[lang];
  if (!title) return null;
  const chapters = youTubeChapters(video, lang);
  const lines = [
    video.summary?.[lang] ?? video.subtitle?.[lang] ?? '',
    '',
    `${phrase('series', lang, { n: video.part })}.`,
    ...(c.product.url ? [phrase('tryIt', lang)] : []),
    ...(playlist ? [phrase('playlistLine', lang, { playlist })] : []),
    ...(chapters.length ? ['', ...chapters] : []),
    '',
    phrase('note', lang)
  ];
  return {
    title: fill(c.youtube.titleTemplate, { title, product: c.product.name, n: video.part }).slice(0, 100),
    description: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 5000)
  };
}

/** youtube.md: per video the thumbnail, files, and the title and description in every language. */
export function writeYouTubeText(outDir, manifest) {
  const c = config();
  const lang = c.narration.language;
  const out = [`# ${manifest.product}: YouTube text`, '',
    'Per video: the thumbnail (1280×720 PNG, under 2 MB), the title and description in the narration language,',
    'and the same in every other language for YouTube\'s *Languages* (title and description per language).',
    'Upload the MP4, set the thumbnail, paste the title and description, then add each subtitle file from the',
    'video\'s `subtitles/` folder under *Subtitles* (`<file>.<narration>.<language>.srt`; the last code is the language).',
    'Or let `video-tour youtube apply` and `youtube captions` do it through the API.', ''];
  for (const video of manifest.videos) {
    const v = video.video;
    if (!v) continue;
    out.push(`## ${String(video.part).padStart(2, '0')} · ${video.title?.[lang] ?? video.id} (${v.duration})`, '',
      `![thumbnail](${v.thumbnail})`, '',
      `- Video: \`${v.file}\``, `- Thumbnail: \`${v.thumbnail}\``, `- Subtitles: ${Object.keys(v.subtitles).join(', ')}`, '');
    for (const l of [lang, ...c.languages.filter((x) => x !== lang)]) {
      const text = youTubeText(video, l);
      if (!text) continue;
      out.push(`### ${nativeName(l)} (${l})${l === lang ? ', the video\'s own language' : ''}`, '', '```text', text.title, '```', '', '```text', text.description, '```', '');
    }
  }
  writeFileSync(join(outDir, 'youtube.md'), out.join('\n'));
}
