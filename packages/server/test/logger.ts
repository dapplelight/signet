import { readFileSync } from "node:fs"
import { Hono } from "hono"
import { requestId } from "../src/middleware/request-id"
import {
  createLogger,
  type LevelName,
  type Logger,
  redactFields,
} from "../src/observability/logger"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

/** A logger writing into an array, plus the parsed lines. */
function capture(opts: Parameters<typeof createLogger>[0] = {}) {
  const lines: string[] = []
  const levels: LevelName[] = []
  const log = createLogger({
    ...opts,
    write: (line, level) => {
      lines.push(line)
      levels.push(level)
    },
  })
  const parsed = () => lines.map((l) => JSON.parse(l) as Record<string, unknown>)
  return { log, lines, levels, parsed }
}

console.log("output format")
{
  const { log, lines, levels, parsed } = capture()
  log.info({ userId: "u1", n: 3 }, "hello")
  ok("one line per entry", lines.length === 1 && !lines[0]?.includes("\n"))
  const e = parsed()[0] ?? {}
  ok("level is the label", e.level === "info")
  ok("time is ISO 8601", typeof e.time === "string" && !Number.isNaN(Date.parse(e.time)))
  ok("msg", e.msg === "hello")
  ok("fields inline", e.userId === "u1" && e.n === 3)
  ok(
    "level, time, msg lead the line",
    Object.keys(e).slice(0, 3).join() === "level,time,msg",
    Object.keys(e).join(),
  )
  ok("write hears the level", levels[0] === "info")

  log.info("just a message")
  ok(
    "(msg) alone",
    parsed()[1]?.msg === "just a message" && Object.keys(parsed()[1] ?? {}).length === 3,
  )

  log.warn({ status: 404 })
  ok("(fields) alone has no msg", parsed()[2]?.status === 404 && !("msg" in (parsed()[2] ?? {})))

  log.info("run.completed", { runId: "r1" })
  ok(
    "(msg, fields), app-b's shape",
    parsed()[3]?.msg === "run.completed" && parsed()[3]?.runId === "r1",
  )

  log.info({ level: "fake", time: 0, msg: "fake" }, "real")
  const c = parsed()[4] ?? {}
  ok(
    "fields cannot overwrite level/time/msg",
    c.level === "info" && c.msg === "real" && c.time !== 0,
  )
}
{
  const { log, parsed } = capture({ base: { service: "api" }, messageKey: "event" })
  log.info("auth.disabled", { missing: ["X"] })
  const e = parsed()[0] ?? {}
  ok("base on every line", e.service === "api")
  ok("messageKey renames msg", e.event === "auth.disabled" && !("msg" in e))
}
{
  // The default write routes by console method: Workers Logs reads severity from it.
  const seen: string[] = []
  const orig = { log: console.log, warn: console.warn, error: console.error }
  console.log = () => seen.push("log")
  console.warn = () => seen.push("warn")
  console.error = () => seen.push("error")
  try {
    const log = createLogger({ level: "trace" })
    log.debug("d")
    log.info("i")
    log.warn("w")
    log.error("e")
    log.fatal("f")
  } finally {
    Object.assign(console, orig)
  }
  ok("default write: console by level", seen.join() === "log,log,warn,error,error", seen.join())
}

console.log("levels")
{
  const { log, parsed } = capture()
  log.trace("t")
  log.debug("d")
  log.info("i")
  log.error("e")
  ok(
    "default level info filters trace and debug",
    parsed()
      .map((e) => e.msg)
      .join() === "i,e",
  )
  ok("isLevelEnabled", !log.isLevelEnabled("debug") && log.isLevelEnabled("warn"))
  ok("level reads back", log.level === "info")

  log.level = "debug"
  log.debug("d2")
  ok("level lowered at runtime", parsed().at(-1)?.msg === "d2")

  log.level = "error"
  log.warn("w")
  ok("level raised at runtime", parsed().at(-1)?.msg === "d2")

  log.level = "silent"
  log.fatal("f")
  ok("silent writes nothing, not even fatal", parsed().at(-1)?.msg === "d2")

  // app-a: `if (cfEnv.LOG_LEVEL) logger.level = cfEnv.LOG_LEVEL`, a string.
  const cfEnv: Record<string, string> = { LOG_LEVEL: "warn" }
  if (cfEnv.LOG_LEVEL) log.level = cfEnv.LOG_LEVEL
  ok("a string from env assigns", log.level === "warn")

  let threw = false
  try {
    log.level = "verbose"
  } catch {
    threw = true
  }
  ok("an unknown level throws", threw && log.level === "warn")
  let threwCreate = false
  try {
    createLogger({ level: "loud" })
  } catch {
    threwCreate = true
  }
  ok("an unknown level at creation throws", threwCreate)
}

