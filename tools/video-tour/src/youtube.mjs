// Puts the tour on YouTube: titles and descriptions in every configured language, thumbnails, one
// playlist in the series' order, the videos made public, and the subtitles, as far as the day's
// quota allows.
//
//   plan       read only (a few list calls): which upload in the playlist is which video, and what is left
//   apply      titles, descriptions, localizations, thumbnails, public, playlist order
//   playlist   the playlist's own title/description per language, and its order
//   captions   subtitles, continuing where the last run stopped; stops before the quota runs out
//   daily      playlist, then captions: the command for each day until every track is up
//   replace    <part|file>...  a re-rendered video uploaded anew, put in the old one's place, old one private
//   upload     <part|file>...  a video not on YouTube yet, uploaded through the API into the playlist
//   catchup    plan, apply, playlist, captions
//   quota      offline: the units the remaining work needs, and how many days
//
// The OAuth client ("Desktop app", from Google Cloud) is a file named at run time by --client or
// the environment variable youtube.clientEnv (default YT_CLIENT). The sign-in happens in the
// browser each run; the token stays in memory and is never written anywhere. Progress (which
// upload is which video, which subtitles are up, units spent today) is kept in youtube.stateFile,
// which holds no secrets and can be committed.
//
// Safety: only videos inside the series' playlist are ever looked at or changed, matched by the
// part number their title starts with or by their exact title; with youtube.channelId set, any
// other signed-in channel is refused.
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { config } from './config.mjs';
import { nativeName } from './util.mjs';
import { readManifest, youTubeText } from './manifest.mjs';

const API = 'https://www.googleapis.com/youtube/v3';
const UPLOAD = 'https://www.googleapis.com/upload/youtube/v3';

class QuotaExceeded extends Error {}

// ---------------------------------------------------------------- state and series --

function loadState() {
  const file = config().dirs.youtubeState;
  try { return { captions: {}, done: {}, map: {}, usage: {}, ...JSON.parse(readFileSync(file, 'utf8')) }; } catch { return { captions: {}, done: {}, map: {}, usage: {} }; }
}

function saveState(state) {
  const file = config().dirs.youtubeState;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, 2) + '\n');
}

/** YouTube's quota day runs midnight to midnight Pacific time. */
function quotaDay() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
}

function playlistUrl(id) { return id ? `https://www.youtube.com/playlist?list=${id}` : null; }

/** The rendered videos with their texts per language, in part order. */
function readSeries(state) {
  const c = config();
  const manifest = readManifest(c.dirs.output);
  const playlist = playlistUrl(state?.playlist ?? c.youtube.playlistId);
  return manifest.videos.filter((video) => video.video).map((video) => {
    const texts = {};
    for (const lang of c.languages) { const t = youTubeText(video, lang, { playlist }); if (t) texts[lang] = t; }
    return { part: video.part, file: video.file, seconds: video.video.seconds, texts, video };
  }).sort((a, b) => a.part - b.part);
}

function pickVideos(series, which) {
  return which.map((one) => {
    const found = series.find((v) => v.file === one || String(v.part) === String(Number(one)) || v.video.id === one);
    if (!found) throw new Error(`No rendered video "${one}"`);
    return found;
  });
}

function captionFile(video, lang) {
  const sub = video.video.video.subtitles?.[lang]?.srt;
  const path = sub && join(config().dirs.output, sub);
  return path && existsSync(path) ? path : null;
}

function captionOrder() {
  const c = config();
  return c.youtube.captionOrder ?? c.languages;
}

// ---------------------------------------------------------------- signing in --

function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref(); } catch { /* the URL is printed too */ }
}

