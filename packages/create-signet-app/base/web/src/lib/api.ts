import { createRpcClient } from "@dapplelight/signet-lib/api"
// api:begin
import { hc } from "hono/client"
// Types only: no server code reaches the browser bundle.
import type { AppType } from "../../api/app.ts"
// api:end
import { hc } from "hono/client" // @!api

// api:begin
/**
 * The typed client for the API in api/. Paths, inputs and responses come from
 * the server's routes, so a renamed route or field fails typecheck here.
 * A 401 throws AuthError (main.tsx sends the user to /login), any other
 * failure an ApiError with the envelope's message.
 *
 *   const { user } = await (await api.account.me.$get()).json()
 */
export const api = createRpcClient(hc<AppType>, { baseUrl: "/" }).api
// api:end
// !api:begin
/**
 * The client for your API, which lives outside this project. Set VITE_API_URL
 * (e.g. in .env.local) to its origin; unset, it calls this origin. A 401
 * throws AuthError, any other failure an ApiError with the envelope's message.
 *
 * Calls are untyped until you give the client your API's type (an app
 * scaffolded with --api exports it); then a renamed route or field fails
 * typecheck here:
 *
 *   import type { AppType } from "<your api>/api/app.ts"
 *   export const api = createRpcClient(hc<AppType>, { baseUrl }).api
 */
const baseUrl = import.meta.env.VITE_API_URL ?? "/"
// biome-ignore lint/suspicious/noExplicitAny: untyped until it has your API's AppType (above)
export const api: any = (createRpcClient(hc, { baseUrl }) as any).api
// !api:end
// auth:begin

/** The signed-in user and their plan; shared by the shell and the pages. */ // @payments
/** The signed-in user; shared by the shell and the pages. */ // @!payments
export const meQuery = {
  queryKey: ["me"],
  queryFn: async () => (await api.account.me.$get()).json(),
}
// auth:end
// orgs:begin

/** The user's orgs with their role, for the switcher. */
export const orgsQuery = {
  queryKey: ["orgs"],
  queryFn: async () => (await api.orgs.$get()).json(),
}

/** The org this session is in (the switch cookie), with the caller's role, permissions and the roles on offer. */
export const currentOrgQuery = {
  queryKey: ["orgs", "current"],
  queryFn: async () => (await api.orgs.current.$get()).json(),
}

/** Switch org, then reload so no query from the old org survives. */
export async function switchOrg(orgId: string, to = "/") {
  await api.orgs.switch.$post({ json: { orgId } })
  window.location.assign(to)
}
// orgs:end

export { ApiError, AuthError } from "@dapplelight/signet-lib/api"
