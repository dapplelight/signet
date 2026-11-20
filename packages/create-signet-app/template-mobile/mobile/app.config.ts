import type { ConfigContext, ExpoConfig } from "expo/config"

// Set after `eas init` (README, "Builds"): push tokens and over-the-air updates need it.
const projectId = process.env.EAS_PROJECT_ID
// Your site's domain, e.g. "app.example.com", once it serves the iOS and Android
// association files: then https links to it open the app (universal / app links).
const linkDomain = process.env.APP_LINK_DOMAIN
// Grey of the placeholder icon; change it with the icon.
const brand = "#4b5563"

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "__APP_NAME__",
  slug: "__APP_NAME__",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  // Deep links: __APP_ID__://devices opens the Devices tab.
  scheme: "__APP_ID__",
  userInterfaceStyle: "automatic",
  ios: {
    // A placeholder: use your own reverse domain before the first store build.
    bundleIdentifier: "com.example.__APP_ID__",
    supportsTablet: true,
    ...(linkDomain ? { associatedDomains: [`applinks:${linkDomain}`] } : {}),
  },
  android: {
    package: "com.example.__APP_ID__",
    adaptiveIcon: { foregroundImage: "./assets/adaptive-icon.png", backgroundColor: brand },
    ...(linkDomain
      ? {
          intentFilters: [
            {
              action: "VIEW",
              autoVerify: true,
              data: [{ scheme: "https", host: linkDomain }],
              category: ["BROWSABLE", "DEFAULT"],
            },
          ],
        }
      : {}),
  },
  plugins: [
    "expo-router",
    [
      "expo-splash-screen",
      {
        image: "./assets/splash-icon.png",
        imageWidth: 160,
        backgroundColor: "#ffffff",
        dark: { backgroundColor: "#111111" },
      },
    ],
    "expo-secure-store",
    "expo-sqlite",
    ["expo-notifications", { icon: "./assets/notification-icon.png", color: brand }],
  ],
  experiments: { typedRoutes: true },
  // An update only reaches builds of the same app version.
  runtimeVersion: { policy: "appVersion" },
  ...(projectId
    ? {
        updates: {
          url: `https://u.expo.dev/${projectId}`,
          checkAutomatically: "ON_LOAD",
          fallbackToCacheTimeout: 0,
        },
      }
    : {}),
  extra: {
    // The API the app talks to. Android's emulator reaches your machine at 10.0.2.2.
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000",
    // Where screen-view events go; unset, none are sent (README, "Analytics").
    analyticsUrl: process.env.EXPO_PUBLIC_ANALYTICS_URL,
    ...(projectId ? { eas: { projectId } } : {}),
  },
})
