import { expect, test } from "bun:test"
import { memoryStore } from "@dapplelight/signet-server/middleware/rate-limit"
import { createApp } from "../src/app.ts"

// trust "cloudflare" is believed only on Workers (a Node or Bun origin can be hit
// directly, where a client sets cf-connecting-ip itself). The cloudflare target
// runs there, so pose as Workers here.
Object.defineProperty(navigator, "userAgent", { value: "Cloudflare-Workers", configurable: true })

// Requests that reach the app without cf-connecting-ip (a proxy that strips it,
// a health checker, a local call) all share one bucket. Once it is full, the
// next caller without the header is told to back off, whoever they are; callers
// with an address are untouched. onNoIp: "reject" or "allow" on rateLimit
// changes this.
test("60 requests without cf-connecting-ip fill the shared bucket; a bystander without it gets 429", async () => {
  const app = createApp({ store: memoryStore(), trust: "cloudflare" })
  for (let i = 0; i < 60; i++) expect((await app.request("/api/health")).status).toBe(200)
  expect((await app.request("/api/health")).status).toBe(429)
  const withIp = await app.request("/api/health", { headers: { "cf-connecting-ip": "203.0.113.9" } })
  expect(withIp.status).toBe(200)
})

test("onNoIp: reject answers 400 instead of filling the shared bucket", async () => {
  const app = createApp({ store: memoryStore(), trust: "cloudflare", onNoIp: "reject" })
  for (let i = 0; i < 61; i++) expect((await app.request("/api/health")).status).toBe(400)
  const withIp = await app.request("/api/health", { headers: { "cf-connecting-ip": "203.0.113.9" } })
  expect(withIp.status).toBe(200)
})
