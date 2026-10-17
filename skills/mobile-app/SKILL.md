---
name: mobile-app
description: Add Android and iOS store apps to an existing web product by wrapping its PWA in a Capacitor shell (one app for every tenant, deep links, offline, push, Wallet, optional Apple Watch companion), with CI builds to Google Play internal testing and TestFlight. Use when the owner asks for native apps, store apps, push on iOS without Home Screen install, Wallet passes in an app, or a watch app.
---

# Add native apps to a web product

Follow [`docs/mobile-apps.md`](../../docs/mobile-apps.md) (the guide; read it first) and use the
starter files in [`templates/mobile/`](../../templates/mobile/README.md). Plan it as a wave
([waves-and-agents.md](../../docs/waves-and-agents.md)): web-side work, server-side work, the
native shell and CI can run as parallel agents once the decisions below are recorded.

## 1. Ask the owner (one message, numbered, with a recommendation each)

1. **Why native** (store presence, iOS push without Home Screen install, Wallet, scanners,
   watch)? If a PWA is enough, say so and stop here.
2. **App id**: one reverse-DNS id for both stores, e.g. `com.example.app` (permanent). App name
   and the store's primary language.
3. **One app for every tenant** with a short code and launcher (recommended), or something else?
4. **Accounts and who holds Admin**: Apple Developer team (`<TEAM_ID>`; organisation needs a
   D-U-N-S number), Google Play Console (organisation account recommended: a personal account
   created after 13 Nov 2023 needs a 14-day closed test with 12 testers before production),
   Firebase project, Google Wallet issuer, Apple Pass Type ID.
5. **Features**: push, deep links, Wallet passes, camera/QR, files to the share sheet, offline,
   Apple Watch companion, hardware scanners. Default: push, deep links, camera, offline; Wallet if
   the product has tickets or passes; watch only when asked for.
6. **Languages**: the project's configured set ([languages.md](../../docs/languages.md)); every
   native string needs all of them.
7. **Where keys live**: password manager or a private repository (owner only) plus GitHub
   secrets and the vault. Never in this repository, never in chat.
8. **Release**: TestFlight and Play internal track first; who tests; release after approval
   automatically or by hand.

Record the answers in STATE.md (decisions) and ROADMAP.md (the wave), then continue.

## 2. Web app first (PWA)

- Installable manifest, service worker with offline for the user's key data, App-Bound-Domains
  aware (see the guide's Offline section). Measure it in a browser before wrapping.
- `native.ts`: `isNativeApp()` from `window.Capacitor`, plugin wrappers returned inside objects,
  no-ops in a browser. `native-links.ts`: one function deciding where every link goes.
  `native-push.ts`: token registration beside Web Push.
- Launcher at the app root: code entry, QR scan, recent list; "Switch" in the app's menu; hide
  "install this app" prompts inside the native app.
- Tests: unit tests for link decisions and code normalisation; Playwright at 390 px with a
  stubbed `window.Capacitor`.

## 3. Server

- Codes: column, normalised unique key, generator, admin UI (change, regenerate with warning,
  poster), rate-limited public lookup with a uniform 404.
- `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` from settings,
  `application/json`, no redirect on apex and www, 404 until configured.
- Push: native device table (per user, token hash unique, APNs environment), shared delivery
  queue, APNs token auth (`.p8`) and FCM HTTP v1 (service account), keys read from the vault,
  pruning on 410/UNREGISTERED, minimal payload. Unconfigured: offer nothing.
- Wallet (if chosen): `.pkpass` signing with the Pass Type ID certificate and WWDR intermediate,
  PassKit web service, Google Wallet class/object and save JWT; credentials uploaded into the vault.
- "Delete my data" in the app (App Store 5.1.1(v)) if it is not there yet: deletes or anonymises,
  removes push devices and passes, confirmed with a fresh code.
- Tests against a fake HTTP handler for APNs/FCM; stand-ins for Wallet APIs
  ([testing.md](../../docs/testing.md)). Say "verified only against the stand-in" until real.

## 4. The shell

1. Copy `templates/mobile/` files as its README says; set the app id, name, hosts, app path.
2. `npm install`, `npx cap add android`, `npx cap add ios` (Swift Package Manager), `npm run assets`.
3. Android: App Links intent filter (`autoVerify`), permissions, notification channel and
   monochrome icon, a "push available" plugin (Firebase missing must not crash), back button.
4. iOS: Associated Domains, Push Notifications capability and remote-notification background
   mode, `WKAppBoundDomains`, permission texts in every language (`*.lproj/InfoPlist.strings`,
   `CFBundleLocalizations`, known regions), `ITSAppUsesNonExemptEncryption` false, Wallet add-sheet
   plugin if Wallet is chosen, privacy manifest.
5. Watch (if chosen): SwiftUI app + WidgetKit extension, shared local Swift package with tests,
   WatchConnectivity plugin on the phone, keychain access group (not an App Group), Debug-only
   sample data and clock for screenshots.
6. Run the Android debug build in the emulator against a laptop (`APP_SERVER_URL=http://10.0.2.2:<port>/app/ APP_DEBUG=1 npm run sync:android`).

## 5. CI

- Copy `workflows/mobile.yml`; replace ids; keep the development-certificate revoke steps.
- Give the owner the checklist (they do these; you never create or paste credentials):
  1. Android upload key (`keytool -genkeypair ... -keyalg RSA -keysize 4096 -validity 10000`),
     note its SHA-256; four `ANDROID_UPLOAD_*` secrets.
  2. Play Console app; **first `.aab` uploaded by hand** (run with upload off, take the artifact);
     testers; note the app signing key's SHA-256.
  3. Firebase Android app: `google-services.json` to `ANDROID_GOOGLE_SERVICES_JSON_BASE64`; a
     service account key for FCM into the vault.
  4. Play upload service account with "Release to testing tracks": `PLAY_SERVICE_ACCOUNT_JSON`.
  5. App Store Connect app record with the bundle id (capabilities Push Notifications and
     Associated Domains); one registered device on the team.
  6. App Store Connect API key, role Admin: `APP_STORE_CONNECT_KEY_ID`, `..._ISSUER_ID`,
     `..._KEY_P8_BASE64`, plus `APPLE_TEAM_ID`.
  7. A separate APNs key into the vault; its key id and the team id as app settings.
  8. App settings for the link files (team id, bundle id, package, both fingerprints); check
     both files and Google's Digital Asset Links checker.
- Ask for the go before the first run that uploads ([safety-rules.md](../../docs/safety-rules.md)):
  uploading to a store is an outward-facing action.

## 6. Store submission

Work through the guide's **Store submission checklist** with the owner: privacy labels and data
safety, account deletion, 4.2 review notes listing the native features, demo code and demo
account for the reviewer, screenshots per device class and language (automated), listing text
per language, age rating, release mode. Submitting for review needs the owner's go.

## 7. Report and record

- STATE.md: what was built, versions, what ran where (emulator, CI, real device), and an
  Unproven table (real push, Wallet on a phone, App Links verification, watch on a real watch).
- What's new entry per release in every language ([whats-new.md](../../docs/whats-new.md)).
- Remind the owner: a new language later needs a new store build for the native strings; Pass
  Type ID certificates expire yearly; both stores raise SDK minimums yearly.

## Rules

- No keys, keystores, `.p8`, `.p12`, profiles or Firebase files in the repository or in chat.
- No uploads, submissions, account or credential changes without the owner's explicit go.
- Placeholders only in anything shared (`com.example.app`, `<TEAM_ID>`, `example.com`).
- No AI attribution anywhere (store listings, release notes, commits).
