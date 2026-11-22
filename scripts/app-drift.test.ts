import { strict as assert } from "node:assert"
import { type Entry, missed, SECURITY, semver } from "./app-drift.ts"
import { packages } from "./bump.ts"

const known = packages(new URL("..", import.meta.url).pathname)
const e = (heading: string, body: string, date: string): Entry => ({ heading, body, date })
const all = [
  e("### signet-server 0.4.0", "- clientIp trusts cf-connecting-ip: spoofing", ""),
  e("### signet-server 0.3.0", "- rate limit spoof", ""),
  e("### signet-server: new things", "- adds a CSRF middleware", "2026-06-02T00:00:00Z"),
  e("### signet-server: old csrf", "- csrf", "2026-05-01T00:00:00Z"),
  e("### signet-server: formatting", "- nothing to see", "2026-06-03T00:00:00Z"),
  e("### signet-ui: csrf", "- csrf", "2026-06-02T00:00:00Z"),
]
const got = missed(all, known, "server", "0.3.0", "0.4.0", "2026-06-01T00:00:00Z").map(
  (x) => x.heading,
)

assert.deepEqual(got, ["### signet-server 0.4.0", "### signet-server: new things"])
assert.equal(semver("^0.3.1"), "0.3.1")
assert.ok(SECURITY.test("Spoofing of the client IP"))
console.log("  PASS app-drift")