let token;
async function signIn(clientPath) {
  if (token) return token;
  const c = config();
  const path = clientPath ?? process.env[c.youtube.clientEnv];
  if (!path || !existsSync(path)) throw new Error(`Name the OAuth client file (a "Desktop app" client from Google Cloud) with --client <file> or ${c.youtube.clientEnv}=<file>.`);
  const client = JSON.parse(readFileSync(path, 'utf8')).installed;
  if (!client?.client_id) throw new Error('That file is not a "Desktop app" OAuth client.');

  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(16).toString('hex');
  const { code, redirect } = await new Promise((resolve, reject) => {
    let port;
    const server = createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname !== '/') { res.writeHead(404).end(); return; }
      const ok = url.searchParams.get('state') === state && url.searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        .end(ok ? '<p>Signed in. You can close this tab and go back to the terminal.</p>' : '<p>Sign-in did not complete.</p>');
      server.close();
      if (ok) resolve({ code: url.searchParams.get('code'), redirect: `http://127.0.0.1:${port}` });
      else reject(new Error(url.searchParams.get('error') ?? 'The sign-in was refused.'));
    });
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      const auth = new URL(client.auth_uri ?? 'https://accounts.google.com/o/oauth2/v2/auth');
      auth.search = new URLSearchParams({
        client_id: client.client_id, redirect_uri: `http://127.0.0.1:${port}`, response_type: 'code',
        scope: 'https://www.googleapis.com/auth/youtube.force-ssl', code_challenge: challenge,
        code_challenge_method: 'S256', state, prompt: 'select_account consent'
      }).toString();
      console.log(`Sign in with the Google account that owns the channel. If no browser opens, open:\n${auth}\n`);
      openBrowser(auth.toString());
    });
  });
  const response = await fetch(client.token_uri ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: client.client_id, client_secret: client.client_secret ?? '', code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirect })
  });
  const json = await response.json();
  if (!response.ok || !json.access_token) throw new Error(`The token exchange failed: ${json.error ?? response.status}`);
  token = json.access_token;
  return token;
}

// ---------------------------------------------------------------- the API, with quota accounting --

function costOf(method, url) {
  const k = config().youtube.costs;
  if (url.includes('/upload/youtube/v3/videos')) return k.upload;
  if (url.includes('/thumbnails/set')) return k.thumbnail;
  if (url.includes('/captions') && method === 'POST') return k.caption;
  if (method === 'GET') return k.list;
  if (method === 'DELETE') return k.delete;
  return method === 'POST' ? k.insert : k.update;
}

function makeClient(accessToken, state) {
  const c = config();
  const day = quotaDay();
  const used = () => state.usage[day] ?? 0;
  async function call(method, url, { query, json, body, contentType, headers = {} } = {}) {
    const cost = costOf(method, url);
    if (used() + cost > c.youtube.dailyQuota) throw new QuotaExceeded(`This call (${cost} units) would pass today's quota (${used()} of ${c.youtube.dailyQuota} used, by this tool's count).`);
    const target = new URL(url);
    if (query) for (const [key, value] of Object.entries(query)) target.searchParams.set(key, String(value));
    const response = await fetch(target, {
      method,
      headers: { Authorization: `Bearer ${accessToken}`, ...(json ? { 'Content-Type': 'application/json' } : contentType ? { 'Content-Type': contentType } : {}), ...headers },
      body: json ? JSON.stringify(json) : body
    });
    state.usage = { [day]: used() + cost }; // only today's count is kept
    if (response.status === 204) return response.headers.get('location') ? { location: response.headers.get('location') } : null;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const reason = data.error?.errors?.[0]?.reason ?? '';
      if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') { state.usage[day] = c.youtube.dailyQuota; throw new QuotaExceeded('YouTube says the day\'s quota is used up.'); }
      throw new Error(`${method} ${target.pathname}: ${response.status} ${reason} ${data.error?.message ?? ''}`.trim());
    }
    if (response.headers.get('location')) data.location = response.headers.get('location');
    return data;
  }
  return { call, used };
}

async function connect(opts) {
  const state = loadState();
  const yt = makeClient(await signIn(opts.client), state);
  const channel = await yt.call('GET', `${API}/channels`, { query: { part: 'snippet,contentDetails', mine: true } });
  const item = channel.items?.[0];
  if (!item) throw new Error('This Google account has no YouTube channel.');
  const want = config().youtube.channelId;
  if (want && item.id !== want) throw new Error(`Signed in to channel ${item.id} ("${item.snippet.title}"), but the config names ${want}. Sign in with the right account.`);
  return { yt, state, channel: item };
}

