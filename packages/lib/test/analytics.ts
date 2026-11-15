import {
  ANALYTICS_HEADERS,
  type AnalyticsEvent,
  beaconTransport,
  continueSession,
  createAnalytics,
} from "../src/analytics"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

let sent: AnalyticsEvent[][] = []
const transport = (e: AnalyticsEvent[]) => {
  sent.push(e)
}
const fresh = (extra = {}) => {
  sent = []
  return createAnalytics({ transport, batchSize: 3, ...extra })
}

// no-op by default — instrumentation must be safe before wiring
const noop = createAnalytics()
noop.track("x")
ok("no transport = no-op, nothing queued", noop.pending === 0)
ok(
  "no-op flush does not throw",
  (() => {
    noop.flush()
    return true
  })(),
)

// batching
let a = fresh()
a.track("one")
a.track("two")
ok("queues below batch size", a.pending === 2 && sent.length === 0)
a.track("three")
ok("flushes at batch size", sent.length === 1 && sent[0].length === 3)
ok("queue cleared after flush", a.pending === 0)

// timestamps are capture-time, not flush-time
a = fresh()
const before = Date.now()
a.track("e", { k: "v" })
a.flush()
ok("event carries name and props", sent[0][0].name === "e" && sent[0][0].props?.k === "v")
ok("timestamp set at track time", sent[0][0].ts >= before && sent[0][0].ts <= Date.now())

// manual flush of a partial batch
a = fresh()
a.track("only")
a.flush()
ok("manual flush sends partial batch", sent.length === 1 && sent[0].length === 1)
a.flush()
ok("empty flush sends nothing", sent.length === 1)

// a throwing transport must not break the app
const boom = createAnalytics({
  transport: () => {
    throw new Error("nope")
  },
  batchSize: 1,
})
ok(
  "throwing transport is swallowed",
  (() => {
    boom.track("x")
    return true
  })(),
)

// opt-out
a = fresh()
a.optOut()
a.track("after-optout")
ok("opted out drops events", a.pending === 0)
ok("isOptedOut reflects state", a.isOptedOut)
a.optIn()
a.track("after-optin")
ok("opt-in resumes", a.pending === 1)
a.optOut()
a.optIn()

// DNT
const dntSaved = navigator.doNotTrack
Object.defineProperty(navigator, "doNotTrack", { value: "1", configurable: true })
const dnt = createAnalytics({ transport, batchSize: 1 })
dnt.track("x")
ok("honours navigator.doNotTrack", dnt.pending === 0)
const ignoring = createAnalytics({ transport, batchSize: 5, respectDoNotTrack: false })
ignoring.track("x")
ok("respectDoNotTrack:false overrides", ignoring.pending === 1)
Object.defineProperty(navigator, "doNotTrack", { value: dntSaved, configurable: true })

// pageview helper
a = fresh()
a.pageview("/checkout")
a.flush()
ok(
  "pageview records path",
  sent[0][0].name === "pageview" && sent[0][0].props?.path === "/checkout",
)

// beacon transport prefers sendBeacon
let beaconCalls = 0
Object.defineProperty(navigator, "sendBeacon", {
  value: () => {
    beaconCalls++
    return true
  },
  configurable: true,
})
beaconTransport("/api/events")([{ name: "x", ts: 1 }])
ok("beaconTransport uses sendBeacon", beaconCalls === 1)

// sessions and identify
a = fresh({ batchSize: 10 })
a.track("one")
a.track("two")
a.flush()
const [e1, e2] = sent[0]
ok("events carry anonymous and session ids", !!e1.anonymousId && !!e1.sessionId)
ok("same visit, same ids", e1.anonymousId === e2.anonymousId && e1.sessionId === e2.sessionId)
ok("no userId before identify", e1.userId === undefined)
a.identify("user-7", { plan: "pro", email: "x@example.com" })
a.track("after")
a.flush()
const [ident, after] = sent[1]
ok(
  "identify sends $identify with the anonymous id",
  ident.name === "$identify" && ident.anonymousId === e1.anonymousId && ident.userId === "user-7",
)
ok("traits dropped unless allowlisted", Object.keys(ident.props ?? {}).length === 0)
ok("later events carry userId", after.userId === "user-7")
const withTraits = fresh({ traitKeys: ["plan"] })
withTraits.identify("u", { plan: "pro", email: "x@example.com" })
withTraits.flush()
ok(
  "allowlisted trait sent, others not",
  sent[0][0].props?.plan === "pro" && !("email" in (sent[0][0].props ?? {})),
)
const ctx = a.context
a.reset()
ok(
  "reset forgets user and ids",
  a.context.userId === undefined && a.context.anonymousId !== ctx.anonymousId,
)
ok(
  "headers carry the ids",
  a.headers()[ANALYTICS_HEADERS.sessionId] === a.context.sessionId &&
    a.headers()[ANALYTICS_HEADERS.anonymousId] === a.context.anonymousId,
)

const s0 = continueSession(null, 1000, 100)
ok("continueSession keeps an active session", continueSession(s0, 1050, 100).id === s0.id)
ok(
  "continueSession starts a new one after the timeout",
  continueSession(s0, 1100, 100).id !== s0.id,
)
ok("continueSession treats a clock jump back as new", continueSession(s0, 900, 100).id !== s0.id)

// consent first
const consentFirst = fresh({ requireConsent: true, optOutKey: "consent-test" })
consentFirst.track("x")
ok("requireConsent: nothing before optIn", consentFirst.pending === 0 && consentFirst.isOptedOut)
ok("requireConsent: no headers before optIn", Object.keys(consentFirst.headers()).length === 0)
consentFirst.optIn()
consentFirst.track("x")
ok("requireConsent: tracks after optIn", consentFirst.pending === 1)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
