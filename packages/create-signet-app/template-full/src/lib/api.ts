import { createRpcClient } from "@dapplelight/signet-lib/api"
import { hc } from "hono/client"
// Types only: no server code reaches the browser bundle.
import type { AppType } from "../../api/app.ts"

/**
 * The typed client for the API in api/. Paths, inputs and responses come from
 * the server's routes, so a renamed route or field fails typecheck here.
 * A 401 throws AuthError (main.tsx sends the user to /login), any other
 * failure an ApiError with the envelope's message.
 *
 *   const { user } = await (await api.account.me.$get()).json()
 */
export const api = createRpcClient(hc<AppType>, { baseUrl: "/" }).api

/** The signed-in user and their plan; shared by the shell and the pages. */
export const meQuery = {
  queryKey: ["me"],
  queryFn: async () => (await api.account.me.$get()).json(),
}

export { ApiError, AuthError } from "@dapplelight/signet-lib/api"
