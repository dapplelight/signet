import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { check, createTelemetry, forcedOff } from "../src/telemetry"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

const events = { run: { cmd: ["init", "build"], ok: "boolean", ms: "int" } } as const
const calls: { url: string; body: any; signal?: AbortSignal | null }[] = []
const make = (
  env: Record<string, string | undefined> = {},
  endpoint: string | undefined = "https://s.example.dev/events",
) =>
  createTelemetry({
    app: "mycli",
    version: "1.0.0",
    dir: mkdtempSync(`${tmpdir()}/tele-`),
    endpoint,
    events,
    env,
    fetch: (async (u: string, i: RequestInit) => (
      calls.push({ url: u, body: JSON.parse(String(i.body)), signal: i.signal }),
      new Response("{}", { status: 202 })
    )) as unknown as typeof fetch,
  })

// off until yes
const t = make()
ok("off by default: track is refused", t.track("run", { cmd: "init" }) === false)
ok("off by default: no id made", t.status().id === undefined)
t.optIn()
ok("on after optIn", t.track("run", { cmd: "init", ok: true, ms: 12 }) === true)
ok("optIn makes an id", /^[0-9a-f-]{36}$/.test(t.status().id ?? ""))

// allowlist
ok("undeclared event dropped", t.track("nope" as never) === false)
ok("undeclared field dropped", t.track("run", { title: "secret" }) === false)
ok("value not in list dropped", t.track("run", { cmd: "rm -rf" }) === false)
ok("wrong type dropped", t.track("run", { ok: "yes" }) === false)
ok("negative int dropped", t.track("run", { ms: -1 }) === false)
ok("float dropped", t.track("run", { ms: 1.5 }) === false)
ok(
  "check keeps declared values",
  JSON.stringify(check(events, "run", { cmd: "build", ms: 3 })) === '{"cmd":"build","ms":3}',
)

// forced off
ok("DO_NOT_TRACK forces off", forcedOff("mycli", { DO_NOT_TRACK: "1" }) !== undefined)
ok("DO_NOT_TRACK=0 does not", forcedOff("mycli", { DO_NOT_TRACK: "0" }) === undefined)
ok("MYCLI_TELEMETRY=off forces off", forcedOff("mycli", { MYCLI_TELEMETRY: "off" }) !== undefined)
ok("CI forces off", forcedOff("mycli", { CI: "true" }) !== undefined)
const f = make({ CI: "1" })
f.optIn()
ok(
  "forced off beats a yes",
  f.track("run", { cmd: "init" }) === false && f.status().forced === "CI is set",
)

// flush
ok("flush sends", (await t.flush()) === true && calls.length === 1)
const body = calls[0].body.events
ok(
  "body is signet-spec shaped",
  Array.isArray(body) &&
    body[0].name === "run" &&
    typeof body[0].anonymousId === "string" &&
    typeof body[0].ts === "number",
)
ok(
  "base props app, v, os only",
  body[0].props.app === "mycli" && body[0].props.v === "1.0.0" && "os" in body[0].props,
)
ok("has a timeout", calls[0].signal instanceof AbortSignal)
ok("sent log written", t.sentLog().includes('"run"'))
ok("queue emptied", t.pending().length === 0 && (await t.flush()) === false)

// optOut and resetId
const before = t.status().id
t.track("run", { cmd: "build" })
t.optOut()
ok("optOut stops and clears queue", t.enabled() === false && t.pending().length === 0)
t.optIn()
const after = t.resetId()
ok("resetId makes a new id", !!after && after !== before)

// no endpoint, bad endpoint, failing fetch
const n = make({}, "")
n.optIn()
n.track("run", { cmd: "init" })
ok("no endpoint sends nothing", (await n.flush()) === false)
const h = make({}, "http://evil.example.com/e")
h.optIn()
h.track("run", { cmd: "init" })
ok(
  "plain http (not localhost) refused",
  (await h.flush()) === false && h.status().endpoint === undefined,
)
const boom = createTelemetry({
  app: "x",
  version: "1.0.0",
  dir: mkdtempSync(`${tmpdir()}/tele-`),
  endpoint: "https://a.dev/e",
  events,
  env: {},
  fetch: (async () => {
    throw new Error("net")
  }) as unknown as typeof fetch,
})
boom.optIn()
boom.track("run", { cmd: "init" })
ok("a throwing fetch never throws", (await boom.flush()) === false)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
