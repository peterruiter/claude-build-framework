# Mobile apps

How to give a web product Android and iOS apps without a second code base: build the web app as
an installable PWA first, then wrap it in a thin native shell with Capacitor that loads it from the
server, and add the native surface the stores and the users expect (push, deep links, Wallet,
camera, offline, optionally an Apple Watch companion). The [`mobile-app`](../skills/mobile-app/SKILL.md)
skill walks through it; starter files are in [`templates/mobile/`](../templates/mobile/README.md).

## Decisions to take with the owner first

| Decision | Options and advice |
|---|---|
| App or not | A PWA covers most needs (install, offline, Web Push on Android and on iOS 16.4+ from the Home Screen). Build the store apps when the audience expects a store install, when iOS push must work without "Add to Home Screen", or for Wallet, NFC, hardware scanners or a watch. |
| One app or one per tenant | **One app for every tenant**, opened with a short code or a QR code (below). One app per tenant multiplies store listings, reviews, signing identities and Apple's spam rule (4.3) risk. |
| Remote or bundled web app | **Remote** (`server.url`): a web release reaches phones at once, without a store review, and the app and the browser never disagree. Bundled (`webDir`) only when the app must start with no network at all. The remote shell still ships a local offline page. |
| Bundle id / package name | One reverse-DNS id for both platforms, e.g. `com.example.app`; it can never change after the first upload. Watch app and extensions hang below it (`com.example.app.watchkitapp`). |
| Accounts | Apple Developer Program (organisation account needs a D-U-N-S number; Team ID `<TEAM_ID>`), Google Play Console (**organisation** account if at all possible, see Lessons), Firebase project for FCM, Google Wallet issuer, Apple Pass Type ID. Who owns each, and who holds Admin. |
| Features | Push, deep links, Wallet passes, camera/QR, files and share sheet, offline, Watch companion, hardware scanners. Each costs store-review surface and keys to manage. |
| Languages | The project's configured set ([languages.md](languages.md)). Native strings (permission texts, watch strings, offline page) need every language too, and a new language needs a new store build. |

## Architecture

```text
Store app (Capacitor shell)               Server
 ├─ WebView loads https://example.com/app/ ──► the same web app the browser gets
 │   └─ service worker: offline pages and data
 ├─ native plugins: push token, app links, ──► push registration endpoint, link files,
 │   share sheet, Wallet sheet, camera        .pkpass and Google Wallet save links
 └─ local offline page (www/offline.html)
APNs / FCM ◄── server sends push with keys from the vault
```

- **The web app decides, the shell carries.** The web app asks `window.Capacitor` whether it runs
  in the app (never the user agent; append a token such as `ExampleApp/1` to the user agent only so
  logs can tell). Every native call goes through one small `native.ts` wrapper that is a no-op in
  a browser, so the web build stays one build.
- **Wrap plugins in an object.** A Capacitor plugin is a proxy that answers `then`; resolving a
  promise with a bare plugin calls a non-existent native `then()`. Return `{ plugin }`.
- **Links, decided once in one function:** own pages under the app path stay in the WebView;
  meetings, maps, `tel:`, `mailto:` go to the system (`@capacitor/app-launcher`); other sites open
  in the in-app browser (`@capacitor/browser`: Custom Tab / SFSafariViewController); a `.pkpass`
  goes to the Wallet sheet; downloads (vCard, iCalendar, CSV, PDF) are fetched with the page's
  cookie, written to the app cache (`@capacitor/filesystem`) and handed to the share sheet
  (`@capacitor/share`). Catch programmatic clicks with a wrapper on
  `HTMLAnchorElement.prototype.click` and start the fetch before any `await` so a revoked `blob:`
  is still readable.
- **Android back button:** close an open sheet, else go back, else go to the launcher, and leave
  the app only from the launcher.
- **Safe areas:** `viewport-fit=cover` and `env(safe-area-inset-*)` in the CSS; Capacitor's
  SystemBars `insetsHandling: 'native'`.

### One app for every tenant: codes and a launcher

