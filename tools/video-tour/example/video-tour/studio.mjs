// The studio adapter for Acme Notes (the example product): everything the video tool cannot know
// about the app. Copy this file into your product and replace the bodies; every member is
// optional. See tools/video-tour/README.md, "The studio adapter".
//
// The patterns here are the ones a real product needs:
//   - demo data made before the camera rolls and removed afterwards (setup.seedNotes / clearNotes),
//   - a sign-in that happens between two moments, off camera (actions.signIn), with the session
//     kept in the cache folder so a rate-limited sign-in is not repeated every render,
//   - responses tidied inside the recording browser only (dressContext): a developer's real name
//     and email replaced by a customer's, a demo banner switched by a flag the script can change.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DEMO_NOTES = [
  { title: 'Weekly planning', body: 'Review the roadmap, book the meeting room, send the agenda on Friday.', days: 1 },
  { title: 'Reading list', body: 'Three books on design, one on writing, and the article about habits.', days: 3 },
  { title: 'Groceries', body: 'Coffee, oat milk, apples, bread, something for Sunday dinner.', days: 6 },
  { title: 'Holiday ideas', body: 'A week by the sea in June, or the mountains in September.', days: 9 }
];

export default {
  async beforeAll({ base, log }) {
    log(`  studio: recording Acme Notes at ${base}`);
  },

  /**
   * Every browser context the recorder makes passes through here. Rewrites happen in the recording
   * browser only: nothing in the product changes. `flags` is live: the script's `flags` action
   * changes it in the middle of a recording, so read it on every request.
   */
  async dressContext({ context, flags }) {
    await context.route('**/api/profile.json', async (route) => {
      const response = await route.fetch();
      const json = await response.json();
      Object.assign(json, { name: 'Sam Example', email: 'sam@example.com', demo: Boolean(flags.demoBanner) });
      await route.fulfill({ response, json });
    });
  },

  /** Steps for a script's setup: and cleanup: (not filmed). Return an object to add vars. */
  setup: {
    async seedNotes(value, { page, base }) {
      const count = Math.min(DEMO_NOTES.length, value?.count ?? DEMO_NOTES.length);
      const now = Date.now();
      const notes = DEMO_NOTES.slice(0, count).map((n, i) => ({ id: `demo-${i + 1}`, title: n.title, body: n.body, changed: new Date(now - n.days * 86_400_000).toISOString() }));
      if (!page.url().startsWith(base)) await page.goto(`${base}/`);
      await page.evaluate((list) => localStorage.setItem('acme.notes', JSON.stringify(list)), notes);
      return { firstNote: notes[0].id };
    },
    async clearNotes(value, { page, base }) {
      if (!page.url().startsWith(base)) await page.goto(`${base}/`);
      await page.evaluate(() => localStorage.removeItem('acme.notes'));
    }
  },

  /** Filmed actions for a step's do: list. `actor` is the recorder's (see README). */
  actions: {
    /**
     * Signs the stage in as a demo user between two moments; the next goto shows it. A real app
     * would post to its sign-in endpoint (or read a one-time code from a log or a test mailbox) and
     * keep the cookies; here the session is a localStorage entry.
     */
    async signIn(value, actor) {
      const keep = join(actor.cacheDir, `session-${value.user ?? 'sam'}.json`);
      const session = existsSync(keep) ? JSON.parse(readFileSync(keep, 'utf8')) : { user: value.user ?? 'sam', since: new Date().toISOString() };
      await actor.frame.evaluate((s) => localStorage.setItem('acme.session', JSON.stringify(s)), session);
      writeFileSync(keep, JSON.stringify(session));
    }
  },

  /** Text for {@key} when no uiStrings bundle has it. */
  words(key, lang) {
    const table = { 'notes.new': { en: 'New note', nl: 'Nieuwe notitie', de: 'Neue Notiz' } };
    return table[key]?.[lang] ?? table[key]?.en;
  }
};
