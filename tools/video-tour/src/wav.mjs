// Just enough WAV: read 16-bit PCM, write it, and lay clips on a timeline.

export function readWav(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Not a WAV file');
  let offset = 12;
  let format = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      format = {
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bits: buffer.readUInt16LE(body + 14)
      };
    } else if (id === 'data') {
      if (!format) throw new Error('WAV data before format');
      // Some services write 0xFFFFFFFF for a streamed length: take what is there.
      const end = size === 0xffffffff ? buffer.length : Math.min(buffer.length, body + size);
      const samples = new Int16Array(buffer.buffer.slice(buffer.byteOffset + body, buffer.byteOffset + end - ((end - body) % 2)));
      return { ...format, samples };
    }
    offset = body + size + (size % 2);
  }
  throw new Error('WAV without data');
}

export function wavDuration(buffer) {
  const wav = readWav(buffer);
  return wav.samples.length / wav.channels / wav.sampleRate;
}

export function writeWav(samples, sampleRate) {
  const data = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/**
 * Trims leading and trailing near-silence from a clip, keeping a few milliseconds either side, so
 * that a step's narration starts when the step does and the timeline's gaps are the only pauses.
 */
export function trimSilence(wav, { threshold = 300, keepMs = 40 } = {}) {
  const { samples, sampleRate } = wav;
  let start = 0;
  while (start < samples.length && Math.abs(samples[start]) < threshold) start++;
  let end = samples.length - 1;
  while (end > start && Math.abs(samples[end]) < threshold) end--;
  const keep = Math.round((keepMs / 1000) * sampleRate);
  start = Math.max(0, start - keep);
  end = Math.min(samples.length, end + keep);
  return { ...wav, samples: samples.slice(start, end) };
}

/** A mono timeline of the given length with each clip placed at its offset (seconds). */
export function mixTimeline(totalSeconds, sampleRate, clips) {
  const out = new Int16Array(Math.ceil(totalSeconds * sampleRate));
  for (const clip of clips) {
    const at = Math.round(clip.at * sampleRate);
    const src = clip.samples;
    for (let i = 0; i < src.length && at + i < out.length; i++) {
      const v = out[at + i] + src[i];
      out[at + i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
    }
  }
  return out;
}

/** A silent clip of the given length (the --no-voice narration). */
export function silence(seconds, sampleRate = 48000) {
  return new Int16Array(Math.max(1, Math.round(seconds * sampleRate)));
}
