// A self-hosted video library: the catalogue and the small files that ship with the site.
//
// The MP4s are large and stay out of the site's build: they live in a private blob container and
// the site's API answers GET /videos/{file}.mp4 with a redirect to a short-lived, read-only signed
// link for that one blob (see README, "Self-hosted library"). What ships with the site is small:
// a poster per video re-encoded to `posterWidth`, its subtitles as WebVTT in every language (served
// from the site's own origin: no CORS, no Content-Security-Policy exception for track files), and
// the catalogue JSON the site's pages read.
//
// Reads <output>/manifest.json and the YouTube state (which upload each video became); writes
// config library.catalogue and the files under library.assets/<file>/{poster.jpg,<lang>.vtt}.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync, copyFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { config } from './config.mjs';
import { ffmpeg, log } from './util.mjs';
import { readManifest } from './manifest.mjs';

export async function buildLibrary({ strict } = {}) {
  const c = config();
  const lib = c.library;
  if (!c.dirs.catalogue || !c.dirs.libraryAssets) throw new Error('Set library.catalogue (the JSON file) and library.assets (the folder for posters and subtitles) in the config.');
  const outDir = c.dirs.output;
  const manifest = readManifest(outDir);
  const youtube = c.dirs.youtubeState && existsSync(c.dirs.youtubeState) ? JSON.parse(readFileSync(c.dirs.youtubeState, 'utf8')) : { map: {} };
  const langs = lib.languages ?? c.languages;
  const groups = lib.groups ?? {};
  strict ??= lib.strict;
  const problems = [];
  const fail = (message) => { if (strict) throw new Error(message); problems.push(message); log(`    [warn] ${message}`); };

  // Every text in every library language, or (not strict) the narration language's in its place.
  const everyLanguage = (value, what) => {
    const out = {};
    for (const l of langs) {
      const v = value?.[l];
      if (typeof v === 'string' && v.trim()) out[l] = v.trim();
      else { fail(`${what} has no '${l}'`); out[l] = value?.[c.narration.language] ?? ''; }
    }
    return out;
  };

  const videos = [];
  for (const video of [...manifest.videos].sort((a, b) => a.part - b.part)) {
    const v = video.video;
    const folder = join(outDir, video.file);
    if (!v || !existsSync(join(outDir, v.file))) { log(`    [skip] ${video.file}: not rendered`); continue; }
    if (!/^[a-z0-9-]+$/.test(video.id) || !/^\d{2,}-[a-z0-9-]+$/.test(video.file)) throw new Error(`${video.file}: an id or file name a URL would need to escape`);
    if (video.group && Object.keys(groups).length && !groups[video.group]) fail(`${video.file}: group '${video.group}' has no name in library.groups`);

    const chapters = v.chapters.map((mark, index) => {
      const scene = video.scenes?.find((one) => one.id === mark.scene);
      return { at: mark.at, label: everyLanguage(scene?.chapter ?? { [c.narration.language]: mark.title }, `${video.file} chapter ${index + 1}`) };
    });

    const target = join(c.dirs.libraryAssets, video.file);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    const poster = join(outDir, v.poster);
    if (!existsSync(poster)) throw new Error(`${video.file}: no poster`);
    await ffmpeg(['-v', 'error', '-i', poster, '-vf', `scale=${lib.posterWidth ?? 1280}:-2:flags=lanczos`, '-q:v', '4', join(target, 'poster.jpg')]);
    const tracks = [];
    for (const l of langs) {
      const vtt = v.subtitles[l]?.vtt && join(outDir, v.subtitles[l].vtt);
      if (!vtt || !existsSync(vtt)) { fail(`${video.file}: no ${l} subtitles`); continue; }
      if (!readFileSync(vtt, 'utf8').startsWith('WEBVTT')) throw new Error(`${vtt} is not WebVTT`);
      copyFileSync(vtt, join(target, `${l}.vtt`));
      tracks.push(l);
    }

    videos.push({
      id: video.id,
      part: video.part,
      file: video.file,
      url: (lib.videoUrl ?? '/videos/{file}.mp4').replace('{file}', video.file),
      blob: v.file.split('/').pop(),
      group: video.group,
      seconds: v.seconds,
      duration: v.duration,
      youtube: youtube.map?.[video.file] ?? null,
      helpSections: video.helpSections ?? [],
      title: everyLanguage(video.title, `${video.file} title`),
      summary: everyLanguage(video.summary ?? video.subtitle, `${video.file} summary`),
      subtitles: tracks,
      chapters
    });
    log(`    [ok]   ${video.file} (${v.duration}, ${chapters.length} chapters, ${tracks.length} subtitle languages${youtube.map?.[video.file] ? ', on YouTube' : ''})`);
  }

  // Folders of videos that left the series go with them.
  for (const entry of existsSync(c.dirs.libraryAssets) ? readdirSync(c.dirs.libraryAssets) : []) {
    if (statSync(join(c.dirs.libraryAssets, entry)).isDirectory() && !videos.some((video) => video.file === entry)) {
      rmSync(join(c.dirs.libraryAssets, entry), { recursive: true, force: true });
      log(`    [gone] ${entry}`);
    }
  }

  const used = new Set(videos.map((video) => video.group));
  const catalogue = {
    description: 'Generated by video-tour library from the series manifest and the YouTube state; do not edit by hand. Per video: url (the site\'s address for the MP4, answered with a short-lived signed redirect), blob (its name in the private container), poster and subtitles under the assets folder at <file>/poster.jpg and <file>/<lang>.vtt.',
    product: c.product.name,
    generated: new Date().toISOString(),
    languages: langs,
    youtubePlaylist: youtube.playlist ?? c.youtube.playlistId ?? null,
    groups: Object.entries(groups).filter(([key]) => used.has(key)).map(([key, name]) => ({ key, name })),
    videos
  };
  mkdirSync(dirname(c.dirs.catalogue), { recursive: true });
  writeFileSync(c.dirs.catalogue, JSON.stringify(catalogue, null, 2) + '\n', 'utf8');
  log(`    [ok]   ${videos.length} videos in ${c.dirs.catalogue}; posters and subtitles in ${c.dirs.libraryAssets}`);
  if (problems.length) log(`    ${problems.length} warning(s); --strict turns them into errors`);
  return catalogue;
}
