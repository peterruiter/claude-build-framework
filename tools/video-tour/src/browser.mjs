// Chromium for recording: Playwright's own build for this version, or (when that has not been
// downloaded) the newest Chromium already in the Playwright cache, or VIDEO_TOUR_CHROMIUM.
import { chromium } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export async function launchBrowser() {
  const args = ['--hide-scrollbars', '--force-color-profile=srgb', '--font-render-hinting=none'];
  if (process.env.VIDEO_TOUR_CHROMIUM) return chromium.launch({ executablePath: process.env.VIDEO_TOUR_CHROMIUM, args });
  try {
    return await chromium.launch({ args });
  } catch (error) {
    const cache = process.env.PLAYWRIGHT_BROWSERS_PATH
      || (process.platform === 'win32' ? join(process.env.LOCALAPPDATA ?? homedir(), 'ms-playwright')
        : process.platform === 'darwin' ? join(homedir(), 'Library', 'Caches', 'ms-playwright') : join(homedir(), '.cache', 'ms-playwright'));
    const builds = existsSync(cache) ? readdirSync(cache).filter((name) => /^chromium-\d+$/.test(name)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1])) : [];
    for (const build of builds) {
      for (const exe of [join(cache, build, 'chrome-win64', 'chrome.exe'), join(cache, build, 'chrome-win', 'chrome.exe'), join(cache, build, 'chrome-linux', 'chrome'), join(cache, build, 'chrome-linux64', 'chrome'), join(cache, build, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium')]) {
        if (existsSync(exe)) return chromium.launch({ executablePath: exe, args });
      }
    }
    throw new Error(`${error.message.split('\n')[0]}\nRun "npx playwright install chromium" in tools/video-tour, or set VIDEO_TOUR_CHROMIUM.`);
  }
}
