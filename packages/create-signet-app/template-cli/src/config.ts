import { homedir } from "node:os"
import { join } from "node:path"

/** Where the API lives; `API_URL` overrides it, as does `--api-url`. */
export const DEFAULT_API_URL = "http://localhost:8787"
/** Must be a key in the server's `clientLoginRoutes({ clients })`. */
export const CLIENT_ID = "__APP_NAME__"
/** Where `clientLoginRoutes` is mounted, e.g. `app.route("/auth/client-login", ...)`. */
export const AUTH_PATH = "/auth/client-login"
/** An authenticated route that answers with the signed-in user; replace with yours. */
export const WHOAMI_PATH = "/api/me"

/** The OS config directory for this CLI: ~/Library/Application Support, %APPDATA% or $XDG_CONFIG_HOME. */
export function sessionPath(): string {
  const home = homedir()
  const base =
    process.platform === "darwin"
      ? join(home, "Library", "Application Support")
      : process.platform === "win32"
        ? (process.env.APPDATA ?? join(home, "AppData", "Roaming"))
        : (process.env.XDG_CONFIG_HOME ?? join(home, ".config"))
  return join(base, CLIENT_ID, "session.json")
}
