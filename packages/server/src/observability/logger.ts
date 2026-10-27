/**
 * Structured JSON logger with pino's call shape and redaction by default. Zero
 * dependencies — runs on Bun, Node and Cloudflare Workers, one JSON line per
 * entry through `console`.
 *
 * From app-a (pino) and app-b (a hand-rolled console logger). pino is
 * Node-flavoured: its pretty transport needs worker_threads, which app-a had to
 * mark external to deploy. Takes configuration; never reads env.
 */

/** pino's numeric ranks, so `isLevelEnabled` and ordering match it. */
export const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 } as const

export type LevelName = keyof typeof LEVELS
/** A level to filter at. `silent` writes nothing. */
export type LevelSetting = LevelName | "silent"

export type LogFields = Record<string, unknown>

export type LoggerOptions = {
  /**
   * Minimum level written. Default "info". Settable later via `logger.level`.
   * A plain string is accepted, so an env value passes straight in; an unknown
   * one throws.
   */
  level?: LevelSetting | (string & {})
  /** Fields on every line, e.g. `{ service: "api" }`. No pid or hostname. */
  base?: LogFields
  /**
   * More fields to redact, on top of the defaults (password, passwd, token,
   * secret, authorization, cookie, apiKey — matched case-, `_`- and `-`-
   * insensitively, as the whole key or its suffix, so `accessToken`,
   * `x-api-key` and `set-cookie` are covered and `maxTokens` is not).
   *
   * `"email"` redacts a key with that name at any depth. A dotted path,
   * `"user.email"` or `"headers.*.ip"`, redacts only there, from the top of the
   * line's fields; `*` matches one segment.
   */
  redact?: string[]
  /**
   * Receives each serialised line. Default: `console.error` for error and
   * fatal, `console.warn` for warn, `console.log` otherwise — Workers Logs and
   * `wrangler tail` derive severity from the console method.
   */
  write?: (line: string, level: LevelName) => void
  /** Drop `stack` from serialised errors. */
  production?: boolean
  /** Key the message is written under. Default "msg" (pino's). */
  messageKey?: string
}

/**
 * pino's shapes — `(fields, msg?)`, `(err, msg?)`, `(msg)` — plus
 * `(msg, fields)`, app-b's. printf interpolation (`%s`) is not
 * supported.
 */
export interface LogFn {
  (msg: string, fields?: LogFields): void
  (obj: object, msg?: string): void
}

export type Logger = {
  trace: LogFn
  debug: LogFn
  info: LogFn
  warn: LogFn
  error: LogFn
  fatal: LogFn
  /**
   * A logger whose lines carry `bindings` as well. It follows its parent's
   * level, including later changes, until given its own.
   */
  child(bindings: LogFields, opts?: { level?: LevelSetting }): Logger
  /** Throws on an unknown level. Accepts `string` so env values assign directly. */
  get level(): LevelSetting
  set level(value: string)
  isLevelEnabled(level: LevelName): boolean
}

const RANK: Record<LevelSetting, number> = { ...LEVELS, silent: Number.POSITIVE_INFINITY }

function checkLevel(value: string): LevelSetting {
  if (!Object.hasOwn(RANK, value)) {
    throw new Error(`Unknown log level "${value}"; expected one of ${Object.keys(RANK).join(", ")}`)
  }
  return value as LevelSetting
}

const REDACTED = "[redacted]"
const SECRET_KEYS = ["password", "passwd", "token", "secret", "authorization", "cookie", "apikey"]
const norm = (key: string) => key.toLowerCase().replace(/[-_]/g, "")

type Config = {
  write: (line: string, level: LevelName) => void
  production: boolean
  messageKey: string
  names: Set<string>
  paths: string[][]
}

function isRedacted(cfg: Config, key: string, path: string[]): boolean {
  const n = norm(key)
  if (SECRET_KEYS.some((w) => n === w || n.endsWith(w)) || cfg.names.has(n)) return true
  return cfg.paths.some(
    (p) => p.length === path.length && p.every((seg, i) => seg === "*" || seg === path[i]),
  )
}

/**
 * JSON-safe copy with secrets replaced, errors expanded, cycles cut and bigints
 * stringified. `stack` holds the current ancestors only, so an object reached
 * twice by different routes is written twice, not mistaken for a cycle.
 */
function clean(cfg: Config, value: unknown, path: string[], stack: object[]): unknown {
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "function" || typeof value === "symbol") return undefined
  if (value === null || typeof value !== "object") return value
  if (stack.includes(value)) return "[Circular]"
  stack.push(value)
  try {
    if (value instanceof Error) return cleanError(cfg, value, path, stack)
    if (Array.isArray(value)) return value.map((v, i) => clean(cfg, v, [...path, String(i)], stack))
    if (value instanceof Map) return cleanObject(cfg, Object.fromEntries(value), path, stack)
    if (value instanceof Set) return clean(cfg, [...value], path, stack)
    if (typeof Headers !== "undefined" && value instanceof Headers) {
      return cleanObject(cfg, Object.fromEntries(value.entries()), path, stack)
    }
    const toJSON = (value as { toJSON?: unknown }).toJSON
    if (typeof toJSON === "function") return clean(cfg, toJSON.call(value), path, stack)
    return cleanObject(cfg, value as LogFields, path, stack)
  } finally {
    stack.pop()
  }
}