The app starts at a launcher page (`/app/`) with three ways in: type a short code, scan a QR
code (poster, email, slide), or pick a tenant/space opened before on this device.

- **Codes:** 4 to 12 upper-case letters and digits, unique across the platform by a normalised key
  (0/O and 1/I/L folded together), generated from the name, editable and regenerable by the
  tenant's admin, a warning that the old code stops at once.
- **Lookup endpoint:** public, case and spacing insensitive, the same bare 404 for a bad shape, an
  unknown code and an unpublished space; rate limited per IP (60/min was enough).
- **What a scan may open:** only a public entry page on your own hosts; strip the fragment and any
  token after the slug, so a QR code never smuggles a sign-in or a private deep path. Recognise
  your own non-link codes (tickets, badges) and say what they are instead of opening them.
- **Recent list** in local storage (newest first, capped), editable by the user; signing out or
  removing an entry also removes what was pushed to a watch.
- A printable poster per space with its QR code and code ("Get the app and enter code ABC26").
- The launcher is in the main bundle so it opens offline.

### Offline (PWA part)

- Service worker scoped to the app path: hashed bundle files cache-first; pages and the user's
  key data (tickets, agenda, profile) network-first with the cached copy as fallback, marked with
  a response header so the UI can say "saved copy from 10:42". Never cache `/api/` responses that
  are not meant for offline use.
- Images: own immutable media cache-first, others stale-while-revalidate, a cap (a few hundred)
  with oldest-first eviction, and a warm-up of the current space's images after activation.
- On a cache version bump, copy the user's own entries into the new cache before deleting the
  old one, or an update wipes the offline ticket.
- **iOS:** WKWebView runs service workers only for **App-Bound Domains**: list your hosts in
  `WKAppBoundDomains` in `Info.plist` and set `ios.limitsNavigationsToAppBoundDomains: true`.
  Without it, offline silently does not work in the iOS app.

### Deep links (App Links and Universal Links)

| | Android App Links | iOS Universal Links |
|---|---|---|
| File | `https://example.com/.well-known/assetlinks.json` | `https://example.com/.well-known/apple-app-site-association` (no extension) |
| Content | package name + SHA-256 fingerprints of **both** the upload key and Play's app signing key | `applinks` with `appIDs: ["<TEAM_ID>.com.example.app"]`, `components` for the app path, excluding paths that must stay in a browser (kiosk screens, file downloads, redirects) |
| App side | intent filter with `android:autoVerify="true"` per host | Associated Domains entitlement `applinks:example.com` (and `www.`) |
| Check | `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://example.com&relation=delegate_permission/common.handle_all_urls` | Apple's CDN fetches it; check `https://app-site-association.cdn-apple.com/a/v1/example.com` |

- **Serve both from the application** from settings (team id, bundle id, package, fingerprints),
  as `application/json`, HTTP 200 on the apex **and** `www`, with **no redirect** (exempt them
  from www/canonical-host redirects); 404 while unconfigured. Templates in
  [`templates/mobile/well-known/`](../templates/mobile/well-known/).
- Handle `appUrlOpen` and the launch URL (once per launch), accept only your own hosts and
  paths; a tapped notification uses the same path routing.

### Push

One delivery queue for Web Push, APNs and FCM, so preferences, quiet hours, retries and counts
are shared. Register the native token per user (and per tenant/space where that applies) with the
same sign-in as a browser subscription; forget it on sign-out.

- **APNs:** token-based auth with a `.p8` key (Certificates, Identifiers and Profiles > Keys,
  environment "Sandbox and Production"), an ES256 provider token renewed between 20 and 60 minutes
  (45 works), HTTP/2 to `api.push.apple.com` (sandbox `api.sandbox.push.apple.com`), `apns-topic`
  = bundle id. A development build's token is a sandbox token: on `BadDeviceToken` from production
  try the sandbox once and remember the environment per device. Prune on 410 / `Unregistered`.
