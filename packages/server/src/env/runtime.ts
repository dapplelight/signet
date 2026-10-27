/**
 * Runtime environment access that works on both Workers and Node/Bun.
 *
 * Cloudflare Workers pass secrets and vars as the `env` argument to `fetch()`,
 * not in `process.env`, and top-level module code runs without them — during
 * deploy validation too. Any module-scope `process.env.FOO` read is therefore
 * unreliable on Workers. Call `initRuntimeEnv(env)` at the top of your fetch
 * handler and read through `getRuntimeEnv()` everywhere else.
 *
 * From app-a, which was the only product that had solved this.
 */

let _injected: Record<string, string | undefined> = {}

/** Call once per request, first thing in the Workers fetch handler. */
export function initRuntimeEnv(env: Record<string, unknown>): void {
  _injected = env as Record<string, string | undefined>
}

/**
 * Merged view: injected Workers bindings layered over process.env.
 *
 * Injected values win. app-a's version short-circuited to process.env whenever
 * Bun was present, which silently discarded injected values when running a
 * Worker locally under Bun — merging in both directions avoids that.
 */
export function getRuntimeEnv(): Record<string, string | undefined> {
  const base =
    typeof process !== "undefined" && process.env
      ? (process.env as Record<string, string | undefined>)
      : {}
  return { ...base, ..._injected }
}

/** Reset injected values. Tests only. */
export function resetRuntimeEnv(): void {
  _injected = {}
}
