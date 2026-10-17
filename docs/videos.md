# Videos

A tour of **short videos (2–3 minutes) per feature area** is both marketing and the best QA tool:
the recorder walks every step of a real flow and logs what broke.

The pipeline lives in [`tools/video-tour/`](../tools/video-tour/): read its
[README](../tools/video-tour/README.md) for the commands (`init`, `validate`, `record`,
`assemble`, `render`, `manifest`, `qa`, `library`, `youtube`), the config
(`video-tour.config.json`), the studio adapter (`studio.mjs`) and the example. Run it from the
installed plugin with `--config <project>/video-tour.config.json` (`npm ci` in the tool's folder
once), or copy it into the project to pin or modify it. The `video-tour` skill plans parts and
writes the scripts.

## In short

- **One YAML script per part**: narration plus steps (navigate, click, type, wait, highlight).
- **Recorded with Playwright** against a local API with demo data (fixed ids), at a fixed
  viewport.
- **Voice**: text-to-speech in one language; **subtitles in every configured language**;
  chapters; a branded intro card; a separate thumbnail; a manifest per part.
- **QA**: transcribe the narration back and compare with the script; the recorder lists console
  errors, failed requests and broken images per step. Each finding becomes a polish item
  ([polish-rounds.md](polish-rounds.md)).
- **Publishing** (only with the owner's go): titles and descriptions per language, playlist order
  by part id, captions uploaded within the platform's daily API quota (spread over days); replace a
  part while keeping its playlist position.
- **Self-hosted library** on the site: private storage, short-lived signed redirect to the file,
  posters and subtitles shipped with the site. A contract (`videos.json`) lists the parts.
- **Re-record** a part when its feature changes; record new parts **after** the release so they
  show what is live.
