import { type AnalyticsEvent, beaconTransport, createAnalytics } from "../src/analytics"

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

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