function cleanObject(cfg: Config, obj: LogFields, path: string[], stack: object[]): LogFields {
  const out: LogFields = {}
  for (const key of Object.keys(obj)) {
    const at = [...path, key]
    out[key] = isRedacted(cfg, key, at) ? REDACTED : clean(cfg, obj[key], at, stack)
  }
  return out
}

function cleanError(cfg: Config, err: Error, path: string[], stack: object[]): LogFields {
  const out: LogFields = { name: err.name, message: err.message }
  if (!cfg.production && err.stack) out.stack = err.stack
  if (err.cause !== undefined) out.cause = clean(cfg, err.cause, [...path, "cause"], stack)
  // Own enumerable extras, e.g. `code` or `status`. Redacted like any field.
  for (const [key, v] of Object.entries(
    cleanObject(cfg, err as unknown as LogFields, path, stack),
  )) {
    if (!(key in out)) out[key] = v
  }
  return out
}

function defaultWrite(line: string, level: LevelName): void {
  if (LEVELS[level] >= LEVELS.error) console.error(line)
  else if (level === "warn") console.warn(line)
  else console.log(line)
}

function serialise(cfg: Config, level: LevelName, bindings: LogFields, args: unknown[]): string {
  const [first, second] = args
  let msg: string | undefined
  let fields: LogFields = {}
  if (typeof first === "string") {
    msg = first
    if (second && typeof second === "object") fields = second as LogFields
  } else if (first instanceof Error) {
    fields = { err: first }
    msg = typeof second === "string" ? second : first.message
  } else if (first && typeof first === "object") {
    fields = first as LogFields
    if (typeof second === "string") msg = second
  } else if (first !== undefined) {
    msg = String(first)
  }

  const time = new Date().toISOString()
  const entry: LogFields = { level, time }
  if (msg !== undefined) entry[cfg.messageKey] = msg
  try {
    // `fields` seeds the ancestors: the merged copy is new, so `fields.self =
    // fields` would otherwise be written out once before the cycle is caught.
    const rest = clean(cfg, { ...bindings, ...fields }, [], [fields]) as LogFields
    for (const [key, v] of Object.entries(rest)) {
      if (!Object.hasOwn(entry, key) && key !== "level" && key !== "time") entry[key] = v
    }
    return JSON.stringify(entry)
  } catch (e) {
    // A throwing getter or toJSON. The line still goes out, without its fields.
    return JSON.stringify({
      level,
      time,
      ...(msg !== undefined ? { [cfg.messageKey]: msg } : {}),
      logError: `fields could not be serialised: ${e instanceof Error ? e.message : String(e)}`,
    })
  }
}

function make(
  cfg: Config,
  bindings: LogFields,
  parentLevel: (() => LevelSetting) | null,
  own: LevelSetting | undefined,
): Logger {
  let ownLevel = own
  const current = (): LevelSetting => ownLevel ?? (parentLevel ? parentLevel() : "info")
  const enabled = (level: LevelName) => LEVELS[level] >= RANK[current()]
  const fn =
    (level: LevelName): LogFn =>
    (...args: unknown[]) => {
      if (enabled(level)) cfg.write(serialise(cfg, level, bindings, args), level)
    }
  return {
    trace: fn("trace"),
    debug: fn("debug"),
    info: fn("info"),
    warn: fn("warn"),
    error: fn("error"),
    fatal: fn("fatal"),
    child: (more, opts) =>
      make(
        cfg,
        { ...bindings, ...more },
        current,
        opts?.level === undefined ? undefined : checkLevel(opts.level),
      ),
    get level(): LevelSetting {
      return current()
    },
    set level(value: string) {
      ownLevel = checkLevel(value)
    },
    isLevelEnabled: enabled,
  }
}

function configure(opts: LoggerOptions): Config {
  const names = new Set<string>()
  const paths: string[][] = []
  for (const r of opts.redact ?? []) {
    if (r.includes(".")) paths.push(r.split("."))
    else names.add(norm(r))
  }
  return {
    write: opts.write ?? defaultWrite,
    production: opts.production ?? false,
    messageKey: opts.messageKey ?? "msg",
    names,
    paths,
  }
}

export function createLogger(opts: LoggerOptions = {}): Logger {
  return make(configure(opts), opts.base ?? {}, null, checkLevel(opts.level ?? "info"))
}

/**
 * The logger's field cleaning on its own: secrets redacted, errors expanded,
 * cycles cut. For context sent elsewhere, e.g. `createSentry`'s
 * `captureException(err, redactFields(ctx))`, which does not scrub context.
 */
export function redactFields(
  fields: LogFields,
  opts: Pick<LoggerOptions, "redact" | "production"> = {},
): LogFields {
  return clean(configure(opts), fields, [], []) as LogFields
}
