/**
 * The mobile starter: an Expo app in mobile/ (template-mobile) beside its API
 * in server/ (the composed API half, as `--api` makes it). Two projects, not
 * one: Metro and React Native's toolchain (jest-expo, TypeScript 6) and the
 * Bun API (bun test, TypeScript 7) each keep their own dependencies.
 */

/** Expo SDK 58's versions, as `npx expo install` picks them (expo's bundledNativeModules.json). */
export const MOBILE_PKG = {
  main: "expo-router/entry",
  scripts: {
    start: "expo start",
    android: "expo start --android",
    ios: "expo start --ios",
    lint: "biome check .",
    format: "biome check --write .",
    typecheck: "tsc --noEmit",
    test: "jest",
  },
  dependencies: {
    "@dapplelight/signet-lib": "^0.4.2",
    "@dapplelight/signet-tokens": "^0.4.0",
    "@expo/vector-icons": "^15.0.2",
    "@tanstack/react-query": "^5.108.0",
    expo: "~58.0.26",
    "expo-constants": "~58.0.16",
    "expo-crypto": "~58.0.8",
    "expo-dev-client": "~58.0.21",
    "expo-linking": "~58.0.17",
    "expo-network": "~58.0.5",
    "expo-notifications": "~58.1.9",
    "expo-router": "~58.0.32",
    "expo-secure-store": "~58.0.3",
    "expo-splash-screen": "~58.0.14",
    "expo-sqlite": "~58.0.18",
    "expo-status-bar": "~58.0.5",
    "expo-system-ui": "~58.0.7",
    "expo-updates": "~58.0.22",
    react: "19.3.0",
    "react-native": "0.88.1",
    "react-native-safe-area-context": "~5.11.1",
    "react-native-screens": "~4.30.1",
  },
  devDependencies: {
    "@biomejs/biome": "^2.5.14",
    "@dapplelight/signet-config": "^0.2.2",
    "@react-native/jest-preset": "~0.88.1",
    "@testing-library/react-native": "^14.1.0",
    "@types/react": "~19.3.0",
    jest: "^30.5.2",
    "jest-expo": "~58.0.15",
    "test-renderer": "^1.3.1",
    typescript: "~6.0.3",
  },
}

/** Package managers the mobile starter is set up for; Expo needs a plain node_modules. */
export const MOBILE_PMS = ["bun", "npm"] as const
