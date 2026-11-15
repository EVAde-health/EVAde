# EVAde mobile (Expo)

A native shell for the EVAde website. The app opens https://evade.health full screen in a WebView,
so every feature, sign-in and update comes from the live site. Links to other sites open in the system browser.

## Run locally

```bash
npm install
npx expo start          # scan the QR code with Expo Go (iOS or Android)
```

To point the app at another address (for example a staging site), set `EXPO_PUBLIC_SITE_URL`:

```bash
EXPO_PUBLIC_SITE_URL=https://staging.evade.health npx expo start
```

## Build and submit with EAS

```bash
npm install -g eas-cli
eas login
eas build --platform android --profile production
eas build --platform ios --profile production     # needs an Apple Developer account
eas submit --platform android --profile production
eas submit --platform ios --profile production
```

Before the first store build, change `ios.bundleIdentifier` and `android.package` in `app.json` to IDs you own.

## Files

- `App.tsx` — the WebView shell (navigation rules, Android back button, error screen with retry)
- `src/config.ts` — site address and the hosts that stay inside the app (`evade.health`, `cloudflareaccess.com`)
- `app.json` — app name, icons, camera/microphone permissions
- `eas.json` — build profiles (development, preview, production)
