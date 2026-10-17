---
name: video-tour
description: Plan and script a tour of short product videos (2-3 minutes per feature area) - part list and order, YAML script per part with narration and Playwright steps against a local run with demo data, subtitles in every configured language, then hand over to the video pipeline in tools/video-tour for recording, QA and (with the owner's go) publishing. Use when the user asks for "videos", "a product tour", "demo video", "re-record part N", or "screencasts".
argument-hint: "[feature areas or part numbers]"
---

# Video tour

Reference: `${CLAUDE_PLUGIN_ROOT}/docs/videos.md`. Pipeline, commands and script format:
`${CLAUDE_PLUGIN_ROOT}/tools/video-tour/README.md` (read it and the `example/` first).

## 0. Set up the tool (once per machine and plugin version)

Run the tool from the installed plugin, pointed at the project's config:

```
cd "${CLAUDE_PLUGIN_ROOT}/tools/video-tour" && npm ci     # pinned dependencies; again after a plugin update
node "${CLAUDE_PLUGIN_ROOT}/tools/video-tour/src/cli.mjs" init --dir <project>
node "${CLAUDE_PLUGIN_ROOT}/tools/video-tour/src/cli.mjs" validate --config <project>/video-tour.config.json
```

`init` scaffolds the project's config, the `studio.mjs` adapter and an example part, and never
overwrites without `--force`. Alternative for teams that want to pin or modify the tool: copy
`tools/video-tour/` into the project and run it from there. Then make it the project's own:
`video-tour.config.json` (product, brand, `app.baseUrl`, languages from
`build/contracts/locales.json`, voice) and `video-tour/studio.mjs` (sign-in, demo data, tidying).
Voices: silent for rehearsals, system or a cloud voice (in the configured data region) for real
renders; keys only from the environment or vault, never in the config.

## 1. Plan the parts

- One part per feature area a user would look for, 2–3 minutes each. Number them; keep numbers
  stable (playlist order follows them). Existing catalogue: the project's videos contract, if any.
- For each part: audience, the one thing they should be able to do after watching, the demo data
  it needs (fixed ids), the pages it visits.
- Record new parts **after** the release so they show what is live; re-record a part when its
  feature changes.

## 2. Script each part

- Follow the pipeline's script format exactly (see `tools/video-tour/` example).
- Narration: plain, second person, short sentences, the words the screens use. No AI credits.
- Steps: navigate, click, type, wait, highlight; stable selectors (roles and labels, not CSS
  classes that change); waits for content, not fixed sleeps.
- Subtitles in every configured language from `build/contracts/locales.json` (glossary terms).

## 3. Record and QA

Run the pipeline's commands against a local run with demo data. QA: transcribe the narration back
and compare with the script; read the recorder's per-step list of console errors, failed requests
and broken images. Every finding becomes a polish item (`/build-framework:polish-round`).

## 4. Publish (only with the owner's go)

Titles and descriptions per language, playlist order by part number, captions within the
platform's daily API quota (spread over days), replace a part keeping its position. Self-hosted
library: private storage, short-lived signed redirect, posters and subtitles shipped with the site.
