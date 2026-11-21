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
 */
const model = (Platform.constants as { Model?: string }).Model
export const USER_AGENT = `${Constants.expoConfig?.name ?? "app"}/${APP_VERSION} (${
  Platform.OS === "ios" ? "iPhone; iOS" : "Android"
} ${Platform.Version}${model ? `; ${model}` : ""})`
