# Analytics

Two tiers, chosen because "analytics" is three different needs across the
portfolio and one tool for all of them means a heavyweight dependency serving
nine sites that needed a script tag.

## Tier 1 — invite, gift and marketing sites

Cloudflare Web Analytics. One script tag, free, no cookies, so no consent
banner and no bundle cost.

```html
<script defer src="https://static.cloudflareinsights.com/beacon.min.js"
        data-cf-beacon='{"token":"<token>"}'></script>
```

Right-sized for a site that exists for six weeks.

## Tier 2 — products wanting custom events

Cloudflare Analytics Engine. Data stays in your own account, queried with the
SQL API. No third party, no database to operate.

```ts
// client
import { createAnalytics, beaconTransport } from "@dapplelight/signet-lib/analytics"
export const analytics = createAnalytics({ transport: beaconTransport("/api/events") })
analytics.pageview()
analytics.track("rsvp_submitted", { guests: 4 })
```

```ts
// worker
import { createAnalyticsEngine } from "@dapplelight/signet-server/analytics/engine"
import { registerIngest, cloudflareEnrichment } from "@dapplelight/signet-server/analytics/ingest"

registerIngest(app, "/api/events", {
  engine: createAnalyticsEngine({ dataset: env.ANALYTICS }),
  enrich: cloudflareEnrichment,
})
app.use("/api/events", rateLimit({ scope: "ingest", max: 60, trust: "cloudflare" }))
```

```toml
# wrangler.toml
[[analytics_engine_datasets]]
binding = "ANALYTICS"
dataset = "app_events"
```

### Off Cloudflare: any `AnalyticsSink`

`registerIngest`'s `engine` takes any `AnalyticsSink` from
`@dapplelight/signet-server/analytics/sinks`. `createAnalyticsEngine` is one;
the others run anywhere fetch does:

| Sink | Use |
|---|---|
| `httpSink({ url, headers?, defer?, maxBatch? })` | batches events and POSTs `{ events }` as JSON to your collector, flushed after the response through a `Defer` |
| `memorySink()` | tests: every event lands in `.events` |
| `consoleSink()` | local dev: logs each event |

```ts
// Node/Bun: flushes in the background (processDefer is the default)
registerIngest(app, "/api/events", { engine: httpSink({ url: env.COLLECTOR_URL }) })
// Workers: make it per request and hand it waitUntil
app.post("/api/track", (c) => {
  const sink = httpSink({ url: c.env.COLLECTOR_URL, defer: waitUntilDefer(c.executionCtx) })
  sink.write([{ name: "signup" }])
  return c.body(null, 204)
})
```

A failed POST is reported to `onEvent` as `analytics.flush_failed` and the
batch is dropped, not retried: analytics never fails a request. Call
`await sink.flush()` before a process exits.

## Sessions and identify

Every event from `createAnalytics` carries a random `anonymousId` (one per
browser, in localStorage) and a `sessionId` (a new one after
`sessionTimeoutMs` of inactivity, default 30 minutes). Neither is derived
from anything about the person.

```ts
const analytics = createAnalytics({
  transport: beaconTransport("/api/events"),
  requireConsent: true,      // track nothing until analytics.optIn()
  traitKeys: ["plan"],       // the only trait identify() may send; default none
})
analytics.identify(user.id, { plan: "pro", email: user.email }) // email stays in the browser
analytics.reset()                                             // on sign-out: new ids, no user
api.post("/api/signup", body, { headers: analytics.headers() }) // lets server events join the visit
```

`identify` sends a `$identify` event; a store that understands it (below)
links the anonymous events before it to the user. `optOut()` forgets the ids
as well as stopping tracking. `continueSession(prev, now, timeoutMs)` is the
session rule as a pure function.

On the server, `registerIngest` keeps `anonymousId` and `sessionId` (short
id strings only) but **drops a client-sent `userId`**, since anyone can post
to the route claiming to be anyone. Give it the signed-in user instead:

```ts
registerIngest(app, "/api/events", { engine: store, userId: (c) => c.get("user")?.id })
```

For events the server records itself, `serverTracker` stamps the visit's ids
from the request headers:

```ts
import { analyticsContext, serverTracker } from "@dapplelight/signet-server/analytics/session"

const t = serverTracker(store, analyticsContext(c.req.raw.headers))
await t.identify(user.id)              // just signed up
await t.track("signup", { plan: "free" })
```

## Store events in your database

`@dapplelight/signet-db/analytics` stores events in a table of your own
database (D1, SQLite or Postgres) and answers questions over them. The store
is an `AnalyticsSink`, so `registerIngest` and `serverTracker` write to it.

```ts
import { analyticsEvents } from "@dapplelight/signet-db/columns/sqlite" // or /columns/pg
import { createAnalyticsStore } from "@dapplelight/signet-db/analytics"

export const events = analyticsEvents()  // in your schema; migrate as usual
const store = createAnalyticsStore(db, {
  table: events,
  retentionDays: 395,   // the default; null keeps everything
  privacy,              // createPrivacy(...): userIds only for people who consented
  purpose: "analytics", // the consent purpose checked, the default
})
await store.prune()     // from a daily cron: deletes events older than retentionDays
```

With `privacy`, an event's `userId` is kept only if that person has consented
to `purpose`; otherwise the event is stored anonymously and `$identify` is
not stored or linked. Booleans in props are stored as `"true"`/`"false"` so
filters compare the same way in every dialect. `analytics_events` has a
`user_id` column, so add it to privacy's `userTables` and an erasure request
removes a person's events too.

