### create-signet-app (minor): mobile starter

- New `--starter mobile` (and "Mobile app" in the picker): an Expo Router app
  for iOS and Android in `mobile/` and its Bun API in `server/`. Phone sign-in
  with a token pair in the secure store and refresh, an auth gate that a 401
  signs out of, tabs (Home, a list and detail sample with pull to refresh and
  loading, empty and error states, Settings with theme, sign-out and version),
  an offline outbox flushed on reconnect, Expo push with deep links on tap,
  screen-view analytics, `eas.json` profiles and `expo-updates`. jest-expo and
  Testing Library tests, Biome through `signet-config`, one CI workflow for
  both projects. `--pm` takes `bun` or `npm`.
- New `mobile` part (API only): `?client_id=mobile` on sign-in returns tokens
  instead of a cookie, `/api/mobile/token` and `/api/mobile/revoke`, and the
  phone's Expo push token at `/api/mobile/push/token`.