- **FCM HTTP v1:** `POST https://fcm.googleapis.com/v1/projects/<PROJECT_ID>/messages:send` with an
  OAuth access token from a service account (scope
  `https://www.googleapis.com/auth/firebase.messaging`), kept until shortly before expiry. Prune on
  `UNREGISTERED` and `SENDER_ID_MISMATCH`. The legacy server-key API is gone.
- **Keys** (`.p8`, service account JSON) live in the vault, re-read periodically (no restart).
  Unconfigured platform: queue nothing for it and tell the app not to offer notifications.
- **Payload:** the least that is useful (title, one short line, the path a tap opens, a badge).
  APNs and FCM are not end-to-end encrypted and leave your data region; say so in the privacy
  notice. No ids, addresses or personal details.
- **Android without `google-services.json`:** `PushNotifications.register()` crashes the app.
  Ship a tiny native "is Firebase configured" plugin and ask before registering, so a build
  without Firebase still runs.
- Android 13+: `POST_NOTIFICATIONS` runtime permission and a named notification channel; a
  monochrome notification icon.

### Wallet passes

Do Wallet in the web product first (email and browser buttons); the app only hands the pass to
the platform.

- **Apple Wallet:** a `.pkpass` is a zip of `pass.json`, images, per-language `pass.strings`,
  `manifest.json` (SHA-1 of every file) and `signature`: a detached PKCS #7 signature of the
  manifest by the **Pass Type ID certificate** (`pass.com.example.tickets`), including Apple's
  **WWDR intermediate** and the signing time. Serve as `application/vnd.apple.pkpass`. For updates,
  implement the PassKit web service (device registration, serials changed since, latest pass with
  `Last-Modified`/304, log) and send an empty APNs push with the Pass Type ID certificate. In the
  iOS app, `PKAddPassesViewController` through a tiny custom plugin (no maintained package did it
  over Swift Package Manager); a WKWebView will not open a `.pkpass` link by itself.
- **Google Wallet:** an issuer account, a service account with access to it, a class and an object
  per pass, and an "Add to Google Wallet" link `https://pay.google.com/gp/v/save/<JWT>` (RS256,
  `typ: savetowallet`, `origins`). Keep objects in step with the REST API
  (`walletobjects.googleapis.com`, scope `wallet_object.issuer`). Generic passes need publishing
  access approved in the Google Pay & Wallet Console. On Android, hand the link to the system.
- Download URLs carry an unguessable token (e.g. the signed ticket code), never a sequential id.
- Credentials (Pass Type ID `.p12`, Google service account) are uploaded by an administrator into
  the vault; the database keeps only a hint (thumbprint, expiry).

### Apple Watch companion (optional)

- watchOS 10+ SwiftUI app embedded in the iPhone app ("Embed Watch Content"), plus a WidgetKit
  extension for complications and the Smart Stack. Logic in a local Swift package shared by the
  app and the widget, with XCTest tests.
