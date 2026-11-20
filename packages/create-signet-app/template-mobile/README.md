# __APP_NAME__

An iOS and Android app on [Expo](https://expo.dev) and its API, on Signet.

```
mobile/   the Expo app: Expo Router, phone sign-in, tabs, push, offline writes
server/   the API: Hono on Bun with SQLite (its own README covers the API)
```

Two projects, each with its own `package.json`: React Native's toolchain and
the API's never share a dependency tree.

## Run it

In one terminal, the API (port 3000):

```sh
cd server
__PM_INSTALL__
__PM_RUN__ dev
```

In another, the app:

```sh
cd mobile
__PM_INSTALL__
__PM_RUN__ start
```

Press `i` for the iOS simulator or `a` for the Android emulator. Sign in with
any phone number: in development no text is sent, and the code is printed in
the API's terminal.

The app reaches the API at `EXPO_PUBLIC_API_URL`, `http://localhost:3000` by
default, which works on the iOS simulator. Elsewhere, point it at your machine:

```sh
EXPO_PUBLIC_API_URL=http://10.0.2.2:3000 __PM_RUN__ start        # Android emulator
EXPO_PUBLIC_API_URL=http://192.168.1.20:3000 __PM_RUN__ start    # a phone on your Wi-Fi
```

Expo Go runs everything here except push notifications, which need a
development build (below).

## What is in the app

- **Sign-in**: phone, then the code (`src/app/(auth)`). The API answers
  `POST /api/auth/verify?client_id=mobile` with a token pair instead of a cookie;
  the tokens live in the Keychain / Keystore (`expo-secure-store`) through
  `@dapplelight/signet-lib/session`, which refreshes the access token before it
  expires.
- **The auth gate** (`src/app/_layout.tsx`): signed in shows the tabs, signed out
  shows sign-in. A 401 that a refresh cannot fix clears the session, and the
  gate flips. Sign-out revokes the session on the API, drops the push token, and
  forgets cached data and queued writes.
- **Tabs** (`src/app/(app)`): Home (your name, saved offline if need be),
  Devices (the sample list and detail: where you are signed in, pull to refresh,
  loading, empty and error states, sign a device out) and Settings (theme,
  light or dark, notifications, sign out, the app's version).
- **Offline writes** (`src/lib/outbox.ts`): a write that cannot reach the API is
  queued (`@dapplelight/signet-lib/offline`) and sent when the network returns.
  Send each write with the `Idempotency-Key` it carries, so a retry is harmless.
- **Theme**: every colour and size comes from `@dapplelight/signet-tokens/native`.
  Light and dark follow the phone unless Settings overrides it. The default
  theme is in `src/lib/theme.tsx`.
- **Errors**: `ErrorBoundary` in `src/app/_layout.tsx` catches a screen that
  throws; API refusals show the server's message, everything else Signet's copy.

## Environment

The app reads these at build time (`app.config.ts`); put them in `mobile/.env`
for local runs, or in an EAS environment for builds.

| Variable | What |
|---|---|
| `EXPO_PUBLIC_API_URL` | The API's origin. Default `http://localhost:3000`. |
| `EXPO_PUBLIC_ANALYTICS_URL` | Where screen-view events are posted in batches. Unset: none are sent. |
| `EAS_PROJECT_ID` | Your Expo project, after `eas init`. Push tokens and updates need it. |
| `APP_LINK_DOMAIN` | Your site's domain, for universal links / app links. |

The API's are in `server/.env` (written with fresh secrets) and
`server/api/env.ts`. `EXPO_ACCESS_TOKEN` is the one the app adds.

## Deep links

The scheme is `__APP_ID__`: `__APP_ID__://devices` opens the Devices tab. To
open https links in the app, set `APP_LINK_DOMAIN` and serve the
`apple-app-site-association` and `assetlinks.json` files from that domain (see
Expo's "Universal links" and "Android App Links" guides).

## Builds (EAS)

```sh
__PM_X__ eas-cli login
__PM_X__ eas-cli init            # creates the project; put its id in EAS_PROJECT_ID
__PM_X__ eas-cli build --profile development --platform ios   # or android
```

`eas.json` has three profiles: `development` (a development build with the dev
client, for push and native debugging), `preview` (an internal build to share)
and `production` (store builds, version numbers kept by EAS). Change the
placeholder `com.example.__APP_ID__` identifier in `app.config.ts`, and the
icon and splash in `assets/`, before the first store build.

Updates: `expo-updates` checks for an update on launch. Publish one with
`__PM_X__ eas-cli update --channel production`; it reaches builds of the same app
version (`runtimeVersion` follows the version in `app.config.ts`).

## Push notifications

1. Make a development build (above); Expo Go cannot receive them.
2. Set `EAS_PROJECT_ID`. On Android, add your Firebase project's credentials
   with `eas credentials`; on iOS, EAS creates the push key when you build.
3. In the app: Settings, Turn on notifications. The app sends its Expo push
   token to `POST /api/mobile/push/token`.
4. Settings, Send a test notification: the API sends one through Expo's push
   service; tapping it opens Devices.

The API sends with `expoPushSender` from `@dapplelight/signet-server/notify/channels`
(`server/api/services.ts`). With the notifications part, any template with a
`push` variant reaches the phone. Turn on push security in your Expo project
and set `EXPO_ACCESS_TOKEN` on the API before you ship. A notification's `url`
must be one of the screens listed in `src/lib/push.ts` to be opened.

## Analytics

Every screen sends a `screen_view` event (`src/lib/analytics.ts`) when
`EXPO_PUBLIC_ANALYTICS_URL` is set. The API has no ingest route yet: add one
with `@dapplelight/signet-server/analytics`, or point the URL at your own.

## Checks

```sh
cd mobile && __PM_RUN__ lint && __PM_RUN__ typecheck && __PM_RUN__ test
cd server && __PM_RUN__ lint && __PM_RUN__ typecheck && __PM_RUN__ test
```

CI (`.github/workflows/ci.yml`) runs both.
