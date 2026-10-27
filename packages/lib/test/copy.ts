import { ERROR_CODES, type ErrorCode } from "../src/api/codes"
import { DEFAULT_ERROR_COPY, type ErrorAction, type ErrorCopy, errorCopy } from "../src/api/copy"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

// Types already require an entry per code; this guards against `as` casts.
const keys = Object.keys(DEFAULT_ERROR_COPY)
const missing = ERROR_CODES.filter((c) => !keys.includes(c))
const extra = keys.filter((k) => !(ERROR_CODES as readonly string[]).includes(k))
ok("default copy for every ERROR_CODES member", missing.length === 0, missing.join())
ok("no copy for codes Signet never emits", extra.length === 0, extra.join())
ok(
  "every entry has title, detail, action",
  Object.values(DEFAULT_ERROR_COPY).every((c) => c.title && c.detail && c.action),
)
ok(
  "RATE_LIMITED says wait (pairs with retryAfter)",
  DEFAULT_ERROR_COPY.RATE_LIMITED.action === "wait",
)
ok(
  "401s offer sign-in",
  DEFAULT_ERROR_COPY.UNAUTHORIZED.action === "sign_in" &&
    DEFAULT_ERROR_COPY.invalid_token.action === "sign_in",
)

ok("errorCopy: known code", errorCopy("NOT_FOUND").title === "Not found")
ok(
  "errorCopy: unknown code falls back to INTERNAL_ERROR",
  errorCopy("NO_SUCH_CODE") === DEFAULT_ERROR_COPY.INTERNAL_ERROR,
)
ok("errorCopy: missing code falls back", errorCopy(undefined) === DEFAULT_ERROR_COPY.INTERNAL_ERROR)
ok(
  "errorCopy: prototype keys are not codes",
  errorCopy("toString") === DEFAULT_ERROR_COPY.INTERNAL_ERROR,
)

// The app pattern: spread defaults, override some, add app codes. `satisfies`
// makes a missing app code a compile error (checked by tsc on this file).
type AppErrorCode = "PROVIDER_UNAVAILABLE"
const COPY = {
  ...DEFAULT_ERROR_COPY,
  RATE_LIMITED: { title: "Easy there", detail: "Search again shortly.", action: "wait" },
  PROVIDER_UNAVAILABLE: {
    title: "Store unavailable",
    detail: "Try another store.",
    action: "go_back",
  },
} satisfies Record<ErrorCode | AppErrorCode, ErrorCopy>
ok("app override wins", errorCopy("RATE_LIMITED", COPY).title === "Easy there")
ok("app code resolves", errorCopy("PROVIDER_UNAVAILABLE", COPY).title === "Store unavailable")
ok("untouched default still there", errorCopy("NOT_FOUND", COPY) === DEFAULT_ERROR_COPY.NOT_FOUND)

// An app action beyond Signet's five, e.g. app-b's "new_search".
type AppAction = "new_search"
const WIDE = {
  ...DEFAULT_ERROR_COPY,
  PROVIDER_UNAVAILABLE: {
    title: "Store unavailable",
    detail: "Try another store.",
    action: "go_back",
  },
  RUN_NOT_FOUND: {
    title: "That search has expired",
    detail: "Start a new one.",
    action: "new_search",
  },
} satisfies Record<ErrorCode | AppErrorCode | "RUN_NOT_FOUND", ErrorCopy<ErrorAction | AppAction>>
const run = errorCopy("RUN_NOT_FOUND", WIDE)
const action: ErrorAction | AppAction = run.action
ok("app-defined action survives, typed", action === "new_search")
ok("defaults still fit the wider action type", errorCopy("RATE_LIMITED", WIDE).action === "wait")

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