async function pages(yt, url, query, map) {
  const out = [];
  let pageToken;
  do {
    const page = await yt.call('GET', url, { query: { ...query, maxResults: 50, ...(pageToken ? { pageToken } : {}) } });
    out.push(...page.items.map(map));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out;
}

async function details(yt, ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const page = await yt.call('GET', `${API}/videos`, { query: { part: 'snippet,status,contentDetails,localizations', id: ids.slice(i, i + 50).join(',') } });
    for (const video of page.items) out.set(video.id, video);
  }
  return out;
}

function isoSeconds(iso) {
  const m = iso?.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : null;
}

const playlistItems = (yt, playlistId) => pages(yt, `${API}/playlistItems`, { part: 'snippet,contentDetails', playlistId },
  (item) => ({ id: item.contentDetails.videoId, itemId: item.id, title: item.snippet.title, position: item.snippet.position }));

/** The series' playlist: config playlistId, else the state's, else the one titled as configured. */
async function findPlaylist(yt, state, { create = false } = {}) {
  const c = config();
  const id = c.youtube.playlistId ?? state.playlist;
  if (id) { state.playlist = id; return id; }
  const title = c.youtube.playlistTitle?.[c.narration.language] ?? `${c.product.name} product tour`;
  const lists = await pages(yt, `${API}/playlists`, { part: 'snippet', mine: true }, (item) => item);
  const found = lists.filter((item) => item.snippet.title === title);
  if (found.length > 1) throw new Error(`More than one playlist titled "${title}": set youtube.playlistId.`);
  if (found.length) { state.playlist = found[0].id; return state.playlist; }
  if (!create) throw new Error(`No playlist titled "${title}". Create it (by hand, or with "apply"), or set youtube.playlistId.`);
  const made = await yt.call('POST', `${API}/playlists`, { query: { part: 'snippet,status' }, json: {
    snippet: { title, description: c.youtube.playlistDescription?.[c.narration.language] ?? '', defaultLanguage: c.narration.language },
    status: { privacyStatus: c.youtube.privacy } } });
  state.playlist = made.id;
  saveState(state);
  console.log(`Playlist made: ${playlistUrl(made.id)}`);
  return made.id;
}

/** The language code YouTube knows for one of ours (nb may be "no", pt may be "pt-PT", ...). */
async function languageCodes(yt) {
  const data = await yt.call('GET', `${API}/i18nLanguages`, { query: { part: 'snippet', hl: 'en' } });
  const known = new Set(data.items.map((item) => item.snippet.hl));
  const aliases = { nb: ['nb', 'no'], pt: ['pt-PT', 'pt'], zh: ['zh-CN', 'zh-Hans', 'zh'] };
  return (code) => (known.has(code) ? code : (aliases[code] ?? []).find((a) => known.has(a)) ?? [...known].find((k) => k.startsWith(`${code}-`)) ?? code);
}

/**
 * Pairs each video with an upload in the playlist: the id matched before, else the part number the
 * upload's title starts with ("03 search", "3 - Search"), else its exact title. Nothing outside
 * the playlist is considered.
 */
function match(series, list, state) {
  const c = config();
  const lang = c.narration.language;
  return series.map((video) => {
    const known = state.map[video.file] && list.find((item) => item.id === state.map[video.file]);
    if (known) return { video, upload: known, candidates: [known] };
    let found = [];
    if (c.youtube.match.byPartNumber) found = list.filter((item) => Number(item.title.match(/^\s*(\d{1,3})(?![\d.])/)?.[1]) === video.part);
    if (!found.length && c.youtube.match.byTitle) {
      const titles = [video.video.title?.[lang], video.texts[lang]?.title].filter(Boolean).map((t) => t.trim().toLowerCase());
      found = list.filter((item) => titles.includes(item.title.trim().toLowerCase()));
    }
    return { video, upload: found.length === 1 ? found[0] : null, candidates: found };
  });
}

