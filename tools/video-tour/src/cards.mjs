// Branded cards drawn in the browser: the title card, the closing card, the thumbnail/poster and
// lower thirds. Animated cards are rendered frame by frame (every CSS animation paused and set to
// the frame's time), so they are perfectly smooth whatever the machine is doing.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from './config.mjs';
import { templatesDir, ensureDir } from './util.mjs';
import { themeCss, logoHtml } from './stage.mjs';

let templateFile = null;
/** The card template with the theme filled in, written once per run. */
function templateUrl() {
  if (!templateFile) {
    const c = config();
    const dir = ensureDir(join(c.dirs.work, 'cards'));
    const font = c.dirs.font && existsSync(c.dirs.font) ? pathToFileURL(c.dirs.font).href : null;
    const html = readFileSync(join(templatesDir, 'card.html'), 'utf8').replace('{{THEME_CSS}}', themeCss(font));
    templateFile = join(dir, 'card.html');
    writeFileSync(templateFile, html);
  }
  return pathToFileURL(templateFile).href;
}

async function openCard(browser, data, { width = 1920, height = 1080 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.addInitScript((card) => { window.CARD = card; }, { ...data, logo: logoHtml() });
  await page.goto(templateUrl());
  await page.evaluate(() => window.CARD_READY);
  return { context, page };
}

/**
 * Renders an animated card as numbered JPEG frames in `dir`; returns the frame files in order.
 * `data.shot` (a file URL) is the product frame the card cross-fades with.
 */
export async function renderCardFrames(browser, data, seconds, fps, dir) {
  ensureDir(dir);
  const { context, page } = await openCard(browser, { ...data, length: seconds });
  await page.evaluate(() => document.getAnimations().forEach((a) => a.pause()));
  const files = [];
  const count = Math.round(seconds * fps);
  for (let i = 0; i < count; i++) {
    const ms = (i / fps) * 1000;
    await page.evaluate((t) => document.getAnimations().forEach((a) => { a.currentTime = t; }), ms);
    const file = join(dir, `c${String(i).padStart(5, '0')}.jpg`);
    await page.screenshot({ path: file, type: 'jpeg', quality: 94 });
    files.push(file);
  }
  await context.close();
  return files;
}

/** A still: the thumbnail, the poster or a lower third (transparent PNG). */
export async function renderStill(browser, data, file, { transparent = false, type = 'png', quality } = {}) {
  const { context, page } = await openCard(browser, data);
  // Everything at its end state.
  await page.evaluate(() => document.getAnimations().forEach((a) => { a.pause(); a.currentTime = 60_000; }));
  await page.screenshot({ path: file, type, quality, omitBackground: transparent });
  await context.close();
  return file;
}
