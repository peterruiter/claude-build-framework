# video-tour

Narrated feature tours of a web product, made from scripts. Playwright drives a real browser
through the product, a text-to-speech voice narrates each step, and ffmpeg assembles the result.
The output has a branded title card, lower thirds, a closing card, subtitles in every language the
project chooses, chapters, a thumbnail and a poster. When the product changes, re-rendering a
video is one command. The same tool writes the catalogue for a self-hosted video library on your
own site and publishes the series to YouTube within the daily API quota.

Everything product-specific lives in two places in the product's repository: a config file
(`video-tour.config.json`) and a small **studio adapter** (`studio.mjs`) for what the tool cannot
know, such as how to sign in, how to make demo data, and what to tidy on screen.

- [Quick start](#quick-start)
- [Layout](#layout)
- [The config](#the-config)
- [Writing a script](#writing-a-script)
- [Translations](#translations)
- [The studio adapter](#the-studio-adapter)
- [Commands](#commands)
- [How it works](#how-it-works)
- [Narration, keys and costs](#narration-keys-and-costs)
- [What comes out](#what-comes-out)
- [Publishing on YouTube](#publishing-on-youtube)
- [Self-hosted library](#self-hosted-library)
- [Lessons learned](#lessons-learned)
- [Troubleshooting](#troubleshooting)

## Quick start

You need Node.js 20 or later. Install once, in `tools/video-tour`:

```
npm ci                              # Playwright 1.63.0, ffmpeg-static 5.3.0, js-yaml 4.3.2 (pinned)
npx playwright install chromium     # or let the tool find a Chromium already in the Playwright cache
```

Then, from the product's repository root (the paths below assume the tool sits at `tools/video-tour`):

```
node tools/video-tour/src/cli.mjs init                     # config, example script, adapter, sample page
node tools/video-tour/src/cli.mjs validate
node tools/video-tour/src/cli.mjs render all --no-voice    # no keys needed: silent narration
```

`init` copies the example project, *Acme Notes*, which is a tiny static notes app served by the
tool's own `src/serve.mjs`. The render starts that server, records the part, stops the server
again, and writes the video to `video-tour/output/`. Then make it yours:

1. Edit `video-tour.config.json`: product, brand, `app.baseUrl` and `app.start`, narration, languages.
2. Replace `video-tour/studio.mjs` with your product's adapter (sign-in, demo data, tidying).
3. Write one YAML script per part in `video-tour/scripts/`, rehearse it with `dry`, and render it.
4. Add `video-tour/.work/`, `video-tour/.cache/` and `video-tour/output/` to `.gitignore`. `init`
   writes a `video-tour/.gitignore` that does this.

To try the bundled example without `init`, run this inside `tools/video-tour`:

```
node src/cli.mjs validate --config example/video-tour.config.json
node src/cli.mjs render all --no-voice --config example/video-tour.config.json
```

## Layout

```
tools/video-tour/                   the tool (product-neutral; copy it into a repository or run it from here)
  src/cli.mjs                       every command
  src/recorder.mjs, overlay.js      the browser, the cursor, highlights, zoom, frames
  src/tts.mjs, azure.mjs, qa.mjs    narration (azure | system | silent) and the transcription check
  src/assemble.mjs, cards.mjs, stage.mjs, subtitles.mjs, wav.mjs
  src/manifest.mjs, library.mjs, youtube.mjs
  src/adapter.mjs                   loads the product's adapter; built-in setup steps
  src/app.mjs, serve.mjs            start/stop the app under test; a tiny static server
  src/templates/                    card.html, phone.html, theme.css (filled from the brand config)
  example/                          what `init` copies (Acme Notes)

<product repo>/
  video-tour.config.json            the config (no secrets)
  video-tour/scripts/NN-<id>.yaml   one script per part
  video-tour/scripts/i18n/<id>.yaml translations of that part's texts
  video-tour/studio.mjs             the studio adapter
  video-tour/lexicon.yaml           how the voice says product terms
  video-tour/assets/                files the scripts upload
  video-tour/brand/                 logo (and font) for the cards
  video-tour/youtube-state.json     which YouTube upload is which part (no secrets; commit it)
  video-tour/.work/  .cache/  output/   never committed
```

`.cache/` holds the synthesised narration (re-renders of unchanged sentences are free) and the
adapter's kept sessions. `.work/` holds frames and timings of the last recording. `output/` holds
the finished videos, which are large; keep them out of git.

## The config

`video-tour.config.json` is found with `--config <file>`, with `VIDEO_TOUR_CONFIG`, or by walking up
from the current folder. Paths in it are relative to the file's own folder. It never holds a
secret: the Speech key is read from the environment variable it names, and the YouTube OAuth
client file is named at run time.

| Section | Keys | Notes |
|---|---|---|
| `product` | `name`, `url` | `url` goes on the closing card and in descriptions. |
| `brand` | `logo` (SVG or PNG), `colors` (`background`, `backgroundAlt`, `accent`, `accentAlt`, `text`, `textMuted`, `onAccent`, `highlight`), `font` (`family`, `file`: a `.woff2`); or `designSystem` (a design system id), with `designSystemsDir` optional | Used by the title card, the closing card, lower thirds, thumbnails, posters, the phone stage, and the highlight ring and click ripple. Without a logo, the product name is drawn as a wordmark. With `"designSystem": "<id>"` the colours, font and logo come from that design system through the build framework's `scripts/design-system.mjs` (`show <id> --target video`); the design systems are looked for in `designSystemsDir` (relative to the config), then `design-systems/` next to the config, then the framework the tool sits in. Colours, font or logo set beside it override the design system's. A project can also paste the generated `video-brand.json` here instead. |
| `app` | `baseUrl`, `publicUrl`, `start` (`command`, `cwd`, `readyPath`, `timeoutSeconds`, `env`), `hostRoutes`, `replaceText`, `viewport`, `locale` (per language), `timezone`, `colorScheme`, `ignoreProblems` (regexes), `zoomRoot` (CSS selector) | If `baseUrl` already answers, the app is used as it is. Otherwise `start.command` is run (`{tool}` is this folder, `{base}` the base URL), and the tool waits for `readyPath` and stops the app afterwards. `VIDEO_TOUR_BASE` or `--base` override the URL. |
| `narration` | `language`, `provider` (`azure`, `system`, `silent`), `voice`, `locale`, `region` or `endpoint`, `auth` (`key`, `entra`), `keyEnv`, `subscription`, `parameters`, `hd`, `multilingual`, `rate`, `systemVoice`, `lexicon`, `pricePerMillion`, `charsPerSecond`, `qaSplit`, `qaNumbers` | One narrated language per project. |
| `subtitles` | `languages`, `burnIn` (a language code, or a list), `burnInStyle` (ASS `force_style`) | **The project chooses its languages.** The narration language is always included. |
| `text` | per language: `series`, `seriesShort`, `closing`, `tryIt`, `note`, `playlistLine` | The words around the videos (card eyebrow, closing line, description boilerplate), with `{product}`, `{url}`, `{n}`, `{count}` and `{playlist}` filled in. Only English ships as a default; `validate` lists any other configured language that has no entry. |
| `timing` | `stepGapMs`, `sceneGapMs`, `leadInMs`, `tailMs`, `introSeconds`, `outroSeconds`, `lowerThirdSeconds`, `settleMs` | |
| `video` | `fps` (30), `crf` (19), `preset` (`slow`), `loudness` (-16 LUFS) | |
| `paths` | `scripts`, `adapter`, `assets`, `uiStrings` (`{ "ui": "src/locales/{lang}.json" }`), `work`, `cache`, `output` | |
| `library` | `catalogue`, `assets`, `videoUrl` (`/videos/{file}.mp4`), `posterWidth`, `languages`, `groups` (key → name per language), `strict` | See [Self-hosted library](#self-hosted-library). |
| `youtube` | `channelId`, `playlistId`, `playlistTitle`, `playlistDescription` (per language), `clientEnv` (`YT_CLIENT`), `stateFile`, `dailyQuota` (10000), `costs`, `categoryId`, `tags`, `titleTemplate`, `privacy`, `madeForKids`, `captionOrder`, `match` (`byPartNumber`, `byTitle`) | See [Publishing on YouTube](#publishing-on-youtube). |

**Host routing.** With `publicUrl` set (for example `https://notes.example.com`) and the app recorded
locally, two things happen inside the recording browser only. Every request to the public origin
is answered by the local app, so links the server writes with its public address open locally and
never on production. Wherever the page shows the local host (a link, a share URL), the public
host is shown instead. `hostRoutes: [{ "from": "https://cdn.example.com", "to": "{base}" }]` adds
more such routes, and `replaceText` rewrites any other text on screen.

## Writing a script

One file per part: `video-tour/scripts/NN-<id>.yaml`. Copy the example, give it the next `order`
and a new `id`, then rehearse it with `dry <id>` until the contact sheet shows the right screens.

```yaml
id: getting-started          # lower-case, digits, hyphens: becomes NN-<id> file names and URLs
order: 1                     # the part number ("Part 1")
group: basics                # a grouping for the library (library.groups names it)
frame: browser               # browser (1920×1080) or phone (the app in a handset on the brand backdrop)
title: "Your first note"     # a string is the narration language; or { en: ..., de: ... }
thumbTitle: "First note"     # shorter title for the thumbnail
subtitle: "Write, find and keep your notes in one place."   # title card's second line
summary: "..."               # manifest, library and YouTube description
closing: "..."               # overrides text.<lang>.closing on the closing card
thumbnail: { step: write.3, at: 0.6 }    # which moment's frame goes on the thumbnail (or { scene, at })
tags: [search]               # extra YouTube tags
helpSections: [notes]        # free-form: where an in-app help could offer this video
strings: ui                  # which uiStrings bundle {@key} reads by default
vars: { project: "Team day" }    # {project} anywhere below; {today}, {now}, {base}, {run} are built in
setup:   [ ... ]             # before recording, not filmed
cleanup: [ ... ]             # after recording, also after a failure
capture: [{ url: "/api/notes$", method: POST, save: { noteId: id } }]   # ids the app hands out while filming, for cleanup
storage: { acme.tipSeen: "{now}" }       # localStorage before the app starts
hideCss: [".cookie-banner"]              # never shown
replaceText: { "pat@dev.local": "sam@example.com" }   # rewritten wherever it appears on screen
flags: { demoBanner: false }             # handed to the adapter's dressContext; the flags action changes them
uiZoom: 1.1                  # CSS zoom of the interface (100vh layouts may then overflow: use with care)
timing: { stepGapMs: 400 }   # overrides config timing for this part
timeoutMs: 30000             # how long an action waits for its target
start: "/"                   # path the recording opens
scenes:
  - id: write
    frame: phone             # optional: this scene in the phone (or browser); each stage is its own page, same clock
    start: "/notes"          # optional: where this stage opens
    caption: "Write a note"  # lower third (browser) or the caption beside the phone
    note: "..."              # phone scenes: a second line beside the phone (also per step)
    chapter: "Writing"       # YouTube chapter (defaults to the caption)
    lowerThird: false        # no lower third for this scene
    steps:
      - say: "Give it a title. [pause 300] Then write whatever you need to remember."
        hold: 400            # extra milliseconds after the narration
        take: 1              # a fresh rendering of this sentence (neural voices vary a little)
        do:                  # run while it is said, in order
          - type: { target: { label: Title }, text: "Ideas for the team day" }
```

Each step's actions start as its narration starts. The step then holds until the narration has
finished, plus `hold` and the step gap. A longer gap separates scenes.

**Actions** (filmed):

| Action | Value |
|---|---|
| `click` / `tap` | target; `after: ms` (default 450) |
| `hover` | target |
| `type` | `{ target, text, delay, clear }`: typed key by key, at a rhythm seeded by the step, so it is the same every render |
| `fill` | `{ target, text }`: for dates and fields that typing does not suit |
| `press` | a key: `Enter`, `Escape`, `ControlOrMeta+K` |
| `select` | `{ target, label \| value }` |
| `upload` | `{ target, files }` (files relative to `paths.assets`; a real click answered as the file dialog would be) or `{ input, files }` |
| `scroll` | `{ to: target, center }`, `{ by: px, in: target, ms }`, `{ edge: top \| bottom }` |
| `highlight` / `unhighlight` | `{ target, ms, pad, spot, radius }`: a ring in the highlight colour; `spot` dims the rest; with `ms` it goes again by itself |
| `zoom` / `unzoom` | `{ target, scale, ms }`: a CSS transform of the page (sharp, unlike a zoom in post) |
| `wait` | `800` (ms), `"1.2s"`, `"60%"` (until 60 % of this step's narration has been said) |
| `waitFor` | target (`timeout`) |
| `cursor` | `{ x, y }` or `{ target }` |
| `drag` | `{ from, to }` or `{ from, dx, dy }` |
| `goto` | path: a page load. `hash`: `"#view"` without a reload. `back` |
| `eval` | JavaScript in the page; a returned object adds to the vars |
| `hide` | CSS selector, from now on |
| `flags` | `{ name: value, reload }`: changes the adapter's flags and reloads |
| *adapter actions* | anything in the adapter's `actions` (the example has `signIn`) |

Add `optional: true` to an action whose target may or may not be on screen. The tool takes a
short look and moves on if it is not there.

**Targets** are Playwright selectors (`'button:has-text("Save")'`, `'.note'`) or objects:
`{ role, name, exact }`, `{ label, exact }`, `{ placeholder }`, `{ text, exact }`, `{ testId }`,
`{ css }`. Any of these takes `nth`, `has` (text inside), `within` (another target), `at: [x, y]`
(where to click, 0–1) and `visible: false`. A target can be a language map when it differs per
language. `{@key}` inserts the product's own words from its locale files (`paths.uiStrings`), or
from the adapter's `words()`: prefer test ids, classes and `{@key}` over literal text, so that a
reworded button does not break a script. Label and text matching is a case-insensitive substring
match unless `exact: true`: `{ label: Note }` also matches "Search notes".

**Setup and cleanup steps** (not filmed): `api: { method, path, body, save, optional, headers }`
(a request with the browser's cookies; `save` keeps response fields as vars), `eval: "js"` (in a
page of the site; a returned object adds to the vars), `storage: { key: value }`, `goto: path`,
`wait: ms`, plus anything in the adapter's `setup`. Cleanup runs after every attempt, including a
failed one, so a half-made demo record does not pile up.

**Narration.** Write short sentences, plain and warm. Say what the viewer sees and why it matters.
Keep one or two sentences per step, so the screen and the voice stay together. `[pause 400]` adds
a pause. When the voice says a term wrongly, add it to `lexicon.yaml` (`alias`, `lang` or `ipa`;
see the example file). Only the sentences that change are synthesised again.

## Translations

The narration language's text sits in the script. Every other configured language goes in
`video-tour/scripts/i18n/<id>.yaml`:

```yaml
title:    { src: "06577f3947", nl: "Je eerste notitie", de: "Deine erste Notiz" }
subtitle: { src: "...", nl: ..., de: ... }
summary:  { src: "...", nl: ..., de: ... }
captions: { write: { src: "...", nl: ..., de: ... } }
chapters: { write: { src: "...", nl: ..., de: ... } }    # only when a scene has its own chapter text
steps:
  write.2: { src: "ebda7557be", nl: "...", de: "..." }    # step keys are <scene id>.<step number>
```

`src` is a hash of the narrated text a translation was made from. `i18n <part>` prints every text
that still lacks a language, with its hash, as JSON for a translator (a person or a model). When the
narration changes, that translation is left out of the subtitles rather than shown out of step
with what is said, and `validate` lists it as outdated. After new translations arrive, run
`manifest` to rewrite the subtitles, the manifest and the YouTube text from the last render's timing.
You do not need to record again. Language names in `youtube.md` and on caption tracks come from
the platform's own language data (Deutsch, Nederlands), so no language list is built in.

## The studio adapter

The adapter is an ES module named by `paths.adapter`. Every member is optional:

```js
export default {
  async beforeAll({ base, config, log }) {},       // once per recording run, with the app up
  async afterAll({ base, config, log }) {},
  async dressContext({ context, page, doc, lang, vars, base, flags, log }) {},
  setup: { async seedDemo(value, ctx) {} },        // a script's setup:/cleanup: steps
  actions: { async signIn(value, actor) {} },      // a step's do: actions (filmed)
  words(key, lang, kind) {}                        // {@key} when no uiStrings bundle has it
};
```

- `dressContext` runs for every browser context the recorder makes (one per stage). Use it to
  tidy what is on screen with `context.route(...)`, by rewriting responses inside the recording
  browser only. Typical uses: show a customer's workspace name instead of a developer's, keep
  "what's new" badges in the same state in every video, and stop the recording from saving
  preferences back. `flags` is live: the script's `flags` action changes it, so read it per request.
- `setup` steps receive `ctx = { context, page, base, lang, vars, fill, pick, log, cacheDir, config }`.
  Create demo data through the app's API here (`ctx.context.request` carries the browser's cookies)
  and remove it in a cleanup step. A returned object adds to the vars, for example an id for the cleanup.
- `actions` receive `(value, actor)`. The actor exposes `page`, `frame` (the page, or the app inside
  the phone), `scope`, `context`, `stage`, `base`, `lang`, `vars`, `text(value)` (fills vars and
  `{@key}`), `locate(target)`, `target(target)` (a visible box with x/y), `moveTo(x, y)`,
  `run(action)` (any other action, for example `actor.run({ click: '.save' })`), `settle(page)`,
  `cacheDir` and `log`.
- **Sign-in** is the classic adapter action. Sign in between two moments, off camera: post to the
  app's sign-in endpoint, or read a one-time code from the app's log or a test mailbox, then
  `goto` to show the signed-in page. Keep the cookies in `actor.cacheDir` and reuse them while they
  work, because sign-in endpoints are usually rate-limited per address and every recording comes
  from 127.0.0.1.

`example/video-tour/studio.mjs` shows each of these patterns for the sample app: seeding and
clearing notes, a cached sign-in, a rewritten profile response and a demo-banner flag.

## Commands

Run `node tools/video-tour/src/cli.mjs <command>`. A part is named by its number, its id or its
file name, and `all` (or nothing) means every script.

| Command | What it does |
|---|---|
| `init [--dir D] [--force]` | Copies the example project; never overwrites without `--force`. |
| `list` | Scripts, estimated length, narrated characters. |
| `validate [part...]` | Config notes (missing `text` languages, key not set, ffmpeg, logo), and per script: errors that stop a render (unknown actions or setup steps, missing narration, bad ids) and notes (texts missing a language, outdated translations). Exits 1 on errors. |
| `i18n [part...]` | What still needs translating, as JSON with `src` hashes. |
| `estimate` | Characters and cost of one full render, and what has actually been spent (`.cache/usage.jsonl`). |
| `tts [part...]` | Synthesises and caches the narration only. |
| `dry [part...]` | A rehearsal: silent narration with estimated lengths, 10 fps, no assembly. Writes a contact sheet (`--every 3` seconds) and the step start times. |
| `record [part...]` | Records frames and timings into `.work/<id>/`. |
| `assemble [part...]` | Makes the video from the last recording (cards, sound, MP4, subtitles, thumbnail, poster). |
| `render [part...]` | `record` + `assemble` + manifest: the usual command. One part failing does not stop the series; failures are listed at the end and the exit code is 1. |
| `manifest [part...]` | Writes the subtitles, `manifest.json` and `youtube.md` again from the last render (after new translations). |
| `review [part...] [--at 5,60] [--every 4]` | A contact sheet and stills of a rendered video. |
| `qa [part...] [--threshold 0.15] [--verbose]` | Transcribes each narration clip with Azure and flags steps whose words did not come back. |
| `library [--strict]` | Catalogue JSON, posters and VTTs for a self-hosted library. |
| `youtube <sub> [part...]` | `plan`, `apply`, `playlist`, `captions`, `daily`, `replace`, `upload`, `catchup`, `quota`. |

Options: `--config FILE`, `--no-voice` (silent narration whatever the config says), `--offline`
(fail instead of calling Azure for narration that is not cached), `--keep` (keep the raw frames),
`--attempts N` (default 2), `--fps N`, `--base URL`, `--no-start` (never start the app),
`--burn-in LANG`, `--client FILE` (the YouTube OAuth client).

## How it works

1. **Narration first.** Every step's text is synthesised on its own and cached by provider, voice,
   settings and text. The recorder therefore knows how long each sentence lasts before filming starts.
2. **Recording.** Chromium at 1920×1080 CSS pixels, scale 1. Frames come from Chrome's screencast
   with their own timestamps and are bucketed to the output frame rate on that clock. Text stays
   sharp, and the timing in the video is the timing of the run. Each step holds until its narration
   has been said, so timing is decided by the narration, not by how fast the machine is. Typing
   jitter is seeded, so two renders of the same script match. A drawn cursor glides along a slight
   arc, clicks ripple, a ring highlights what the narration talks about, scrolling eases, and a zoom
   is a CSS transform of the page. Scrollbars are hidden. Frames inside the page (previews, embedded
   players) draw no cursor of their own.
3. **Phone scenes** render the app at 390×802 inside a drawn handset on the brand backdrop, with the
   scene's caption beside it. Taps show as a fingertip and scrolls as a swipe. A script can move
   between the browser and the phone scene by scene: each is its own page, signed in as the
   other, filmed on one clock.
4. **Assembly.** The title and closing cards are rendered frame by frame from HTML (every CSS
   animation stepped) and cross-fade with the product. Lower thirds are transparent PNGs faded in
   by ffmpeg. The narration is laid on a timeline at each step's recorded start and normalised to
   EBU R128 (-16 LUFS, true peak -1.5 dBTP, two passes). The video is H.264 High, CRF 19, with AAC
   at 160 kb/s and `+faststart`. The thumbnail and poster use the same card design with a frame of the product.
5. **Subtitles** come from the same timings: each step's text in each language is cut into cues of
   at most two lines of 42 characters and spread over the step's speech in proportion to length.
   The title has its own cue over the title card. `manifest` reports reading speed per language
   (above about 20 characters per second is hard to read).

**Robustness.** A recording lists what went wrong on screen, per step: console errors, uncaught
exceptions, the app's own requests that failed (4xx/5xx and network errors, on the base URL and
routed hosts) and pictures that did not load. These are printed, kept as `problems` in
`.work/<id>/recording.json`, counted in the manifest and summarised at the end of a run. Third-party
requests are left out; filter known noise with `app.ignoreProblems`. A failed attempt is retried
(`--attempts`), cleanup runs after every attempt, and frames still being written land before a
retry clears the folder. Azure Speech calls retry on 429 and 5xx, honouring `Retry-After`.

## Narration, keys and costs

| Provider | Needs | Use |
|---|---|---|
| `azure` | A Speech resource. `auth: "key"` reads the key from `$AZURE_SPEECH_KEY` (`keyEnv`) and uses `region` or `endpoint`. `auth: "entra"` uses `az login` and the resource's custom-subdomain `endpoint` (for resources with key authentication switched off; you need the *Cognitive Services Speech User* role). | The published voice. |
| `system` | Windows SAPI (PowerShell), macOS `say`, or `espeak-ng`. `systemVoice` picks a voice. | Rehearsing with sound, without an account. |
| `silent` (`--no-voice`) | Nothing. | Trying scripts, CI, and running the pipeline without keys: each clip is silent, as long as the text would take to say. |

Keys and tokens are read at run time and kept in memory only. They are never written to disk,
logged or put in the config. Set the key in your shell or your secret store, never in a file in
the repository.

Choose an Azure voice in the narration language. Multilingual voices say foreign names in their own
language through the lexicon's `lang`. HD voices (`hd: true`, names with `:DragonHD...`) have the
most natural prosody, take `<sub>`, `<lang>`, `<phoneme>` and `<break>` but not `<prosody>`, and
benefit from `parameters: "temperature=0.3"` for consistent renders. Only text that reaches Azure
is billed (aliases count, SSML tags do not), and cached clips are free. `estimate` prints the
series total at `pricePerMillion`, which you should check against the current Azure price list
for your region. `qa` uses fast transcription and costs a few cents per series. It waits and asks
again when the resource answers 429.

## What comes out

```
<output>/
  manifest.json                     every part: titles, summaries and chapters per language, files, duration,
                                    subtitles, reading speed, problem count
  youtube.md                        per part: thumbnail, title and description in every language, to paste by hand
  thumbnails/NN-<id>-<lang>.png     1280×720 PNG under 2 MB
  NN-<id>/NN-<id>.<lang>.mp4        1920×1080, 30 fps, H.264 High, AAC 160 kb/s stereo, -16 LUFS
  NN-<id>/NN-<id>.<lang>.captioned-<sub>.mp4   with subtitles burned in (subtitles.burnIn / --burn-in)
  NN-<id>/NN-<id>.<lang>.poster.jpg 1920×1080 poster for a web player
  NN-<id>/subtitles/NN-<id>.<lang>.<sub>.vtt|srt   one per configured language
```

`<lang>` is the narration language and `<sub>` is the subtitle language. Chapters follow scenes:
the first starts at 0:00, so it covers the title card. YouTube only shows chapters when there are
three or more, each at least 10 seconds long, and the descriptions honour that. There is no music:
add a licensed track (with its licence) before mixing one in.

## Publishing on YouTube

**By hand or through the API.** Uploading a video is the expensive call: 1,600 quota units of the
default 10,000 a day. Google also locks videos uploaded through an API project that has not passed
its compliance audit to *private*. So for most projects:

1. **Upload the MP4s by hand** in YouTube Studio, into the series' playlist, with titles that
   start with the part number (`03 search`). This is quick, and the metadata gets fixed in step 3.
2. `youtube plan` signs in, lists the playlist and pairs each part with its upload, by the part
   number the title starts with or by its exact title. It remembers the pairs in `youtube-state.json`,
   because once retitled, an upload no longer starts with its number. It reports uploads whose
   length differs from the render (an older cut) and prints the quota the remaining work needs.
3. `youtube apply` sets the title and description in the narration language plus a
   **localization** (title and description) for every other configured language, the thumbnail,
   tags, category and privacy. It then puts the playlist in the series' order. It continues where
   it stopped if the quota runs out.
4. `youtube daily`, once a day, updates the playlist (title and description per language, order),
   then uploads subtitle tracks until the day's quota is nearly used. It stops before it would go
   over, and the next run continues.

`youtube upload <part>` uploads through the API instead (resumable). It is fine for an audited
project, or when private is what you want. `youtube catchup` runs plan, apply, playlist and captions.

**Captions are what take days.** Each caption track costs 400 units, so the default quota allows
25 tracks a day. A series of 30 parts in 10 languages has 300 tracks, which takes about 12 days.
Tracks go up language by language (`captionOrder`, default the configured order), so every part
has the narration language's subtitles first. A track somebody already added in YouTube Studio
counts as done. `youtube quota` prints the remaining work offline: metadata updates at 50, thumbnails
at 50, tracks at 400, and uploads at 1,600. The quota day runs midnight to midnight Pacific time, and
the tool counts its own usage per day in the state file. Check Google's current cost table
(*YouTube Data API, quota calculator*); `youtube.costs` lets you adjust it. You can ask Google
for a higher quota once the project is audited.

**Playlist order by id.** Order is checked against the parts' video ids, not their titles, because
published titles no longer carry numbers. Only parts that are out of place are moved.

**Replace a part, keeping its place.** YouTube cannot swap a video's file. After a feature changes
and the part is re-rendered, `youtube replace <part>` uploads the new render with the same texts and
thumbnail, inserts it at the old one's position in the playlist, removes the old one from the
playlist and makes it private (it is not deleted; that stays your choice in Studio). It then
re-uploads that part's captions. Links to the old video stop working for viewers, but the playlist
link stays the same. When you upload the new render by hand instead, delete the old entry from the
state's `map` and run `plan` + `apply`.

**Setting it up.**

1. In Google Cloud, create a project, enable *YouTube Data API v3*, configure the OAuth consent
   screen (Testing mode with yourself as a test user is enough), and create an OAuth client of type
   **Desktop app**. Download its JSON and keep it **outside** the repository.
2. Run `YT_CLIENT=/path/to/client.json node tools/video-tour/src/cli.mjs youtube plan` (or pass
   `--client`). A browser opens to sign in with the channel owner's Google account (PKCE, loopback
   redirect). The token stays in memory for that run and is never stored, so each run signs in again.
3. Set `youtube.channelId` so a sign-in with the wrong account is refused. Set `youtube.playlistId`,
   or `playlistTitle` (`apply` creates the playlist when none has that title).

**Safety.** The tool only looks at and changes videos inside the series' playlist. Nothing else on
the channel is matched or touched. `youtube-state.json` holds ids and progress only, no secrets, so
commit it: the library uses it for YouTube links, and losing it means matching again.

## Self-hosted library

To show the tour on your own site without a YouTube player (no third-party cookies, no consent
banner, your own styling), `library` writes:

- `library.catalogue`: a JSON catalogue with, per part, id, part, file, `url` (`/videos/{file}.mp4`),
  blob name, group, duration, YouTube id, titles, summaries and chapters (seconds, and a label per
  language), and the subtitle languages. It also holds `groups` named per language and the playlist id.
- `library.assets/<file>/poster.jpg` (re-encoded to `posterWidth`) and `<lang>.vtt` for every
  language. Commit these with the site.

A text missing a language falls back to the narration language with a warning. `--strict` (or
`library.strict`) turns such warnings into errors, for a release build. Folders of parts that left
the series are removed, so point `library.assets` at a folder of its own.

**Serving the MP4s.** The videos (10–30 MB each) do not belong in the site's build or the
repository. The pattern:

1. Upload the MP4s to a **private** blob container (no anonymous access), named as the catalogue's
   `blob` field.
2. The site's API answers `GET /videos/{file}.mp4` (and `HEAD`) as follows:
   - Look `{file}` up in the catalogue. Anything else (a path, a dot, another case) gets a 404
     before storage is asked.
   - Answer with a **302 redirect to a short-lived, read-only signed URL** for that one blob (an
     Azure *user delegation* SAS signed with the app's managed identity, so there is no account key
     anywhere). Use HTTPS only, a lifetime of a few hours, start time a few minutes in the past
     (clock skew), and the blob's content type and cache headers set on the SAS.
   - Send `Cache-Control: no-store` on the redirect, so each play asks again. Cache the signed link
     server-side for about 30 minutes and the delegation key for about a day, renewing it while it
     still outlives a new link.
   - In development, serve the file from a local folder with range requests instead.
3. Add the storage account's origin to the page's Content-Security-Policy `media-src`.
4. The posters and `.vtt` tracks come from the site's own origin (`<track src="/assets/videos/01-x/de.vtt">`),
   so no CORS rule and no extra CSP entry are needed for subtitles.

```csharp
// ASP.NET Core minimal API, Azure.Storage.Blobs + Azure.Identity
app.MapMethods("/videos/{file}.mp4", ["GET", "HEAD"], async (string file, VideoCatalogue catalogue, BlobServiceClient blobs, CancellationToken ct) =>
{
    if (catalogue.Find(file) is not { } video) return Results.NotFound();
    var now = DateTimeOffset.UtcNow;
    var key = await blobs.GetUserDelegationKeyAsync(now.AddMinutes(-5), now.AddDays(1), ct);   // cache this
    var sas = new BlobSasBuilder { BlobContainerName = "videos", BlobName = video.Blob, Resource = "b",
        StartsOn = now.AddMinutes(-5), ExpiresOn = now.AddHours(4), Protocol = SasProtocol.Https, ContentType = "video/mp4" };
    sas.SetPermissions(BlobSasPermissions.Read);
    var url = new BlobUriBuilder(blobs.GetBlobContainerClient("videos").GetBlobClient(video.Blob).Uri)
        { Sas = sas.ToSasQueryParameters(key.Value, blobs.AccountName) }.ToUri();
    return Results.Redirect(url.AbsoluteUri);   // with Cache-Control: no-store
}).AllowAnonymous();
```

The app's identity needs *Storage Blob Data Reader* on the container (and the right to get a user
delegation key on the account). The same shape works on any cloud with signed URLs (S3 presigned
URLs, GCS signed URLs).

## Lessons learned

- **Record after the release, against the release.** Videos should show what is live. Check out
  the released commit and record against a clean local instance of it, migrated from scratch and
  seeded only with the demo data, never against a shared development database or production. Videos
  create and change things, and production needs real sign-ins.
- **Re-record a part when its feature changes.** Stale videos mislead more than missing ones. Keep
  the scripts next to the code, and when a release changes a screen, re-render the parts that show
  it (`replace` keeps their place on YouTube).
- **Rewrite real data on screen.** Developers' names and email addresses, internal hostnames and
  "(demo)" labels show up in headers, avatars and share links. Rewrite them in the recording browser
  (`replaceText`, `publicUrl`, the adapter's `dressContext`) and use made-up demo data
  (`example.com` addresses).
- **Check what embedded players and previews render.** An iframe (a video player, a map, a payment
  form, a preview) can be blank, show a consent wall or show an error in the recording browser.
  Review frames from the contact sheet (`dry`, `review --at`), not just the log.
- **Video recording is a QA run.** Every recording walks the product's main flows with a real
  browser and logs console errors, failed requests and broken images per step. Treat a non-empty
  problem list as a bug report, and fix the product rather than hiding the symptom.
- **Prefer stable targets.** Test ids and the product's own strings (`{@key}`) survive rewording.
  Literal text and substring labels do not (`{ label: Note }` also matches "Search notes"; use `exact`).
- **One voice, many subtitles.** One narrated language with subtitles in the others is far cheaper
  to keep current than a voice-over per language. Translations carry a hash of the text they
  translate, so an edited sentence is never shown with an old translation.
- **Listen without ears.** Neural voices occasionally drop or invent a word. Run `qa` after a render
  and give flagged steps a `take` or a lexicon entry.
- **Short parts.** Two to three minutes per feature area, three or more scenes (chapters), one or
  two sentences per step.
- **Spread YouTube work over days.** Captions dominate the quota. Start the daily run as soon as the
  videos are up, and do not change metadata you do not need to change: each update costs 50 units.
- **Keep the series' house style in the config.** Brand colours, the card wording and the
  description boilerplate live in one place, so a rebrand is a config change plus a re-render.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Executable doesn't exist` | `npx playwright install chromium`, or set `VIDEO_TOUR_CHROMIUM` to a Chrome/Chromium executable. |
| `locator.waitFor: Timeout` on a step | The target is not there or not visible. Run `dry` and look at the contact sheet, check substring matches (`exact: true`), and add `optional: true` for things that may not appear. |
| The app does not start | Run `app.start.command` by hand from the config's folder; `--no-start` uses an app you started yourself. |
| `No Speech key` | Set `AZURE_SPEECH_KEY` (or `keyEnv`) in the shell, or use `--no-voice`. |
| Subtitles out of step after editing narration | `validate` lists outdated translations; `i18n` gives the new hashes. |
| A silent video | That is `--no-voice` or `provider: silent`; render again with `azure` or `system`. Cached silent clips are kept apart from voiced ones. |
| Burned-in subtitles in the wrong font | Set `brand.font.file` (its folder is passed to libass) or `subtitles.burnInStyle`. |
| `quotaExceeded` from YouTube | Run the same command tomorrow (after midnight Pacific); it continues where it stopped. |