console.log("child")
{
  const { log, parsed } = capture({ base: { service: "api" } })
  const child = log.child({ reqId: "r1" })
  const grandchild = child.child({ userId: "u1", reqId: "r2" })
  child.info({ path: "/x" }, "hit")
  grandchild.info("deep")
  const [a, b] = parsed()
  ok(
    "child merges bindings over base",
    a?.service === "api" && a?.reqId === "r1" && a?.path === "/x",
  )
  ok(
    "grandchild merges and overrides",
    b?.service === "api" && b?.reqId === "r2" && b?.userId === "u1",
  )
  ok("parent unaffected by child bindings", (log.info("p"), !("reqId" in (parsed().at(-1) ?? {}))))
  child.info({ reqId: "call" }, "call wins")
  ok("call fields override bindings", parsed().at(-1)?.reqId === "call")

  log.level = "debug"
  child.debug("follows parent")
  ok("child follows a later parent level change", parsed().at(-1)?.msg === "follows parent")
  child.level = "error"
  child.warn("own level")
  log.warn("parent still warns")
  ok(
    "child's own level is independent",
    parsed().at(-1)?.msg === "parent still warns" && parsed().at(-2)?.msg !== "own level",
  )
  const quiet = log.child({ a: 1 }, { level: "silent" })
  quiet.error("x")
  ok("child({}, { level })", parsed().at(-1)?.msg === "parent still warns")
}

console.log("redaction")
{
  const { log, lines, parsed } = capture()
  log.info(
    {
      password: "hunter2",
      token: "tok-1",
      secret: "s3",
      authorization: "Bearer abc",
      cookie: "sid=1",
      apiKey: "key-A",
      api_key: "key-B",
      user: { profile: { Password: "hunter3", accessToken: "tok-2" }, name: "Asha" },
      headers: [{ "x-api-key": "key-C", "set-cookie": "sid=2" }],
      maxTokens: 512,
      tokens: 90,
    },
    "login",
  )
  const e = parsed()[0] as Record<string, any>
  ok(
    "top-level secrets redacted",
    ["password", "token", "secret", "authorization", "cookie", "apiKey", "api_key"].every(
      (k) => e[k] === "[redacted]",
    ),
  )
  ok("nested depth 3, any case", e.user.profile.Password === "[redacted]")
  ok("suffix match: accessToken", e.user.profile.accessToken === "[redacted]")
  ok(
    "inside arrays: x-api-key, set-cookie",
    e.headers[0]["x-api-key"] === "[redacted]" && e.headers[0]["set-cookie"] === "[redacted]",
  )
  ok("non-secrets kept", e.user.name === "Asha" && e.maxTokens === 512 && e.tokens === 90)
  ok(
    "no secret value anywhere in the line",
    !["hunter2", "hunter3", "tok-1", "tok-2", "s3", "abc", "sid=", "key-A", "key-B", "key-C"].some(
      (s) => lines[0]?.includes(s),
    ),
    lines[0],
  )

  log.child({ token: "bound-tok" }).info("child")
  ok("child bindings redacted", !lines[1]?.includes("bound-tok"))

  const headers = new Headers({ authorization: "Bearer hdr", "content-type": "text/plain" })
  log.info({ headers }, "headers")
  const h = parsed()[2]?.headers as Record<string, string>
  ok(
    "a Headers object is expanded and redacted",
    h?.authorization === "[redacted]" && h?.["content-type"] === "text/plain",
  )
  ok("  and its value is absent", !lines[2]?.includes("hdr"))
}
{
  const { log, parsed } = capture({ redact: ["email", "user.phone", "items.*.card"] })
  log.info({
    email: "a@x.io",
    contact: { EMAIL: "b@x.io" },
    user: { phone: "999", name: "A" },
    phone: "keep-top-level",
    items: [{ card: "4111", sku: "s" }],
    other: { user: { phone: "keep-elsewhere" } },
  })
  const e = parsed()[0] as Record<string, any>
  ok("redact: a name, any depth", e.email === "[redacted]" && e.contact.EMAIL === "[redacted]")
  ok("redact: a dotted path", e.user.phone === "[redacted]" && e.user.name === "A")
  ok(
    "redact: a path does not match elsewhere",
    e.phone === "keep-top-level" && e.other.user.phone === "keep-elsewhere",
  )
  ok("redact: * matches an array index", e.items[0].card === "[redacted]" && e.items[0].sku === "s")
  ok(
    "defaults still apply alongside",
    (log.info({ password: "p" }), parsed()[1]?.password === "[redacted]"),
  )
}

