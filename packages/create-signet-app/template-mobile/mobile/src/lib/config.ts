import Constants from "expo-constants"
import { Platform } from "react-native"

/** What app.config.ts put in `extra`, read once. */
const extra = (Constants.expoConfig?.extra ?? {}) as {
  apiUrl?: string
  analyticsUrl?: string
  eas?: { projectId?: string }
}

/** The API's origin, from EXPO_PUBLIC_API_URL at build time. */
export const API_URL = (extra.apiUrl ?? "http://localhost:3000").replace(/\/$/, "")
export const ANALYTICS_URL = extra.analyticsUrl
export const EAS_PROJECT_ID = extra.eas?.projectId
export const APP_VERSION = Constants.expoConfig?.version ?? "0.0.0"

/**
 * Sent as User-Agent: the server names each session after it (the Devices
 * tab), and React Native's own is "okhttp/…" on Android, CFNetwork on iOS.
 * Header values must be printable ASCII (okhttp throws otherwise, failing every
 * request), and the app name is whatever the developer typed, so strip the rest.
 */
const model = (Platform.constants as { Model?: string }).Model
const ascii = (s: string) => s.replace(/[^\x20-\x7e]/g, "").trim()
export const USER_AGENT = `${ascii(Constants.expoConfig?.name ?? "") || "app"}/${ascii(APP_VERSION)} (${
  Platform.OS === "ios" ? "iPhone; iOS" : "Android"
} ${Platform.Version}${model && ascii(model) ? `; ${ascii(model)}` : ""})`
