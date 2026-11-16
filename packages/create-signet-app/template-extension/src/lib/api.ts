import { createApiClient } from "@dapplelight/signet-lib/api"
import { API_BASE } from "../config"
import { session } from "./auth"

/**
 * Bearer calls to your API from the popup or options page: no cookies, and one
 * retry with a refreshed token on a 401. Kept apart from auth.ts so the service
 * worker, which only signs in and out, does not bundle the client.
 */
export const api = createApiClient({
  baseUrl: API_BASE,
  credentials: "omit",
  token: session.token,
  refresh: session.refresh,
})
