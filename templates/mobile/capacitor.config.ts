import type { CapacitorConfig } from '@capacitor/cli';

// ===========================================================================
// The store app: a Capacitor shell that loads the web app from the server,
// starting at the launcher, so a web release reaches phones without a store
// review. Replace com.example.app, Example and example.com.
//
// The address is read when `npm run sync` copies this into the native projects:
//
//   APP_SERVER_URL=https://example.com/app/          (the default)
//   APP_SERVER_URL=http://10.0.2.2:5080/app/         (a laptop, from the Android emulator)
//
// Plain http is allowed only for a private address. Hosts the WebView may
// navigate to are listed below; any other link leaves the app (the web app's
// native-links module decides where).
// ===========================================================================

const fallback = 'https://example.com/app/';
const serverUrl = (process.env.APP_SERVER_URL ?? '').trim() || fallback;
const server = new URL(serverUrl);
const local = /^(localhost|127\.0\.0\.1|10\.0\.2\.2|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(server.hostname);
if (server.protocol !== 'https:' && !local) throw new Error(`APP_SERVER_URL must be https outside a laptop: ${serverUrl}`);

const hosts = ['example.com', 'www.example.com'];
if (!hosts.includes(server.hostname)) hosts.push(server.hostname);

const debug = process.env.APP_DEBUG === '1';

const config: CapacitorConfig = {
  appId: 'com.example.app',
  appName: 'Example',
  // Shown only when the server cannot be reached (server.errorPath): the app itself is remote.
  webDir: 'www',
  // Lets server logs tell the app from a browser; the web app asks window.Capacitor, never the UA.
  appendUserAgent: 'ExampleApp/1',
  backgroundColor: '#ffffff',
  server: {
    url: server.href,
    cleartext: server.protocol === 'http:',
    allowNavigation: hosts,
    errorPath: 'offline.html'
  },
  android: {
    // chrome://inspect only for a debug sync, never in a store build.
    webContentsDebuggingEnabled: debug
  },
  ios: {
    // Info.plist WKAppBoundDomains must list the same hosts: WKWebView runs the service
    // worker (offline) only for app-bound domains.
    limitsNavigationsToAppBoundDomains: true,
    contentInset: 'never',
    webContentsDebuggingEnabled: debug
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: true,
      backgroundColor: '#ffffff',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP'
    },
    PushNotifications: {
      // Show a notification that arrives while the app is open on iOS.
      presentationOptions: ['badge', 'sound', 'alert']
    },
    SystemBars: {
      // The web app pads itself with env(safe-area-inset-*) and viewport-fit=cover.
      insetsHandling: 'native',
      initialViewportFitValueHint: 'cover'
    }
  }
};

export default config;
