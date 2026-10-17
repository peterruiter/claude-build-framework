# Mobile starter files

Starter files for wrapping the web app in a Capacitor shell for Android and iOS. The guide is
[`docs/mobile-apps.md`](../../docs/mobile-apps.md); the [`mobile-app`](../../skills/mobile-app/SKILL.md)
skill uses these files. Replace every `com.example.app`, `Example`, `example.com`, `/app/` and
`<PLACEHOLDER>` with the owner's decisions.

| File | Copy to | What |
|---|---|---|
| `capacitor.config.ts` | `src/mobile/` | App id, name, server URL from `APP_SERVER_URL` at sync time, allowed hosts, App-Bound Domains, debug only on request |
| `package.json` | `src/mobile/` | Capacitor 8 and plugins at exact versions; `sync` scripts |
| `scripts/write-server.mjs` | `src/mobile/scripts/` | Points the offline page's "Try again" at the same server |
| `scripts/dev-certificates.mjs` | `src/mobile/scripts/` | Lists and revokes the development certificate each CI archive creates |
| `workflows/mobile.yml` | `.github/workflows/` | Android `.aab` to Play internal testing, iOS archive to TestFlight |
| `well-known/apple-app-site-association.json` | served by the app at `/.well-known/apple-app-site-association` | Universal Links (generate from settings; no redirect; `application/json`) |
| `well-known/assetlinks.json` | served at `/.well-known/assetlinks.json` | App Links with both certificate fingerprints |
| `gitignore-mobile.txt` | append to `.gitignore` | Keys, keystores, profiles and Firebase files stay out |

After copying: `cd src/mobile && npm install && npx cap add android && npx cap add ios`, then
`npm run assets`, then edit `AndroidManifest.xml` (App Links intent filter with
`android:autoVerify="true"`, `CAMERA` as an optional feature, `POST_NOTIFICATIONS`) and the iOS
project (Associated Domains, Push Notifications, `WKAppBoundDomains`, permission texts per
language, `ITSAppUsesNonExemptEncryption`). Commit the generated `android/` and `ios/` projects.