- **Data:** the web app builds a small snapshot of what it already shows (next items, the QR
  code's modules pre-computed, since watchOS has no CoreImage QR generator), debounced, only in
  the iOS app; a plugin sends it with WatchConnectivity `updateApplicationContext` (compressed;
  `transferFile` above ~60 kB) and keeps the last one for a watch that asks later. Nothing new
  goes to the server.
- **Storage on the watch:** a keychain access group shared by app and widget
  (`$(AppIdentifierPrefix)com.example.app.watch`, this device only). **Not an App Group:**
  automatic signing with an App Store Connect API key registers new identifiers but cannot attach
  an App Group to them, and the archive fails on the entitlement.
- A QR code on the watch: black on white, as large as possible, hidden with the wrist down
  (watchOS gives apps no brightness control and a dimmed code does not scan).
- Store screenshots from the Simulator in CI: a Debug-only launch argument loads sample data and
  a fixed clock (`-SampleSnapshot YES -SampleNow ... -Page ...`); Release ignores them. Save PNG
  without alpha.

## Versions used

Pin exact versions (no `^`); upgrade deliberately, one major at a time.

| Part | Version used |
|---|---|
| Capacitor core, cli, android, ios | 8.5.x |
| Plugins | app 8.1, app-launcher 8.0, browser 8.0, filesystem 8.1, push-notifications 8.1, share 8.0, splash-screen 8.0; `@capacitor/assets` 3.0 for icons and splash screens |
| Node | 22 (CI) |
| Android | JDK 21, compile/target SDK 36, Gradle wrapper from Capacitor's template |
| iOS | Xcode latest stable on `macos-15` runners, Swift Package Manager (no CocoaPods), watchOS 10 for the watch app |

Both stores raise their minimum SDK yearly (Play's target API level each August; Apple's minimum
Xcode/SDK each spring): check before each release.

## Project layout

```text
src/mobile/
  capacitor.config.ts   app id, name, server URL (from an env var at sync time), allowed hosts, plugins
  package.json          Capacitor and plugins, exact versions
  assets/               icon and splash sources; @capacitor/assets renders every size
  www/                  the offline page only (remote app), in every language
  scripts/              write the server URL for the offline page, icon generation, CI helpers
  android/              Gradle project, committed
  ios/App/              Xcode project (SPM), committed; Watch/, WatchWidgets/, WatchCore/ when used
src/web/app/src/native*.ts   the web side: detection, links, push, watch sync
```

- `npx cap sync` after any change to the config or a plugin. The server URL is read at sync time
  from an env var; `https` is enforced except for private addresses (`http://10.0.2.2:5080/app/`
  from the Android emulator to a laptop).
- `allowNavigation` lists your hosts only; everything else leaves the WebView.
- WebView debugging (`webContentsDebuggingEnabled`) only when an env var says so; never in a
  store build.
- Keep `src/mobile` out of the server's container image (`.dockerignore`).

## CI/CD for both stores

One workflow ([`templates/mobile/workflows/mobile.yml`](../templates/mobile/workflows/mobile.yml)),
run by hand (platforms, version, server URL, upload on/off) or on a tag `mobile-v1.2.3`:

- **Version** = tag or input or `package.json`, validated as `x.y.z`; **build number** = the
  workflow run number, so every run is newer than the last.
- **Android** (`ubuntu-24.04`): decode the upload keystore and `google-services.json` from secrets
  into `$RUNNER_TEMP`, `cap sync android`, `./gradlew bundleRelease` with AGP's injected signing
  properties and `-PversionCode/-PversionName`, delete the key files in an `if: always()` step,
  keep the `.aab` as an artifact, upload to Play's **internal** track with a service account.
- **iOS** (`macos-15`): decode the App Store Connect API key, `cap sync ios`, `xcodebuild archive`
  with `-allowProvisioningUpdates` and the `-authenticationKey*` flags (automatic signing, no
  certificates or profiles in secrets), check the watch app is inside the archive, `-exportArchive`
  with `method: app-store-connect` and `destination: upload` to TestFlight, then **revoke the
  development certificate the run created** and delete the key.
- **Watch job** (optional): watchOS Simulator tests and screenshots, nothing signed.
- Pin every action by commit SHA (with the version in a comment), pass inputs through `env`, never
  interpolate them into scripts; `permissions: contents: read`.

### Secrets (names only)

| GitHub secret | What |
|---|---|
| `ANDROID_UPLOAD_KEYSTORE_BASE64` | Upload key keystore (`.jks`), base64 |
| `ANDROID_UPLOAD_KEYSTORE_PASSWORD` | Its store password |
| `ANDROID_UPLOAD_KEY_ALIAS` | Key alias |
| `ANDROID_UPLOAD_KEY_PASSWORD` | Key password |
| `ANDROID_GOOGLE_SERVICES_JSON_BASE64` | Firebase `google-services.json`, base64 (optional: without it, no push) |
| `PLAY_SERVICE_ACCOUNT_JSON` | Google Cloud service account JSON with "Release to testing tracks" on the app |
| `APPLE_TEAM_ID` | Team ID |
| `APP_STORE_CONNECT_KEY_ID` | API key id |
| `APP_STORE_CONNECT_ISSUER_ID` | Issuer id |
| `APP_STORE_CONNECT_KEY_P8_BASE64` | API key `.p8`, base64 |

Server-side (vault, not GitHub): the APNs `.p8` and its key id, the FCM service account JSON,
the Pass Type ID certificate and the Google Wallet service account; app settings for team id,
bundle id, package name and the two Android certificate fingerprints.

Base64 on Windows: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("upload.jks")) | Set-Clipboard`;
macOS/Linux: `base64 -i upload.jks` / `base64 -w0 upload.jks`.

### The development certificate step, and why

On a fresh macOS runner the keychain is empty, so automatic signing makes a new "Apple
Development: Created via API" certificate for every archive. A team may hold only a small number
of development certificates; when the cap is reached (in practice after about ten CI runs)
**every** iOS build fails until someone revokes certificates by hand.
The certificate is only needed while archiving: the App Store export is re-signed with Apple's
cloud-managed distribution certificate. So the workflow lists the "Created via API" development
certificates before the archive and, in an `if: always()` step after the export, revokes only the
ones that appeared since, never a distribution, Pass Type ID or hand-made certificate
([`templates/mobile/scripts/dev-certificates.mjs`](../templates/mobile/scripts/dev-certificates.mjs)).
The alternative is importing one stored development certificate into the runner's keychain, which
adds a long-lived private key to the secrets.

## Signing and key storage

- **Nothing that signs is in the repository**: `.gitignore` covers `*.jks`, `*.keystore`,
  `keystore.properties`, `*.p8`, `*.p12`, `*.mobileprovision`, `google-services.json`,
  `GoogleService-Info.plist`. Keys live in the owner's password manager or a private repository
  (owner only) **and** as CI secrets / vault secrets. Agents never print, copy or commit them; a
  script reads a key file at runtime by path.
- **Android:** Play App Signing holds the real app signing key; you keep only the upload key
  (RSA 4096, validity 10000 days), which Google can reset if lost. Note both SHA-256 fingerprints
  for `assetlinks.json`.
- **Apple:** one App Store Connect API key with role **Admin** (automatic signing on a runner
  creates certificates and profiles, which needs Admin or "Access to Certificates, Identifiers and
  Profiles"); a **separate** APNs key; a Pass Type ID certificate for Wallet. The `.p8` downloads
  once only.
- Rotation and expiry dates in the owner's checklist (Pass Type ID certificates expire yearly).

## Store submission checklist

- [ ] App record: name, primary language, bundle id, SKU; Play: app, default language, free/paid.
- [ ] **First Play upload by hand** (an `.aab` from a run with upload off): the Play API refuses
      uploads for an app that has never had one.
- [ ] **Privacy:** App Store "App Privacy" and Play "Data safety" match reality: what the service
      collects (contact info, user content, the push token as device ID), purposes (app
      functionality), no tracking, encryption in transit, how deletion works. Privacy policy URL.
      iOS privacy manifest present for the required-reason APIs you and your plugins use.
- [ ] **Account/data deletion in the app** (App Store 5.1.1(v); Play's account deletion policy
      also wants a web link) when users can create an account or sign in: an in-app "Delete my
      data" that deletes or anonymises, confirmed with a fresh code, and says what is kept by law
      (invoices).
- [ ] **Guideline 4.2 (minimum functionality):** review notes that list what is native: push,
      deep links, Wallet, camera, offline, one app for many tenants. Reviewers judge the
      experience, not the stack; if rejected, add native surface rather than argue.
- [ ] **Review notes with a demo:** a demo code and a demo account (or an address whose sign-in
      code the reviewer can receive), and what to try.
- [ ] Export compliance: `ITSAppUsesNonExemptEncryption` = false when you only use HTTPS.
- [ ] Permission texts (camera, notifications) in every configured language (`InfoPlist.strings`
      per `.lproj`, `CFBundleLocalizations`, the project's known regions).
- [ ] **Screenshots per device class and language:** iPhone 6.9" (and 6.5"), iPad 13" if the app
      runs on iPad, Apple Watch sizes if there is a watch app; Android phone and 7"/10" tablet.
      Made from demo data, automated (Playwright for the web app at the right viewport, Simulator
      scripts for the watch); one set per language in the store listing.
- [ ] Listing text per language (name, subtitle, keywords within the character limits,
      description, promotional text), age rating questionnaire (moderated user content), category,
      support and marketing URLs.
- [ ] TestFlight: internal testers first; the first build for external testers needs Beta App
      Review. Play: internal track, then closed testing (see Lessons), then production.
- [ ] Release mode chosen (automatic after approval or manual), What's new text per language.

## Testing

- **Web first:** Playwright at phone width with a **stubbed native bridge** (`window.Capacitor`
  with fake plugins) covers link routing, push registration calls, downloads to the share sheet,
  the launcher and "switch" behaviour. Unit-test pure parts (link decisions, code normalisation,
  snapshot builders, wallet rules per user agent: WKWebView has no "Safari" in its UA).
- **Android emulator** (Windows: Hyper-V/WHPX) with a debug build against a laptop
  (`http://10.0.2.2:<port>/app/`, debug flag on, `chrome://inspect`). Hardware scanner intents can
  be simulated with `adb shell am broadcast`. App Links verification needs the deployed files.
