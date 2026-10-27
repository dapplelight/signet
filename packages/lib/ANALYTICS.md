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
app.use("/api/events", rateLimit({ scope: "ingest", max: 60 }))
```

```toml
# wrangler.toml
[[analytics_engine_datasets]]
binding = "ANALYTICS"
dataset = "app_events"
```

## Tier 3 — app-a and app-e

**Nothing.** Financial data, and you are the primary user. Sentry covers errors,
which is the part that actually matters. Not collecting is the feature.

## Things that bite

**Analytics Engine limits are enforced here because violating them makes writes
fail silently** — no error, no data. At most 20 blobs totalling 5120 bytes, 20
doubles, and one index of at most 96 bytes. `toDataPoint` truncates rather than
letting a write vanish.

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