## Ask questions

All take `from` / `to` (Date or epoch ms; default the last 7 days, `to`
exclusive). Values are bound parameters; property names must be plain names
(`[A-Za-z_][A-Za-z0-9_]*`) or the call throws `BAD_INPUT`. A person is
`userId`, else `anonymousId`.

| Call | Answers |
|---|---|
| `count({ event?, where? })` | how many events |
| `uniques({ event?, by: "person" \| "session" })` | how many people or visits |
| `series({ event?, bucket: "hour" \| "day" \| "week", unique?, utcOffsetMinutes? })` | `{ start, value }[]`, empty buckets as 0, weeks from Monday |
| `breakdown({ event?, property, limit?, unique? })` | `{ value, count }[]`, most first |
| `funnel({ steps, withinMs? })` | people reaching each step in order: `{ event, count, rate }[]` |
| `retention({ startEvent, returnEvent?, bucket: "day" \| "week", periods? })` | cohorts: `{ cohort, size, returned[] }[]` |
| `trend({ event?, period: "day" \| "week" \| "month" \| ms, unique? })` | `{ current, previous, change }`, this period vs the last |
| `events()` | event names and counts |

`where: { plan: "pro", trial: true }` filters on props by equality.

`analyticsTools({ store })` exposes `list_events` and `query_analytics` to
agents. Both are read-only and return aggregates only, never a person's
events, but they cover every user: mount them on a staff MCP server.

## Answers, not dashboards

A screen should lead with the answer, not a chart to interpret.
`@dapplelight/signet-ui/components/metric-headline` turns a trend into one
sentence, its number and an arrow:

```tsx
import { MetricHeadline } from "@dapplelight/signet-ui/components/metric-headline"

const signups = await store.trend({ event: "signup", period: "week" })
<MetricHeadline result={signups} label="Signups" />           // 1,240 · Signups up 18% this week ↑ 18%
<MetricHeadline result={errors} label="Errors" goodWhen="down" period="today" />
```

Customise it at any level: token utilities only; every string through `copy`
(`up`, `down`, `flat`, `new`, `trend`, each a function, defaults in
`DEFAULT_METRIC_COPY`); `className`, `classNames` per part and `data-*`
(`data-direction="up|down|flat|new"`, `data-tone="good|warn|neutral"`); the
parts `MetricHeadlineRoot`, `MetricHeadlineValue`, `MetricHeadlineSentence`,
`MetricHeadlineTrend`; behaviour through `goodWhen`, `flatWithin` and
`format`, or `metricTrend` / `metricSentence` to render your own; and
`signet add metric-headline` copies the one file in. A bad trend is amber,
never red. Under the privacy mask the value and percentages are hidden. For
a sentence your app composes itself, use `answer-headline`.

## Tier 2b — CLIs and desktop apps (opt-in, allowlisted)

`@dapplelight/signet-lib/telemetry`, Node/Bun only (its own path, like `storage/file`).
For a program with no browser and no sign-in, where the person must know and
agree. The app declares every event and field it may send; anything else is
dropped before it is written or sent.

```ts
import { createTelemetry } from "@dapplelight/signet-lib/telemetry"

const t = createTelemetry({
  app: "mycli", version: "1.2.0", dir: join(homedir(), ".config", "mycli"),
  endpoint: "https://stats.example.workers.dev/events",
  events: { command_run: { name: ["init", "build"], ok: "boolean", ms: "int" } },
})
t.optIn()   // only after asking; Enter = no. optOut() undoes it.
t.track("command_run", { name: "build", ok: true, ms: 420 })
await t.flush() // at exit
```

A field is a list of allowed strings, `"boolean"`, or `"int"` (0 to 1,000,000):
no free text can be declared. Off until `optIn()`; `DO_NOT_TRACK`,
`<APP>_TELEMETRY=off` and `CI` force it off whatever was chosen. Every payload
is appended to `telemetry-sent.jsonl` before it is sent; one try, 3 s timeout,
never throws. The body is `{ events }` in the `signet-spec/analytics` shape, so
`registerIngest` can receive it. Ask the person in your setup flow and tell
them `optOut()` is there: that part is yours, the kit has no UI.

## Tier 3 — app-a and app-e

**Nothing.** Financial data, and you are the primary user. Sentry covers errors,
which is the part that actually matters. Not collecting is the feature.

## Things that bite

**Analytics Engine limits are enforced here because violating them makes writes
fail silently** — no error, no data. At most 20 blobs totalling 5120 bytes, 20
doubles, and one index of at most 96 bytes. `toDataPoint` truncates rather than
letting a write vanish.

**A client-sent `userId` is dropped by default.** The ingest route is public;
take the user from your session with `registerIngest`'s `userId` option.

**`track()` is a no-op without a transport.** Instrument first, decide where
events go later, or never. No product should import an analytics vendor.

**Opt-out works without `localStorage`.** The flag is held in memory and
persisted best-effort. The first version only persisted, so `optOut()` silently
did nothing under SSR, Bun, or Safari private mode — an opt-out that silently
fails is worse than none. Caught by the test suite.

**`sendBeacon`, not `fetch`.** A fetch on unload is routinely cancelled, losing
exactly the events that matter — the last thing someone did before leaving.
Flush is also bound to `visibilitychange`, which fires reliably on mobile where
`pagehide` often does not.

**The ingest route is public and unauthenticated by necessity.** It caps batch
size and name length itself rather than trusting the payload, applies server
enrichment *after* client props so a client cannot spoof `country`, and should
be rate limited.
