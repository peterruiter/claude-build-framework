// Listening without ears: transcribe each narration clip with Azure's fast transcription and see
// which written words did not come back. Neural (especially HD) voices occasionally swallow or
// invent a word; this finds those steps so they can be given another take (`take: 1` on the step)
// or a lexicon entry. Only meaningful for the azure provider.
import { readFileSync } from 'node:fs';
import { config } from './config.mjs';
import { speechHeaders, transcribeUrl } from './azure.mjs';
import { sleep } from './util.mjs';

export async function transcribe(file) {
  const n = config().narration;
  // The resource answers 429 when transcriptions come too fast: wait as it says (or longer each time) and ask again.
  let response;
  for (let attempt = 1; ; attempt++) {
    const form = new FormData();
    form.append('audio', new Blob([readFileSync(file)], { type: 'audio/wav' }), 'clip.wav');
    form.append('definition', JSON.stringify({ locales: [n.locale] }));
    response = await fetch(transcribeUrl(), { method: 'POST', headers: await speechHeaders(), body: form });
    if ((response.status !== 429 && response.status < 500) || attempt >= 8) break;
    const wait = Number(response.headers.get('retry-after')) || 5 * attempt;
    await sleep(wait * 1000);
  }
  if (!response.ok) throw new Error(`transcription ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const json = await response.json();
  return (json.combinedPhrases ?? []).map((p) => p.text).join(' ');
}

/** Words normalised for comparison: lower case, no accents or punctuation, lexicon aliases split. */
function norm(text) {
  return String(text).toLowerCase()
    .normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
}

/** Digits a transcription writes for spoken numbers ("two" heard as "2"): English plus the config's own. */
function numbers() {
  const base = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10' };
  return { ...base, ...(config().narration.qaNumbers ?? {}) };
}

/**
 * The share of written words (longer than two letters) missing from what was heard. Product names
 * the transcription splits ("AcmeNotes" heard as "acme notes") can be listed in
 * narration.qaSplit: { "acmenotes": "acme notes" }.
 */
export function wordLoss(written, heard) {
  const nums = numbers();
  const split = config().narration.qaSplit ?? {};
  const expand = (words) => words.flatMap((w) => (split[w] ? split[w].split(' ') : [w])).map((w) => nums[w] ?? w);
  const heardSet = new Set(expand(norm(heard)));
  const words = expand(norm(written)).filter((w) => w.length > 2);
  const missing = words.filter((w) => !heardSet.has(w));
  return { ratio: words.length ? missing.length / words.length : 0, missing };
}