- **iOS:** without a Mac, CI is the only compiler: watch the first archive closely; Simulator
  jobs for tests and screenshots. With a Mac: Safari's Develop menu for the WebView.
- **Real devices before release:** push on both platforms, Wallet add and update, the camera in
  the WebView, a deep link from mail, offline in airplane mode, a payment in the in-app browser,
  the watch on a real watch. Record what was not tried in STATE.md's Unproven table.

## Lessons learned

- **Apple's development certificate cap** stops all iOS builds; revoke the per-run certificate
  (above) from the first CI run, not after it bites.
- **Automatic signing needs one registered device** on the team before it can make a development
  profile; register any device once.
- **Play personal accounts** (created after 13 November 2023) need a closed test with **at least
  12 testers opted in continuously for 14 days** before production access can be requested
  (Google's current rule; check the Play Console Help page before planning). Use an organisation
  account to avoid it, or recruit testers early and add a margin.
- **Play's API refuses the first upload**: upload one `.aab` by hand.
- **Android App Links** need both fingerprints (upload key and Play app signing key), or links
  verify for sideloaded builds and fail for store installs.
- **iOS service workers** need App-Bound Domains, or offline fails only in the app.
- **App Groups** cannot be attached by API-key automatic signing; use a keychain access group.
- **A new language needs a new store build** for the native strings (`InfoPlist.strings`, watch
  string catalog, offline page), even though the web app updates instantly. Plan the store build
  into the language's release.
- **Firebase missing = crash** on `register()`; guard it.
- **Never-built native code:** a hand-edited Xcode project is unproven until CI archives it;
  parse it with the `xcode` npm package as a cheap check.
- **SwiftUI watch layout loops** (`TimelineView` around a `NavigationStack`/`TabView`) hang on the
  launch spinner; drive the clock with a timer instead.
- **Review risk 4.2** is real for a remote-URL shell: make the native features visible in the
  demo.

## Sources

- Capacitor: <https://capacitorjs.com/docs> (config, iOS App-Bound Domains, push notifications)
- Apple: App Review Guidelines (4.2, 4.3, 5.1.1(v)) <https://developer.apple.com/app-store/review/guidelines/>;
  token-based APNs <https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns>;
  Wallet passes <https://developer.apple.com/documentation/walletpasses>;
  Universal Links <https://developer.apple.com/documentation/xcode/supporting-associated-domains>;
  WatchConnectivity <https://developer.apple.com/documentation/watchconnectivity>
- Google: App Links verification <https://developer.android.com/training/app-links/verify-android-applinks>;
  FCM HTTP v1 <https://firebase.google.com/docs/cloud-messaging/migrate-v1>;
  Google Wallet <https://developers.google.com/wallet>;
  testing requirements for new personal accounts <https://support.google.com/googleplay/android-developer/answer/14151465>;
  account deletion <https://support.google.com/googleplay/android-developer/answer/13327111>
