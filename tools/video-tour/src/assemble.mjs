// From a recording and its narration to the finished files: title card, product, closing card,
// lower thirds, narration normalised to EBU R128 loudness, H.264 MP4, subtitles in every configured
// language, a thumbnail and a poster, and (optionally) a copy with subtitles burned in.
import { readFileSync, writeFileSync, statSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { config, phrase } from './config.mjs';
import { ensureDir, ffmpeg, pick, log, formatDuration, iso3 } from './util.mjs';
import { readWav, writeWav, mixTimeline } from './wav.mjs';
import { renderCardFrames, renderStill } from './cards.mjs';
import { cuesFor, toVtt, toSrt, readingSpeed } from './subtitles.mjs';
import { baseName, findStep } from './script.mjs';

export async function assemble(browser, doc, rec, titleClip, { dir, outDir, burnIn } = {}) {
  const c = config();
  const lang = c.narration.language;
  const fps = rec.fps;
  const name = baseName(doc);
  const videoDir = ensureDir(join(outDir, name));
  const thumbsDir = ensureDir(join(outDir, 'thumbnails'));
  const missing = rec.frames.filter((f) => !f || !existsSync(f));
  if (!rec.frames.length || missing.length) throw new Error(`${doc.id}: the recording's frames are gone (assemble right after record, or record with --keep)`);

  // ---------------------------------------------------------------- the cards --
  const introSeconds = Math.max(doc.introSeconds ?? c.timing.introSeconds, (titleClip?.seconds ?? 0) + 1.6);
  const outroSeconds = doc.outroSeconds ?? c.timing.outroSeconds;
  const first = pathToFileURL(rec.frames[0]).href;
  const last = pathToFileURL(rec.frames[rec.frames.length - 1]).href;
  const title = pick(doc.title, lang);
  const intro = await renderCardFrames(browser, { kind: 'intro', eyebrow: phrase('series', lang, { n: doc.order }), title, sub: pick(doc.subtitle, lang), shot: first, fade: 0.5 }, introSeconds, fps, join(dir, 'intro'));
  const cta = c.product.url ? c.product.url.replace(/^https?:\/\//, '').replace(/\/$/, '') : null;
  const outro = await renderCardFrames(browser, { kind: 'outro', cta, line: pick(doc.closing, lang) ?? phrase('closing', lang), shot: last, fade: 0.6 }, outroSeconds, fps, join(dir, 'outro'));
  const frames = [...intro, ...rec.frames, ...outro];
  const total = frames.length / fps;
  const mainAt = intro.length / fps;

  // ---------------------------------------------------------------- the sound --
  const sampleRate = 48000;
  const clips = [];
  if (titleClip) clips.push({ at: 0.75, samples: readWav(readFileSync(titleClip.file)).samples });
  for (const step of rec.steps) if (step.file && existsSync(step.file)) clips.push({ at: mainAt + step.start, samples: readWav(readFileSync(step.file)).samples });
  const rawWav = join(dir, 'narration.raw.wav');
  writeFileSync(rawWav, writeWav(mixTimeline(total, sampleRate, clips), sampleRate));
  const loud = join(dir, 'narration.wav');
  await loudnorm(rawWav, loud, c.video.loudness);

  // ------------------------------------------------------------ lower thirds --
  const overlays = [];
  for (const [index, scene] of rec.scenes.entries()) {
    // Phone scenes carry their caption beside the handset; browser scenes get a lower third.
    if ((scene.frame ?? (rec.phone ? 'phone' : 'browser')) === 'phone') continue;
    if (!scene.caption || doc.scenes[index]?.lowerThird === false) continue;
    const png = join(dir, `lower-${index}.png`);
    await renderStill(browser, { kind: 'lower', small: title, text: scene.caption }, png, { transparent: true });
    const from = mainAt + scene.start + 0.25;
    const to = Math.min(mainAt + scene.end - 0.2, from + (doc.lowerThirdSeconds ?? c.timing.lowerThirdSeconds));
    if (to - from > 1.2) overlays.push({ png, from, to });
  }

  // ---------------------------------------------------------------- the video --
  const list = join(dir, 'frames.txt');
  const d = (1 / fps).toFixed(6);
  writeFileSync(list, 'ffconcat version 1.0\n' + frames.map((f) => `file '${f.replace(/\\/g, '/')}'\nduration ${d}`).join('\n') + `\nfile '${frames[frames.length - 1].replace(/\\/g, '/')}'\n`);
  const mp4 = join(videoDir, `${name}.${lang}.mp4`);
  const inputs = ['-f', 'concat', '-safe', '0', '-i', list, '-i', loud];
  let filter = `[0:v]fps=${fps},scale=1920:1080:flags=lanczos,setsar=1[v0]`;
  overlays.forEach((o, i) => {
    inputs.push('-loop', '1', '-framerate', String(fps), '-t', total.toFixed(3), '-i', o.png);
    filter += `;[${i + 2}:v]format=rgba,fade=t=in:st=${o.from.toFixed(3)}:d=0.35:alpha=1,fade=t=out:st=${(o.to - 0.35).toFixed(3)}:d=0.35:alpha=1[l${i}]`;
    filter += `;[v${i}][l${i}]overlay=0:0:eof_action=pass:enable='between(t,${o.from.toFixed(3)},${o.to.toFixed(3)})'[v${i + 1}]`;
  });
  filter += `;[v${overlays.length}]format=yuv420p[vout]`;
  await ffmpeg([...inputs, '-filter_complex', filter, '-map', '[vout]', '-map', '1:a',
    '-c:v', 'libx264', '-preset', c.video.preset, '-crf', String(c.video.crf), '-profile:v', 'high', '-r', String(fps), '-g', String(fps * 2),
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2', '-shortest', '-movflags', '+faststart',
    '-metadata', `title=${title}`, '-metadata', `language=${iso3(lang)}`, '-metadata:s:a:0', `language=${iso3(lang)}`, mp4]);

  // ------------------------------------------------------ thumbnail, poster --
  const { file: shotFrame, phone: shotInPhone } = pickShot(doc, rec);
  let shot = pathToFileURL(shotFrame).href;
  if (shotInPhone) {
    const crop = join(dir, 'shot-phone.png');
    const r = rec.screenRect;
    await ffmpeg(['-i', shotFrame, '-vf', `crop=${r.width}:${r.height}:${r.x}:${r.y}`, crop]);
    shot = pathToFileURL(crop).href;
  }
  const card = { kind: 'poster', eyebrow: phrase('seriesShort', lang, { n: doc.order }), title: pick(doc.thumbTitle, lang) ?? title, shot, phone: shotInPhone };
  const thumb = join(thumbsDir, `${name}-${lang}.png`);
  const big = join(dir, 'thumb-1920.png');
  await renderStill(browser, card, big);
  await ffmpeg(['-i', big, '-vf', 'scale=1280:720:flags=lanczos', thumb]);
  if (statSync(thumb).size >= 2 * 1024 * 1024) {
    // YouTube's limit is 2 MB: fewer colours rather than a JPEG.
    await ffmpeg(['-i', big, '-vf', 'scale=1280:720:flags=lanczos,split[a][b];[a]palettegen=max_colors=255[p];[b][p]paletteuse=dither=sierra2_4a', thumb]);
  }
  const poster = join(videoDir, `${name}.${lang}.poster.jpg`);
  await renderStill(browser, { ...card, duration: formatDuration(total) }, poster, { type: 'jpeg', quality: 90 });

  // -------------------------------------------------------------- subtitles --
  const timing = { steps: rec.steps, scenes: rec.scenes, mainAt, introSeconds, titleSeconds: titleClip?.seconds ?? 0 };
  const { subtitles, speeds } = writeSubtitles(doc, timing, videoDir);
  const chapters = chaptersOf(rec.scenes, mainAt);

  const burned = {};
  for (const sub of [].concat(burnIn ?? c.subtitles.burnIn ?? []).filter(Boolean)) {
    if (!subtitles[sub]) { log(`  no ${sub} subtitles to burn in`); continue; }
    burned[sub] = await burnSubtitles(mp4, subtitles[sub].srt, join(videoDir, `${name}.${lang}.captioned-${sub}.mp4`), dir);
  }

  const speedNote = Object.keys(speeds).length ? ` (max ${Math.max(...Object.values(speeds))} chars/s)` : '';
  log(`  ${name}.${lang}.mp4: ${formatDuration(total)}, subtitles in ${Object.keys(subtitles).join(', ')}${speedNote}`);
  const result = { lang, mp4, poster, thumbnail: thumb, seconds: total, introSeconds, mainAt, subtitles, burned, chapters, readingSpeed: speeds, size: statSync(mp4).size, problems: rec.problems ?? [] };
  // Enough to redo the subtitles and the manifest later (new translations) without recording again.
  writeFileSync(join(dir, 'assembled.json'), JSON.stringify({ result, timing }, null, 1));
  return result;
}

/** Chapters per scene; the first starts at 0:00 so it takes in the title card (YouTube's rule). */
export function chaptersOf(scenes, mainAt) {
  const chapters = (scenes ?? []).map((s) => ({ at: mainAt + s.start, scene: s.id, title: s.chapter })).filter((ch) => ch.title);
  if (chapters.length) chapters[0].at = 0;
  return chapters;
}

/**
 * Subtitle files in every configured language that has text: the title's own cue over the title
 * card, then each step over the time it is spoken.
 */
export function writeSubtitles(doc, timing, videoDir) {
  const c = config();
  const lang = c.narration.language;
  const name = baseName(doc);
  const subsDir = ensureDir(join(videoDir, 'subtitles'));
  const subtitles = {};
  const speeds = {};
  const { mainAt, introSeconds, titleSeconds } = timing;
  const titleEnd = Math.min(introSeconds - 0.2, 0.75 + Math.max(2.2, titleSeconds) + 0.4);
  for (const sub of c.languages) {
    const spans = [{ start: 0.6, end: titleEnd, text: doc.title?.[sub] ?? null }];
    for (const step of timing.steps) {
      const text = findStep(doc, step.key)?.say?.[sub];
      if (!text || !step.seconds) continue;
      spans.push({ start: mainAt + step.start, end: mainAt + step.start + step.seconds, text });
    }
    if (spans.length < 2) continue;
    const cues = cuesFor(spans.filter((s) => s.text));
    const vtt = join(subsDir, `${name}.${lang}.${sub}.vtt`);
    const srt = join(subsDir, `${name}.${lang}.${sub}.srt`);
    writeFileSync(vtt, toVtt(cues, sub));
    writeFileSync(srt, String.fromCharCode(0xfeff) + toSrt(cues)); // a BOM: some players need it for UTF-8 SRT
    subtitles[sub] = { vtt, srt };
    speeds[sub] = Math.round(readingSpeed(cues));
  }
  return { subtitles, speeds };
}

/**
 * A copy of the video with one language's subtitles burned in (social media, kiosks, autoplay
 * without sound). ffmpeg's subtitles filter is run from the subtitle's own folder so no Windows
 * path has to be escaped inside the filter.
 */
async function burnSubtitles(mp4, srt, out, work) {
  const c = config();
  const local = join(work, 'burn.srt');
  copyFileSync(srt, local);
  const fontsDir = c.dirs.font ? dirname(c.dirs.font) : null;
  const style = c.subtitles.burnInStyle ?? `FontName=${c.brand.font.family ?? 'Arial'},FontSize=13,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=3,Outline=1,Shadow=0,MarginV=36`;
  if (fontsDir) copyFileSync(c.dirs.font, join(work, basename(c.dirs.font)));
  const vf = `subtitles=burn.srt:charenc=UTF-8${fontsDir ? ':fontsdir=.' : ''}:force_style='${style}'`;
  await ffmpeg(['-i', mp4, '-vf', vf, '-c:v', 'libx264', '-preset', c.video.preset, '-crf', String(c.video.crf), '-c:a', 'copy', '-movflags', '+faststart', out], { cwd: work });
  log(`  burned in: ${out}`);
  return out;
}

/** The product frame for the thumbnail: the script's choice, else two fifths of the way in. */
function pickShot(doc, rec) {
  let at = rec.seconds * 0.4;
  if (doc.thumbnail?.scene) {
    const scene = rec.scenes.find((s) => s.id === doc.thumbnail.scene);
    if (scene) at = scene.start + (scene.end - scene.start) * (doc.thumbnail.at ?? 0.6);
  } else if (doc.thumbnail?.step) {
    const step = rec.steps.find((s) => s.key === doc.thumbnail.step);
    if (step) at = step.start + Math.max(step.seconds, 1) * (doc.thumbnail.at ?? 0.9);
  }
  const index = Math.min(rec.frames.length - 1, Math.max(0, Math.round(at * rec.fps)));
  const scene = rec.scenes.find((s) => at >= s.start && at <= s.end);
  return { file: rec.frames[index], phone: (scene?.frame ?? (rec.phone ? 'phone' : 'browser')) === 'phone' };
}

/** Two-pass EBU R128 loudness normalisation (default -16 LUFS, true peak -1.5 dBTP: web and YouTube). */
async function loudnorm(input, output, lufs = -16) {
  const target = `I=${lufs}:TP=-1.5:LRA=11`;
  const first = await ffmpeg(['-i', input, '-af', `loudnorm=${target}:print_format=json`, '-f', 'null', '-']);
  const json = JSON.parse(first.slice(first.lastIndexOf('{'), first.lastIndexOf('}') + 1));
  // A silent track (--no-voice) measures -inf: nothing to normalise.
  if (!Number.isFinite(Number(json.input_i))) { copyFileSync(input, output); return; }
  await ffmpeg(['-i', input, '-af',
    `loudnorm=${target}:measured_I=${json.input_i}:measured_TP=${json.input_tp}:measured_LRA=${json.input_lra}:measured_thresh=${json.input_thresh}:offset=${json.target_offset}:linear=true`,
    '-ar', '48000', output]);
}

