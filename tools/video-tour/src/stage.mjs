// The look of everything the tool draws itself: the theme CSS (brand colours, font, logo) shared by
// the cards and the phone stage, and the phone stage that films a mobile web app in a handset.
import { readFileSync, existsSync } from 'node:fs';
import { extname } from 'node:path';
import { config } from './config.mjs';
import { templatesDir, escapeHtml } from './util.mjs';
import { join } from 'node:path';

export const PHONE = { scale: 1.1, statusH: 50, appW: 390, appH: 802, left: 1150, top: 60 };
PHONE.screenW = Math.round(PHONE.appW * PHONE.scale);
PHONE.screenH = PHONE.statusH + Math.round(PHONE.appH * PHONE.scale);
PHONE.w = PHONE.screenW + 28;
PHONE.h = PHONE.screenH + 28;
/** The phone's screen on the 1920 x 1080 stage, for cropping thumbnails. */
PHONE.screenRect = { x: PHONE.left + 14, y: PHONE.top + 14, width: PHONE.screenW, height: PHONE.screenH };

/** "#38bdf8" -> "56,189,248" for rgba(). */
export function rgb(hex) {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const n = Number.parseInt(full, 16);
  return Number.isNaN(n) ? '251,191,36' : `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

/** The theme stylesheet with the brand filled in; `fontUrl` is where the page can load the font file. */
export function themeCss(fontUrl) {
  const { colors, font } = config().brand;
  const vars = Object.entries({
    bg: colors.background, 'bg-2': colors.backgroundAlt, accent: colors.accent, 'accent-2': colors.accentAlt,
    text: colors.text, 'text-muted': colors.textMuted, 'on-accent': colors.onAccent, highlight: colors.highlight,
    'accent-rgb': rgb(colors.accent), 'highlight-rgb': rgb(colors.highlight)
  }).map(([k, v]) => `--${k}: ${v};`).join(' ');
  const face = fontUrl ? `@font-face { font-family: "${font.family}"; font-weight: 100 900; src: url("${fontUrl}"); }` : '';
  return readFileSync(join(templatesDir, 'theme.css'), 'utf8')
    .replace('/*{{FONT_FACE}}*/', face)
    .replace('/*{{VARS}}*/', vars)
    .replaceAll('{{FONT_FAMILY}}', font.family ?? 'Inter');
}

/** The logo as markup: an SVG inline (its text then uses the brand font), a picture as a data URL,
 *  or the product name as a wordmark when there is no logo. */
export function logoHtml() {
  const c = config();
  const file = c.dirs.logo;
  if (file && existsSync(file)) {
    if (extname(file).toLowerCase() === '.svg') {
      return readFileSync(file, 'utf8').replace(/<\?xml[^>]*>/, '').replace(/<!DOCTYPE[^>]*>/i, '').replace('<svg', '<svg class="logo"');
    }
    const type = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[extname(file).toLowerCase()] ?? 'image/png';
    return `<img class="logo" alt="" src="data:${type};base64,${readFileSync(file).toString('base64')}">`;
  }
  return `<div class="logo wordmark">${escapeHtml(c.product.name)}</div>`;
}

/** The phone stage at <origin>/__studio/phone.html, with the app at `appSrc` in its screen. */
export async function phoneRoutes(context, { appSrc, eyebrow }) {
  const c = config();
  const fontFile = c.dirs.font;
  const html = readFileSync(join(templatesDir, 'phone.html'), 'utf8')
    .replace('{{THEME_CSS}}', themeCss(fontFile && existsSync(fontFile) ? '/__studio/font' : null))
    .replaceAll('{{PHONE_LEFT}}', PHONE.left).replaceAll('{{PHONE_TOP}}', PHONE.top)
    .replaceAll('{{PHONE_W}}', PHONE.w).replaceAll('{{PHONE_H}}', PHONE.h)
    .replaceAll('{{STATUS_H}}', PHONE.statusH).replaceAll('{{STATUS_FONT}}', 17)
    .replaceAll('{{SCALE}}', PHONE.scale).replaceAll('{{APP_H}}', PHONE.appH)
    .replace('{{LOGO}}', logoHtml()).replace('{{EYEBROW}}', escapeHtml(eyebrow)).replace('{{APP_SRC}}', escapeHtml(appSrc));
  await context.route('**/__studio/phone.html', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  if (fontFile && existsSync(fontFile)) await context.route('**/__studio/font', (route) => route.fulfill({ contentType: 'font/woff2', body: readFileSync(fontFile) }));
}
