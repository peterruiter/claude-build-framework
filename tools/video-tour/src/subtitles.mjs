// Subtitles from the narration's timing: every step's text in every language, cut into readable
// cues (two lines of at most 42 characters) over the time that step is spoken.
import { writtenText } from './script.mjs';

const LINE = 42;
const MAX_CUE = LINE * 2;

/** Splits text into cue-sized pieces: sentences first, then clauses, then words. */
export function chunk(text) {
  const sentences = text.match(/[^.!?…]+[.!?…]+["'”’)]*\s*|[^.!?…]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
  const pieces = [];
  for (const sentence of sentences) {
    if (sentence.length <= MAX_CUE) { pieces.push(sentence); continue; }
    const clauses = sentence.split(/(?<=[,;:–—])\s+/);
    let current = '';
    for (const clause of clauses) {
      if ((current ? current.length + 1 : 0) + clause.length <= MAX_CUE) current = current ? `${current} ${clause}` : clause;
      else {
        if (current) pieces.push(current);
        if (clause.length <= MAX_CUE) current = clause;
        else {
          // Words, evenly: a long clause becomes n similar cues rather than one full and one short.
          const wordsOf = clause.split(/\s+/);
          const n = Math.ceil(clause.length / MAX_CUE);
          const target = clause.length / n;
          let line = '';
          for (const word of wordsOf) {
            if (line && line.length + 1 + word.length > target + 8) { pieces.push(line); line = word; } else line = line ? `${line} ${word}` : word;
          }
          current = line;
        }
      }
    }
    if (current) pieces.push(current);
  }
  // Join short neighbours so cues are not flickering one-word flashes.
  const merged = [];
  for (const piece of pieces) {
    const last = merged[merged.length - 1];
    if (last && last.length + 1 + piece.length <= MAX_CUE && (last.length < 24 || piece.length < 24)) merged[merged.length - 1] = `${last} ${piece}`;
    else merged.push(piece);
  }
  return merged;
}

/** Breaks a cue into at most two balanced lines. */
export function lines(text) {
  if (text.length <= LINE) return text;
  const words = text.split(' ');
  let best = text; let bestScore = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' '); const b = words.slice(i).join(' ');
    const score = Math.max(a.length, b.length) + (a.length > LINE || b.length > LINE ? 1000 : 0);
    if (score < bestScore) { bestScore = score; best = `${a}\n${b}`; }
  }
  return best;
}

/**
 * Cues for one subtitle language over a rendered timeline.
 * `spans`: [{ start, end, text }] in seconds on the final video's clock.
 */
export function cuesFor(spans) {
  const cues = [];
  for (const span of spans) {
    const text = writtenText(span.text);
    if (!text) continue;
    const pieces = chunk(text);
    const total = pieces.reduce((sum, p) => sum + p.length, 0);
    let t = span.start;
    const length = span.end - span.start;
    for (const piece of pieces) {
      const d = length * (piece.length / total);
      cues.push({ start: t, end: t + d, text: lines(piece) });
      t += d;
    }
  }
  // Keep a cue on screen a little past the voice, never into the next one.
  for (let i = 0; i < cues.length; i++) {
    const next = cues[i + 1]?.start ?? Infinity;
    cues[i].end = Math.min(cues[i].end + 0.35, next - 0.04);
  }
  return cues;
}

function stamp(seconds, sep) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000), r = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${sep}${String(r).padStart(3, '0')}`;
}

export function toVtt(cues, lang) {
  return `WEBVTT\nLanguage: ${lang}\n\n` + cues.map((c, i) => `${i + 1}\n${stamp(c.start, '.')} --> ${stamp(c.end, '.')}\n${c.text}\n`).join('\n');
}

export function toSrt(cues) {
  return cues.map((c, i) => `${i + 1}\r\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\r\n${c.text.replace(/\n/g, '\r\n')}\r\n`).join('\r\n');
}

/** Characters per second of each cue: above ~20 is hard to read. */
export function readingSpeed(cues) {
  return Math.max(0, ...cues.map((c) => c.text.replace(/\n/g, ' ').length / Math.max(0.5, c.end - c.start)));
}