function metadata(video, lang, old) {
  const c = config();
  const narrated = c.narration.language;
  const localizations = {};
  for (const [code, text] of Object.entries(video.texts)) if (code !== narrated) localizations[lang(code)] = text;
  return {
    snippet: { title: video.texts[narrated].title, description: video.texts[narrated].description, categoryId: old?.snippet?.categoryId ?? c.youtube.categoryId,
      defaultLanguage: lang(narrated), defaultAudioLanguage: lang(narrated), tags: [...(c.youtube.tags ?? []), ...(video.video.tags ?? [])].slice(0, 30) },
    status: { privacyStatus: c.youtube.privacy, selfDeclaredMadeForKids: Boolean(c.youtube.madeForKids), embeddable: true, license: 'youtube' },
    localizations
  };
}

// ---------------------------------------------------------------- the steps --

async function plan(opts) {
  const { yt, state, channel } = await connect(opts);
  const playlistId = await findPlaylist(yt, state);
  const list = await playlistItems(yt, playlistId);
  const series = readSeries(state);
  const pairs = match(series, list, state);
  const info = await details(yt, pairs.filter((p) => p.upload).map((p) => p.upload.id));
  console.log(`Channel: ${channel.snippet.title} (${channel.id}). Playlist ${playlistUrl(playlistId)} holds ${list.length} videos; the series has ${series.length} rendered.\n`);
  for (const { video, upload, candidates } of pairs) {
    if (!upload) { console.log(`${String(video.part).padStart(2)} ${video.file}: ${candidates.length ? `more than one upload matches (${candidates.map((x) => x.id).join(', ')})` : 'not in the playlist yet'}`); continue; }
    const live = info.get(upload.id);
    const length = isoSeconds(live?.contentDetails?.duration);
    const off = length !== null && Math.abs(length - video.seconds) > 3 ? `  LENGTH ${length}s, rendered ${Math.round(video.seconds)}s (an older render? see "replace")` : '';
    console.log(`${String(video.part).padStart(2)} ${video.file} -> ${upload.id} "${upload.title}" (${live?.status?.privacyStatus})${off}`);
  }
  const unmatched = list.filter((item) => !pairs.some((p) => p.upload?.id === item.id));
  if (unmatched.length) console.log(`\nIn the playlist but not matched: ${unmatched.map((item) => `"${item.title}"`).join(', ')}`);
  // Matches are remembered: once retitled, an upload no longer starts with its number.
  const taken = new Set(Object.values(state.map));
  for (const p of pairs) if (!state.map[p.video.file] && p.upload && !taken.has(p.upload.id)) state.map[p.video.file] = p.upload.id;
  saveState(state);
  console.log(`\nKnown: ${Object.keys(state.map).length} of ${series.length} videos.`);
  printQuota(state, series);
}

async function apply(opts, session) {
  const { yt, state } = session ?? await connect(opts);
  const playlistId = await findPlaylist(yt, state, { create: true });
  const series = readSeries(state);
  const lang = await languageCodes(yt);
  const info = await details(yt, Object.values(state.map));
  try {
    for (const video of series) {
      const id = state.map[video.file];
      if (!id) { console.log(`skip ${video.file}: no upload matched (run "plan")`); continue; }
      const done = state.done[video.file] ??= {};
      if (!done.metadata) {
        await yt.call('PUT', `${API}/videos`, { query: { part: 'snippet,status,localizations' }, json: { id, ...metadata(video, lang, info.get(id)) } });
        done.metadata = new Date().toISOString(); saveState(state);
        console.log(`${video.file}: title and description in ${Object.keys(video.texts).length} language(s), ${config().youtube.privacy}`);
      }
      if (!done.thumbnail) {
        const png = join(config().dirs.output, video.video.video.thumbnail);
        if (existsSync(png)) {
          await yt.call('POST', `${UPLOAD}/thumbnails/set`, { query: { videoId: id, uploadType: 'media' }, body: readFileSync(png), contentType: 'image/png' });
          done.thumbnail = new Date().toISOString(); saveState(state);
          console.log(`${video.file}: thumbnail`);
        }
      }
    }
    await order(yt, state, series, playlistId);
  } catch (error) {
    saveState(state);
    if (!(error instanceof QuotaExceeded)) throw error;
    console.log(`\n${error.message} Run "apply" again tomorrow; it continues where it stopped.`);
  }
  saveState(state);
}

