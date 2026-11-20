import Constants from "expo-constants"

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
