/**
 * CORS. Requires `hono` as an optional peer.
 *
 * `origin` is a function so it is evaluated per request, after
 * `initRuntimeEnv()` has run. A module-scope read of the allowed origins is
 * unreliable on Workers, where vars are not in `process.env` at module load.
 */

import { cors } from "hono/cors"
import { getRuntimeEnv } from "../env/runtime.js"

export type CorsOptions = {
  /** Env var names holding allowed origins, e.g. ["WEB_URL", "ADMIN_URL"]. */
  originEnvKeys?: string[]
  /** Literal origins, added to whatever the env vars resolve to. */
  extraOrigins?: string[]
  /**
   * Local dev origins. Default Vite's 5173/5174, allowed only when APP_ENV (or
   * NODE_ENV) is local, development or test. Unset counts as production, so a
   * deploy that forgets the var never trusts localhost. Pass [] to disable.
   */
  devOrigins?: string[]
  /** Send cookies. Required for session auth. Default true. */
  credentials?: boolean
}

export function corsMiddleware(opts: CorsOptions = {}) {
  const devOrigins = opts.devOrigins ?? ["http://localhost:5173", "http://localhost:5174"]
  const isDev = (env: Record<string, string | undefined>) =>
    ["local", "development", "test"].includes(env.APP_ENV ?? env.NODE_ENV ?? "")

  return cors({
    origin: (origin) => {
      const env = getRuntimeEnv()
      const allowed = [
        ...(opts.originEnvKeys ?? []).map((k) => env[k] ?? ""),
        ...(opts.extraOrigins ?? []),
        ...(isDev(env) ? devOrigins : []),
      ].filter(Boolean)
      // Returning "" denies. Never reflect an arbitrary origin back with
      // credentials:true — that defeats the same-origin policy entirely.
      return allowed.includes(origin) ? origin : ""
    },
    credentials: opts.credentials ?? true,
  })
}