/** The playlist in the series' order, by video id (titles no longer carry part numbers). */
async function order(yt, state, series, playlistId) {
  const want = series.filter((v) => state.map[v.file]);
  let moved = 0;
  for (const [index, video] of want.entries()) {
    const id = state.map[video.file];
    const items = await playlistItems(yt, playlistId);
    const item = items.find((entry) => entry.id === id);
    const resource = { playlistId, position: index, resourceId: { kind: 'youtube#video', videoId: id } };
    if (!item) { await yt.call('POST', `${API}/playlistItems`, { query: { part: 'snippet' }, json: { snippet: resource } }); moved++; console.log(`${video.file}: added to the playlist`); }
    else if (item.position !== index) { await yt.call('PUT', `${API}/playlistItems`, { query: { part: 'snippet' }, json: { id: item.itemId, snippet: resource } }); moved++; }
  }
  const final = (await playlistItems(yt, playlistId)).sort((a, b) => a.position - b.position);
  const partOf = new Map(want.map((v) => [state.map[v.file], v.part]));
  const parts = final.map((entry) => partOf.get(entry.id)).filter((p) => p !== undefined);
  const ordered = parts.every((p, i) => i === 0 || p > parts[i - 1]);
  console.log(`Playlist order: ${moved} moved; ${ordered ? 'parts in order' : 'NOT in order'}.`);
}

async function playlist(opts, session) {
  const { yt, state } = session ?? await connect(opts);
  const c = config();
  const playlistId = await findPlaylist(yt, state);
  const titles = c.youtube.playlistTitle;
  if (titles?.[c.narration.language]) {
    const lang = await languageCodes(yt);
    const localizations = {};
    for (const code of c.languages) {
      if (code === c.narration.language || !titles[code]) continue;
      localizations[lang(code)] = { title: titles[code], description: c.youtube.playlistDescription?.[code] ?? '' };
    }
    await yt.call('PUT', `${API}/playlists`, { query: { part: 'snippet,status,localizations' }, json: {
      id: playlistId,
      snippet: { title: titles[c.narration.language], description: c.youtube.playlistDescription?.[c.narration.language] ?? '', defaultLanguage: lang(c.narration.language), tags: c.youtube.tags ?? [] },
      status: { privacyStatus: c.youtube.privacy }, localizations } });
    console.log(`Playlist: "${titles[c.narration.language]}", title and description in ${Object.keys(localizations).length + 1} language(s)`);
  }
  await order(yt, state, readSeries(state), playlistId);
  saveState(state);
}

async function captions(opts, session) {
  const { yt, state } = session ?? await connect(opts);
  const series = readSeries(state);
  const lang = await languageCodes(yt);
  const cost = config().youtube.costs.caption;
  let uploaded = 0;
  try {
    // Language by language, so every video has the narration language's track before any has a second.
    for (const code of captionOrder()) {
      for (const video of series) {
        const id = state.map[video.file];
        const key = `${video.file}:${code}`;
        if (!id || state.captions[key]) continue;
        const path = captionFile(video, code);
        if (!path) continue;
        const boundary = `vt${randomBytes(12).toString('hex')}`;
        const meta = JSON.stringify({ snippet: { videoId: id, language: lang(code), name: nativeName(code), isDraft: false } });
        const body = Buffer.concat([
          Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
          readFileSync(path),
          Buffer.from(`\r\n--${boundary}--\r\n`)
        ]);
        try {
          await yt.call('POST', `${UPLOAD}/captions`, { query: { part: 'snippet', uploadType: 'multipart' }, body, contentType: `multipart/related; boundary=${boundary}` });
        } catch (error) {
          // A track in this language somebody added by hand in YouTube Studio counts as done.
          if (error instanceof QuotaExceeded || !/captionExists|409/.test(error.message)) throw error;
          state.captions[key] = 'existing'; saveState(state);
          console.log(`${video.file}: ${code} subtitles were already there`);
          continue;
        }
        state.captions[key] = new Date().toISOString(); saveState(state);
        uploaded++;
        console.log(`${video.file}: ${code} subtitles (${cost} units)`);
      }
    }
  } catch (error) {
    saveState(state);
    if (!(error instanceof QuotaExceeded)) throw error;
    console.log(`\n${error.message} Run "captions" (or "daily") again tomorrow; it continues where it stopped.`);
  }
  saveState(state);
  console.log(`\n${uploaded} uploaded in this run.`);
  printQuota(state, series);
}

