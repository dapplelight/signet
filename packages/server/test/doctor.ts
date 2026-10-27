import { readFileSync } from "node:fs"
import { classesAfterMigrations, diagnose, stripJsonc } from "../src/doctor/check"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

const GOOD_CONFIG = `{
  // comment
  "main": "src/index.ts",
  "durable_objects": { "bindings": [{ "name": "RATE_LIMIT", "class_name": "RateLimitCounter" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["RateLimitCounter"] }], /* trailing */
}`
const GOOD_ENTRY = `export { RateLimitCounter } from "@dapplelight/signet-server/middleware/rate-limit-do"
export default app`
const USES = `rateLimit({ store: (c) => durableObjectStore(c.env.RATE_LIMIT) })`
const errors = (i: Parameters<typeof diagnose>[0]) => diagnose(i).filter((f) => f.level === "error")

ok(
  "JSONC: comments and trailing commas stripped",
  JSON.parse(stripJsonc(GOOD_CONFIG)).main === "src/index.ts",
)
ok(
  "JSONC: // inside a string survives",
  JSON.parse(stripJsonc('{"u": "https://x.dev//a"}')).u === "https://x.dev//a",
)
ok(
  "migrations replay: rename then delete",
  (() => {
    const s = classesAfterMigrations([
      { new_classes: ["A"] },
      { renamed_classes: [{ from: "A", to: "B" }] },
      { new_sqlite_classes: ["C"], deleted_classes: ["B"] },
    ])
    return !s.has("A") && !s.has("B") && s.has("C")
  })(),
)

ok(
  "not using durableObjectStore: nothing to check",
  diagnose({ wranglerConfig: null, entrySource: null, appSource: "x" })[0]?.level === "ok",
)
ok(
  "correct setup: no errors",
  errors({ wranglerConfig: GOOD_CONFIG, entrySource: GOOD_ENTRY, appSource: USES }).length === 0,
)

const noBinding = errors({
  wranglerConfig: GOOD_CONFIG.replace(/"durable_objects".*\n/, ""),
  entrySource: GOOD_ENTRY,
  appSource: USES,
})
ok(
  "(a) missing binding named, with snippet using the code's name",
  noBinding.some((f) => f.fix?.includes('"name": "RATE_LIMIT"')),
)

const renamed = errors({
  wranglerConfig: GOOD_CONFIG,
  entrySource: GOOD_ENTRY,
  appSource: USES.replace("RATE_LIMIT", "LIMITER"),
})
ok(
  "(a) code reads a different binding name",
  renamed.some((f) => f.message.includes("c.env.LIMITER")),
)

const noMigration = errors({
  wranglerConfig: GOOD_CONFIG.replace(
    '"new_sqlite_classes": ["RateLimitCounter"]',
    '"new_classes": ["Other"]',
  ),
  entrySource: GOOD_ENTRY,
  appSource: USES,
})
ok(
  "(b) missing migration, next tag v2",
  noMigration.some(
    (f) =>
      f.fix?.includes('"tag": "v2"') &&
      f.fix.includes('"new_sqlite_classes": ["RateLimitCounter"]'),
  ),
)

const swap = errors({
  wranglerConfig: `{ "main": "src/index.ts",
    "durable_objects": { "bindings": [{ "name": "RATE_LIMIT", "class_name": "RateLimitCounter" }] },
    "migrations": [{ "tag": "v1", "new_classes": ["DurableObjectRateLimiter"] }, { "tag": "v2", "new_classes": ["Other"] }] }`,
  entrySource: GOOD_ENTRY,
  appSource: USES,
})
ok(
  "(b) hono-rate-limiter swap: new + deleted in v3",
  swap.some(
    (f) =>
      f.fix?.includes('"tag": "v3"') &&
      f.fix.includes('"deleted_classes": ["DurableObjectRateLimiter"]'),
  ),
)

const noExport = errors({
  wranglerConfig: GOOD_CONFIG,
  entrySource: "export default app",
  appSource: USES,
})
ok(
  "(c) class not exported, with the export line",
  noExport.some((f) => f.fix?.startsWith("export { RateLimitCounter }")),
)
ok(
  "(c) export class RateLimitCounter counts",
  errors({
    wranglerConfig: GOOD_CONFIG,
    entrySource: "export class RateLimitCounter {}",
    appSource: USES,
  }).length === 0,
)

const value = diagnose({
  wranglerConfig: GOOD_CONFIG,
  entrySource: `${GOOD_ENTRY}\nexport const VERSION = "1.2.3"\nexport const handler = makeHandler()`,
  appSource: USES,
})
ok(
  "(d) string constant export is an error",
  value.some((f) => f.level === "error" && f.message.includes("VERSION")),
)
ok(
  "(d) a call is only a warning",
  value.some((f) => f.level === "warn" && f.message.includes("handler")),
)
ok(
  "(d) a Hono app export is a handler, not flagged",
  diagnose({
    wranglerConfig: GOOD_CONFIG,
    entrySource: `${GOOD_ENTRY}\nexport const app = new Hono<Env>()`,
    appSource: USES,
  }).every((f) => f.level === "ok"),
)

// The real scaffold template must pass its own doctor.
const tpl = new URL("../../create-signet-app/template-api/", import.meta.url).pathname
const tplFindings = diagnose({
  wranglerConfig: readFileSync(`${tpl}wrangler.jsonc`, "utf8"),
  entrySource: readFileSync(`${tpl}src/index.ts`, "utf8"),
  appSource: readFileSync(`${tpl}src/index.ts`, "utf8"),
})
ok(
  "create-signet-app's api template passes",
  tplFindings.every((f) => f.level === "ok"),
  JSON.stringify(tplFindings),
)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
