/**
 * TanStack Query defaults. Requires `@tanstack/react-query` as an optional peer.
 *
 * From app-a, the only product that had a considered retry policy. The important
 * part is that auth failures are never retried: retrying a 401 three times just
 * delays the redirect and fires three more requests at an expired session.
 */

import type { QueryClient } from "@tanstack/react-query"
import { ApiError, isAuthError } from "./errors.js"

export type QueryDefaultsOptions = {
  /** How long data stays fresh. Default 5 minutes. */
  staleTimeMs?: number
  /** Retries for a retryable failure. Default 2. */
  maxRetries?: number
  /**
   * Whether a failure is worth retrying at all. Default `isRetryable`: network
   * errors, 5xx, 408 and 429 — not a 4xx that fails identically every time.
   */
  shouldRetry?: (error: unknown) => boolean
}

/**
 * The default retry filter. A 400, 403, 404 or 422 is an answer, not a blip:
 * retrying it only delays the error the user needs to see. Auth failures are
 * never retried (a redirect is coming).
 */
export function isRetryable(error: unknown): boolean {
  if (isAuthError(error)) return false
  if (error instanceof ApiError) {
    return error.status >= 500 || error.status === 408 || error.status === 429
  }
  return true // a network failure, a timeout
}

export function queryDefaults(opts: QueryDefaultsOptions = {}) {
  return {
    queries: {
      staleTime: opts.staleTimeMs ?? 1000 * 60 * 5,
      retry: (failureCount: number, error: unknown) => {
        if (isAuthError(error)) return false
        if (!(opts.shouldRetry ?? isRetryable)(error)) return false
        return failureCount < (opts.maxRetries ?? 2)
      },
      // The server's Retry-After when it gave one (a 429), else 1s, 2s, 4s …
      // capped at 30s.
      retryDelay: (attempt: number, error?: unknown) =>
        error instanceof ApiError && error.retryAfter !== undefined
          ? Math.min(error.retryAfter * 1000, 30_000)
          : Math.min(1000 * 2 ** attempt, 30_000),
    },
    mutations: { retry: false },
  }
}

/**
 * Redirect once when any query or mutation fails with AuthError.
 *
 * Call after creating the client. Returns an unsubscribe function.
 * Guarded so a burst of parallel 401s triggers exactly one navigation.
 */
export function onAuthErrorRedirect(client: QueryClient, redirect: () => void): () => void {
  let fired = false
  const fire = () => {
    if (fired) return
    fired = true
    redirect()
  }

  const unsubQueries = client.getQueryCache().subscribe((event) => {
    if (event.type === "updated" && "action" in event) {
      const action = event.action as { type?: string; error?: unknown }
      if (action.type === "error" && isAuthError(action.error)) fire()
    }
  })

  const unsubMutations = client.getMutationCache().subscribe((event) => {
    if (event.type === "updated" && isAuthError(event.mutation?.state.error)) fire()
  })

  return () => {
    unsubQueries()
    unsubMutations()
  }
}
