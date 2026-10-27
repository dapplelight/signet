/**
 * Validate environment once, lazily, against a Zod schema.
 * Requires `zod` as an optional peer.
 *
 * The laziness is the point. Cloudflare executes top-level module code during
 * deploy validation with no secrets injected, so validating at import time fails
 * the deploy of a perfectly good Worker. The returned object is a Proxy that
 * validates on first property access instead.
 *
 * Generalised from app-a's `lib/env.ts`.
 */

import type { z } from "zod"
import { getRuntimeEnv } from "./runtime.js"

export type CreateEnvOptions<T> = {
  /** Optional vars whose absence disables a feature. Warned about once. */
  optionalFeatures?: ReadonlyArray<readonly [keyof T & string, string]>
  /** Where warnings go. Default stderr. */
  warn?: (message: string) => void
  /** Override the source. Default `getRuntimeEnv()`. */
  source?: () => Record<string, string | undefined>
}

export function createEnv<T extends Record<string, unknown>>(
  schema: z.ZodType<T>,
  opts: CreateEnvOptions<T> = {},
): T {
  let cached: T | null = null

  const validate = (): T => {
    const result = schema.safeParse((opts.source ?? getRuntimeEnv)())
    if (!result.success) {
      const detail = result.error.issues
        .map((i) => `  ${i.path.join(".")}: ${i.message}`)
        .join("\n")
      throw new Error(`Invalid environment variables:\n${detail}`)
    }
    const warn =
      opts.warn ??
      ((m: string) => {
        if (typeof process !== "undefined" && process.stderr) process.stderr.write(`${m}\n`)
        else console.warn(m)
      })
    for (const [key, feature] of opts.optionalFeatures ?? []) {
      if (!result.data[key]) warn(`[warn] ${key} not set — ${feature} will be unavailable`)
    }
    return result.data
  }

  return new Proxy({} as T, {
    get(_t, key: string) {
      if (!cached) cached = validate()
      return cached[key as keyof T]
    },
    has(_t, key: string) {
      if (!cached) cached = validate()
      return key in (cached as object)
    },
    ownKeys() {
      if (!cached) cached = validate()
      return Reflect.ownKeys(cached as object)
    },
    getOwnPropertyDescriptor(_t, key) {
      if (!cached) cached = validate()
      return Reflect.getOwnPropertyDescriptor(cached as object, key)
    },
  })
}
