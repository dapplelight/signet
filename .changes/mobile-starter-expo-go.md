### create-signet-app: the mobile starter opens in Expo Go

- `start`, `android` and `ios` pass `--go`: `expo-dev-client` is installed, so a plain `expo start` stopped with "No development build installed" on a first run. `start:dev` opens the development build.
- The crypto polyfill no longer imports `expo-crypto` at the top: in an Expo Go build without the `ExpoCrypto` native module the app crashed at launch. It falls back to a Math.random id, used only for outbox and analytics ids.
