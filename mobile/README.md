# EVAde mobile (Expo)

A native shell for the EVAde website. The app opens https://evade.health full screen in a WebView, so every
feature, sign-in and update comes from the live site. Links to other sites open in the system browser.

- Expo SDK 58 (React Native 0.88), `react-native-webview` 14.
- iOS bundle id / Android package: `health.evade.app`. URL scheme: `evade://` (`evade://journal` opens the journal).

## Test on your phone with Expo Go

1. Install **Expo Go** from the App Store or Google Play (a version that supports SDK 58; the current store version does).
2. On the laptop:

   ```bash
   cd mobile
   npm install
   npx expo start
   ```

3. Scan the QR code: iPhone with the Camera app, Android from inside Expo Go. The phone and laptop must be on the
   same Wi-Fi. If the network blocks devices from seeing each other (school, hotel, guest Wi-Fi), use
   `npx expo start --tunnel` instead (the first run offers to install `@expo/ngrok`).

Expo Go uses its own app name, icon and permission text; a store or development build uses ours from `app.json`.

### What to try

- **Sign in with the emailed code**: tap Sign in, enter your email on the Cloudflare page, and type the code from the
  email. This works inside the app on every phone.
- **AI companion � preview** (Journal tab): the app uses the website's companion and signed-in session.
- **Voice journal** (Journal tab, *Talk to EVAde*): the phone asks for the microphone once.
- **Selfie check-in** (Selfies tab, *Start camera*): the phone asks for the camera once.
- Light/dark toggle: the status bar and the strips above/below the page follow the site's theme.
- Android back button goes back in the site; pull down at the top to refresh on iPhone; no connection shows a
  retry screen.

## Point the app at your local dev servers

By default the app opens production. To test local changes on the phone, run the Worker and the web app so the
phone can reach them over Wi-Fi, then point the app at your laptop's LAN IP (Windows: `ipconfig`, the IPv4 address
of your Wi-Fi adapter, for example `192.168.1.20`). PowerShell:

```powershell
$ip = "192.168.1.20"   # your laptop's Wi-Fi IPv4 address

# 1. API Worker (cloud/worker), listening on the LAN. --var adds the LAN web origin without editing .dev.vars.
npx wrangler dev --ip 0.0.0.0 --port 8787 --local-upstream "${ip}:8787" --upstream-protocol http `
  --var "ALLOWED_ORIGINS:http://localhost:5180,http://${ip}:5180" --var "FRONTEND_URL:http://${ip}:5180"

# 2. Web app (EVAde), listening on the LAN (--host) and calling the Worker by LAN IP (overrides .env.local).
$env:VITE_API_URL = "http://${ip}:8787"; npx vite --host --port 5180

# 3. Expo (mobile)
$env:EXPO_PUBLIC_SITE_URL = "http://${ip}:5180"; npx expo start
```

`EXPO_PUBLIC_API_URL` is derived automatically (`https://api.<site host>` for HTTPS sites, port 8787 on the same
host for local ones); set it to override. Windows may ask to allow Node through the firewall the first time: allow
it on private networks.

Local limits: the local sign-in page offers the emailed code (shown on the page, no email is sent). The microphone and camera need HTTPS, so over plain `http://<LAN IP>` they are unavailable on the phone; test those
against production (or an HTTPS tunnel). Only private LAN addresses (10.x, 172.16-31.x, 192.168.x) are accepted, and
only with `DEV_LOGIN=true`, so production is unaffected.

## How the app relates to deployment

- **Site deploys update the app automatically.** The app is a shell around https://evade.health, so anything
  deployed with `node deploy/deploy.mjs` (web) or the `evade-api` Worker shows up in the app on next launch or
  refresh. No app release needed.
- **Native changes need a new build.** Changing `App.tsx`, `app.json`, icons, permissions or native packages needs a
  new store build through EAS (Expo Application Services):

  ```bash
  npm install -g eas-cli
  eas login
  eas build --platform android --profile production   # Play Store bundle (Google Play account: $25 one-time)
  eas build --platform ios --profile production       # App Store build (Apple Developer Program: $99/year)
  eas submit --platform android --profile production
  eas submit --platform ios --profile production
  ```

  `preview` builds an installable test app (Android APK / iOS ad hoc) without the stores; `development` builds a
  dev client. Before the first store build, make sure `ios.bundleIdentifier` / `android.package` (`health.evade.app`)
  are IDs you own, and run `eas init` to link the project.
- **Optional: EAS Update** (`npx expo install expo-updates`, then `eas update`) pushes JavaScript-only changes to
  the shell (for example `App.tsx`) to installed apps without a store review.

## Checks

```bash
npx tsc --noEmit          # types
npx expo install --check  # package versions match SDK 58
npx expo-doctor           # config and dependency health
npx expo export           # the JS bundle builds for iOS and Android
```

## Files

- `App.tsx`: the WebView shell (in-app vs external links, deep links, Android back, theme-matched status bar and
  safe areas, keyboard handling, camera/microphone settings, offline screen with retry)
- `src/config.ts`: site and API addresses and the hosts that stay inside the app
- `src/siteChrome.ts`: script that reports the page's edge colours so the status bar matches the site's theme
- `app.json`: app name, icons, splash, `evade://` scheme, camera/microphone permissions
- `eas.json`: build profiles (development, preview, production)