/** A resumable upload: one call for the session, one for the file. Returns the new video's id. */
async function uploadFile(yt, video, meta) {
  const mp4 = readFileSync(join(config().dirs.output, video.video.video.file));
  const start = await yt.call('POST', `${UPLOAD}/videos`, {
    query: { uploadType: 'resumable', part: 'snippet,status,localizations' },
    json: meta,
    headers: { 'X-Upload-Content-Type': 'video/mp4', 'X-Upload-Content-Length': String(mp4.length) }
  });
  if (!start?.location) throw new Error('YouTube did not open an upload session');
  const sent = await fetch(start.location, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'video/mp4' }, body: mp4 });
  const created = await sent.json().catch(() => ({}));
  if (!sent.ok || !created.id) throw new Error(`The upload failed: ${sent.status}`);
  if (created.status?.privacyStatus !== meta.status.privacyStatus) {
    console.log(`  note: YouTube made it ${created.status?.privacyStatus}. Uploads from an API project that has not passed Google's audit are locked private: upload by hand in YouTube Studio instead (see README).`);
  }
  return created.id;
}

async function upload(opts, which) {
  const { yt, state } = await connect(opts);
  const playlistId = await findPlaylist(yt, state, { create: true });
  const series = readSeries(state);
  const lang = await languageCodes(yt);
  for (const video of pickVideos(series, which)) {
    if (state.map[video.file]) { console.log(`${video.file}: already on YouTube as ${state.map[video.file]} (use "replace")`); continue; }
    const id = await uploadFile(yt, video, metadata(video, lang));
    state.map[video.file] = id; state.done[video.file] = { metadata: new Date().toISOString() }; saveState(state);
    console.log(`${video.file}: uploaded as ${id}`);
    const png = join(config().dirs.output, video.video.video.thumbnail);
    if (existsSync(png)) { await yt.call('POST', `${UPLOAD}/thumbnails/set`, { query: { videoId: id, uploadType: 'media' }, body: readFileSync(png), contentType: 'image/png' }); state.done[video.file].thumbnail = new Date().toISOString(); }
    saveState(state);
  }
  await order(yt, state, series, playlistId);
  saveState(state);
}

/**
 * A video re-rendered after it was published: YouTube cannot swap a file, so the new render is
 * uploaded as a new video with the same texts and thumbnail, takes the old one's place in the
 * playlist, and the old upload is made private (not deleted: that stays the owner's choice).
 */
