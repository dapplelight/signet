import { createApiClient } from "@dapplelight/signet-lib/api"

export const api = createApiClient({
  baseUrl: import.meta.env.VITE_API_BASE ?? "/api",
})

export { ApiError, AuthError } from "@dapplelight/signet-lib/api"
