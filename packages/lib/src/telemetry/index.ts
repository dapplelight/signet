/**
 * Opt-in usage stats for CLIs, desktop and Node and Bun apps (CLIs, desktop).
 * Its own import path so browser bundles never see `node:fs`. For web pages
 * use `@dapplelight/signet-lib/analytics`.
 *
 * What makes it safe to ship: the app declares every event and every field
 * it may send, up front. An event, field or value that is not declared is
 * dropped before anything is written or sent. Off until the person says yes;
 * DO_NOT_TRACK, `<APP>_TELEMETRY=off` and CI force it off. Every payload that
 * leaves is appended to a local log first. It never throws into the caller,
 * never retries, never waits longer than `timeoutMs`.
 *
 *   const t = createTelemetry({
 *     app: "mycli", version: "1.2.0", dir: join(homedir(), ".config", "mycli"),
 *     endpoint: "https://stats.example.workers.dev/events",
 *     events: { command_run: { name: ["init", "build"], ok: "boolean", ms: "int" } },
 *   })
 *   t.optIn()                                // after asking the person; Enter = no
 *   t.track("command_run", { name: "build", ok: true, ms: 420 })
 *   await t.flush()                          // at exit
 *
 * The POST body is `{ events: [...] }` in the shape of `signet-spec/analytics`,
 * so a Signet `registerIngest` route can receive it.
 */

import { randomUUID } from "node:crypto"
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"

/** One field: a list of allowed strings, a boolean, or a whole number from 0 to 1,000,000. */
export type FieldSpec = readonly string[] | "boolean" | "int"
export type EventSpec = Record<string, Record<string, FieldSpec>>
export type TelemetryEvent = {
  name: string
  anonymousId: string
  ts: number
  props: Record<string, string | number | boolean>
}

export type TelemetryConfig<E extends EventSpec> = {
  /** Short lowercase name; also the env switch: `<APP>_TELEMETRY=off`. */
  app: string
  version: string
  /** Folder for the id, the choice and the sent log. */
  dir: string
  /** Empty or missing: nothing is sent. Must be https (or localhost). */
  endpoint?: string
  events: E
  env?: Record<string, string | undefined>
  fetch?: typeof fetch
  now?: () => number
  timeoutMs?: number
}

const MAX_BATCH = 50
const MAX_QUEUE = 100

/** Why telemetry is off whatever the person chose, or undefined. */
export function forcedOff(
  app: string,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  if (env.DO_NOT_TRACK && env.DO_NOT_TRACK !== "0") return "DO_NOT_TRACK is set"
  const key = `${app.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_TELEMETRY`
  if (env[key] === "off") return `${key}=off`
  if (env.CI) return "CI is set"
  return undefined
}

const valid = (spec: FieldSpec, v: unknown): boolean =>
  spec === "boolean"
    ? typeof v === "boolean"
    : spec === "int"
      ? Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 1_000_000
      : typeof v === "string" && spec.includes(v)

/** The event as it may leave, or undefined if the name, a field or a value is not declared. Every declared field is optional; extras are refused. */
export function check<E extends EventSpec>(
  events: E,
  name: string,
  props: Record<string, unknown> = {},
): Record<string, string | number | boolean> | undefined {
  const fields = Object.hasOwn(events, name) ? events[name] : undefined
  if (!fields) return undefined
  const out: Record<string, string | number | boolean> = {}
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined) continue
    if (!Object.hasOwn(fields, k) || !valid(fields[k], v)) return undefined
    out[k] = v as string | number | boolean
  }
  return out
}

export function createTelemetry<E extends EventSpec>(cfg: TelemetryConfig<E>) {
  const env = cfg.env ?? process.env,
    now = cfg.now ?? Date.now,
    doFetch = cfg.fetch ?? fetch
  const choice = `${cfg.dir}/telemetry.json`,
    idFile = `${cfg.dir}/telemetry-id`,
    logFile = `${cfg.dir}/telemetry-sent.jsonl`
  const url = /^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(cfg.endpoint ?? "")
    ? (cfg.endpoint as string)
    : ""
  const queue: TelemetryEvent[] = []
  const os = ["darwin", "linux", "win32"].includes(process.platform) ? process.platform : "other"

  const enabled = (): boolean => {
    if (forcedOff(cfg.app, env)) return false
    try {
      return JSON.parse(readFileSync(choice, "utf8")).enabled === true
    } catch {
      return false
    }
  }
  const id = (create: boolean): string | undefined => {
    try {
      const have = existsSync(idFile) ? readFileSync(idFile, "utf8").trim() : ""
      if (/^[0-9a-f-]{36}$/.test(have)) return have
      if (!create) return undefined
      const made = randomUUID()
      mkdirSync(cfg.dir, { recursive: true })
      writeFileSync(idFile, `${made}\n`, { mode: 0o600 })
      return made
    } catch {
      return undefined
    }
  }
  const setEnabled = (on: boolean) => {
    mkdirSync(cfg.dir, { recursive: true })
    writeFileSync(choice, JSON.stringify({ enabled: on }), { mode: 0o600 })
    if (on) id(true)
    else queue.length = 0
  }

  return {
    /** Off until this is called. Call it only after the person said yes. */
    optIn: () => setEnabled(true),
    /** Stops sending and drops what is queued. */
    optOut: () => setEnabled(false),
    /** A new random id; what was sent under the old one is not linked to it. */
    resetId: (): string | undefined => {
      rmSync(idFile, { force: true })
      return id(true)
    },
    enabled,
    status: () => ({
      enabled: enabled(),
      forced: forcedOff(cfg.app, env),
      id: id(false),
      endpoint: url || undefined,
      log: logFile,
    }),
    /** Queue one event. Returns whether it was accepted: false when off or when anything in it is not declared. */
    track(name: keyof E & string, props?: Record<string, unknown>): boolean {
      try {
        if (!enabled()) return false
        const clean = check(cfg.events, name, props)
        const anon = id(true)
        if (!clean || !anon || queue.length >= MAX_QUEUE) return false
        queue.push({
          name,
          anonymousId: anon,
          ts: now(),
          props: { app: cfg.app, v: cfg.version, os, ...clean },
        })
        return true
      } catch {
        return false
      }
    },
    /** What the next flush would send, exactly. */
    pending: (): readonly TelemetryEvent[] => queue,
    /** The local log of everything that left this machine. */
    sentLog: (): string =>
      existsSync(logFile) ? readFileSync(logFile, "utf8").trimEnd() : "Nothing has been sent.",
    /** Send the queue: appended to the local log first, one try, never throws. Returns whether the server took it. */
    async flush(): Promise<boolean> {
      const batch = queue.splice(0, MAX_BATCH)
      try {
        if (!batch.length || !url || !enabled()) return false
        mkdirSync(cfg.dir, { recursive: true })
        appendFileSync(
          logFile,
          `${JSON.stringify({ at: new Date(now()).toISOString(), to: url, events: batch })}\n`,
        )
        const res = await doFetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ events: batch }),
          signal: AbortSignal.timeout(cfg.timeoutMs ?? 3000),
        })
        return res.ok
      } catch {
        return false
      }
    },
  }
}