async function replace(opts, which) {
  const { yt, state } = await connect(opts);
  const playlistId = await findPlaylist(yt, state);
  const series = readSeries(state);
  const lang = await languageCodes(yt);
  for (const video of pickVideos(series, which)) {
    const oldId = state.map[video.file];
    if (!oldId) throw new Error(`${video.file} is not on YouTube yet: use "upload", or upload by hand and run "plan".`);
    const old = (await details(yt, [oldId])).get(oldId);
    const id = await uploadFile(yt, video, metadata(video, lang, old));
    console.log(`${video.file}: uploaded as ${id}`);
    const png = join(config().dirs.output, video.video.video.thumbnail);
    if (existsSync(png)) await yt.call('POST', `${UPLOAD}/thumbnails/set`, { query: { videoId: id, uploadType: 'media' }, body: readFileSync(png), contentType: 'image/png' });
    const items = await playlistItems(yt, playlistId);
    const oldItem = items.find((entry) => entry.id === oldId);
    const position = oldItem?.position ?? series.indexOf(video);
    await yt.call('POST', `${API}/playlistItems`, { query: { part: 'snippet' }, json: { snippet: { playlistId, position, resourceId: { kind: 'youtube#video', videoId: id } } } });
    if (oldItem) await yt.call('DELETE', `${API}/playlistItems`, { query: { id: oldItem.itemId } });
    await yt.call('PUT', `${API}/videos`, { query: { part: 'status' }, json: { id: oldId, status: { privacyStatus: 'private', selfDeclaredMadeForKids: Boolean(config().youtube.madeForKids) } } });
    console.log(`${video.file}: at place ${position + 1} in the playlist; the old upload ${oldId} is now private (delete it in YouTube Studio if you like)`);
    state.map[video.file] = id;
    state.replaced = { ...(state.replaced ?? {}), [video.file]: [...(state.replaced?.[video.file] ?? []), oldId] };
    state.done[video.file] = { metadata: new Date().toISOString(), thumbnail: new Date().toISOString() };
    for (const key of Object.keys(state.captions)) if (key.startsWith(`${video.file}:`)) delete state.captions[key];
    saveState(state);
  }
}

/** What the remaining work costs in quota units, and how many days at the daily quota. */
function printQuota(state, series) {
  const c = config();
  const k = c.youtube.costs;
  const day = quotaDay();
  let units = 0;
  const lines = [];
  const pending = series.filter((v) => state.map[v.file]);
  const meta = pending.filter((v) => !state.done[v.file]?.metadata).length;
  const thumbs = pending.filter((v) => !state.done[v.file]?.thumbnail).length;
  const tracks = pending.reduce((sum, v) => sum + captionOrder().filter((l) => captionFile(v, l) && !state.captions[`${v.file}:${l}`]).length, 0);
  const notUp = series.filter((v) => !state.map[v.file]).length;
  if (meta) { units += meta * k.update; lines.push(`${meta} video(s) to retitle and describe: ${meta * k.update}`); }
  if (thumbs) { units += thumbs * k.thumbnail; lines.push(`${thumbs} thumbnail(s): ${thumbs * k.thumbnail}`); }
  if (tracks) { units += tracks * k.caption; lines.push(`${tracks} subtitle track(s) at ${k.caption}: ${tracks * k.caption}`); }
  if (notUp) lines.push(`${notUp} video(s) not on YouTube: ${k.upload} each through the API (or upload by hand, then "plan")`);
  const left = Math.max(0, c.youtube.dailyQuota - (state.usage?.[day] ?? 0));
  console.log(`\nQuota: ${units ? `${units} units of work left` : 'no updates left'}${lines.length ? `:\n  ${lines.join('\n  ')}` : ''}`);
  console.log(`  today (${day}, Pacific): ${state.usage?.[day] ?? 0} used by this tool, ${left} left of ${c.youtube.dailyQuota}; about ${Math.max(1, Math.ceil(units / c.youtube.dailyQuota))} day(s) at the full daily quota (list calls cost 1 each on top).`);
}

export async function youtube(sub, rest, opts = {}) {
  const run = {
    plan: () => plan(opts),
    apply: () => apply(opts),
    playlist: () => playlist(opts),
    captions: () => captions(opts),
    daily: async () => { const s = await connect(opts); await playlist(opts, s); await captions(opts, s); },
    catchup: async () => { await plan(opts); const s = await connect(opts); await apply(opts, s); await playlist(opts, s); await captions(opts, s); },
    replace: async () => { if (!rest.length) throw new Error('replace <part|file>...'); await replace(opts, rest); const s = await connect(opts); await captions(opts, s); },
    upload: async () => { if (!rest.length) throw new Error('upload <part|file>...'); await upload(opts, rest); },
    quota: async () => { const state = loadState(); printQuota(state, readSeries(state)); }
  }[sub];
  if (!run) throw new Error('youtube plan | apply | playlist | captions | daily | replace <part>... | upload <part>... | catchup | quota');
  await run();
}