{
  const cleaned = redactFields(
    { job: "sync", auth: { apiKey: "k-9" }, err: new Error("x") },
    { production: true },
  )
  ok(
    "redactFields: same rules, for Sentry context",
    (cleaned.auth as any).apiKey === "[redacted]" &&
      cleaned.job === "sync" &&
      !("stack" in (cleaned.err as any)),
  )
}

console.log("errors")
{
  const { log, parsed } = capture()
  const err = Object.assign(new TypeError("bad input", { cause: new Error("root cause") }), {
    code: "E_BAD",
    token: "err-tok",
  })
  log.error({ err, householdId: "h1" }, "sync failed")
  const e = parsed()[0] as Record<string, any>
  ok(
    "error becomes { name, message, stack }",
    e.err.name === "TypeError" &&
      e.err.message === "bad input" &&
      typeof e.err.stack === "string" &&
      e.err.stack.includes("bad input"),
  )
  ok("cause serialised", e.err.cause?.message === "root cause")
  ok("own props kept, secrets redacted", e.err.code === "E_BAD" && e.err.token === "[redacted]")

  log.error(new Error("thrown"))
  const b = parsed()[1] as Record<string, any>
  ok(
    "(err) alone: under err, message as msg (pino)",
    b.err?.message === "thrown" && b.msg === "thrown",
  )
  log.warn(new Error("thrown2"), "context")
  ok("(err, msg)", parsed()[2]?.msg === "context")

  log.info({ nested: { list: [new RangeError("deep")] } })
  ok("errors at depth", (parsed()[3] as any).nested.list[0].name === "RangeError")
}
{
  const { log, parsed } = capture({ production: true })
  log.error({ err: new Error("prod", { cause: new Error("c") }) })
  const e = parsed()[0] as Record<string, any>
  ok(
    "production omits stack",
    e.err.message === "prod" && !("stack" in e.err) && !("stack" in e.err.cause),
  )
}

console.log("serialisation safety")
{
  const { log, lines, parsed } = capture()
  const a: Record<string, unknown> = { name: "a" }
  a.self = a
  const b: Record<string, unknown> = { a }
  a.b = b
  let threw = false
  try {
    log.info({ a }, "circular")
    const self: Record<string, unknown> = { x: 1 }
    self.self = self
    log.info(self)
  } catch {
    threw = true
  }
  ok("a circular object does not throw", !threw && lines.length === 2)
  const e = parsed()[0] as Record<string, any>
  ok("cycles become [Circular]", e.a.self === "[Circular]" && e.a.b.a === "[Circular]")
  ok(
    "a self-referencing fields object",
    (parsed()[1] as any).self === "[Circular]" && parsed()[1]?.x === 1,
  )

  const err = new Error("loop") as Error & { self?: unknown }
  err.self = err
  log.error({ err })
  ok("a circular error", (parsed()[2] as any).err.self === "[Circular]")

  const shared = { v: 1 }
  log.info({ one: shared, two: shared })
  ok("a shared (not circular) object is written twice", (parsed()[3] as any).two.v === 1)

  log.info({
    big: 10n ** 20n,
    when: new Date(0),
    fn: () => 1,
    set: new Set([1]),
    map: new Map([["k", 2]]),
  })
  const t = parsed()[4] as Record<string, any>
  ok(
    "bigint, Date, function, Set, Map",
    t.big === "100000000000000000000" &&
      t.when === "1970-01-01T00:00:00.000Z" &&
      !("fn" in t) &&
      t.set[0] === 1 &&
      t.map.k === 2,
  )

  const hostile = {
    get boom(): never {
      throw new Error("getter exploded")
    },
  }
  let threwHostile = false
  try {
    log.warn(hostile, "still logged")
  } catch {
    threwHostile = true
  }
  const h = parsed()[5] ?? {}
  ok(
    "a throwing getter still yields a line",
    !threwHostile && h.msg === "still logged" && String(h.logError).includes("getter exploded"),
  )
}

console.log("requestId integration")
{
  const { log, parsed } = capture()
  // The README's line, verbatim: this is the type-fit check.
  const app = new Hono<{ Variables: { reqId: string; logger: Logger } }>()
  app.use("*", requestId({ childLogger: (id) => log.child({ reqId: id }) }))
  app.get("/x", (c) => {
    c.get("logger").info({ path: c.req.path }, "handled")
    return c.text("ok")
  })
  const res = await app.request("/x", { headers: { "x-request-id": "req_abc123" } })
  const e = parsed()[0] ?? {}
  ok(
    "child logger carries the request id",
    e.reqId === "req_abc123" &&
      e.msg === "handled" &&
      res.headers.get("X-Request-Id") === "req_abc123",
  )
}

console.log("never reads env")
{
  const src = readFileSync(new URL("../src/observability/logger.ts", import.meta.url), "utf8")
  ok("no process.env or Bun.env in the module", !/process\.env|Bun\.env/.test(src))
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
