import { afterEach, describe, expect, test } from "bun:test"
import { verifyWebhook } from "@dapplelight/signet-lib/webhooks"
import { eq } from "drizzle-orm"
import { createCipher, generateKey, isCiphertext } from "../src/cipher"
import * as pgc from "../src/columns/pg"
import * as sqc from "../src/columns/sqlite"
import { isSignetDbError } from "../src/errors"
import { drainOutbox } from "../src/outbox"
import {
  assertWebhookUrl,
  createWebhooks,
  defaultResolveHost,
  isPrivateAddress,
  WEBHOOK_TOPIC,
} from "../src/webhooks"
import { backends, ddl, type Instance } from "./harness"

type Hit = { url: string; headers: Record<string, string>; body: string; redirect?: string }

/** A receiver: answers from `script` in turn (last one repeats), records what it got. */
function receiver(script: (number | "throw" | { redirect: string })[] = [200]) {
  const hits: Hit[] = []
  const fetch = async (url: string, init: RequestInit) => {
    hits.push({
      url,
      headers: init.headers as Record<string, string>,
      body: String(init.body),
      ...(init.redirect ? { redirect: init.redirect } : {}),
    })
    const next = script[Math.min(hits.length - 1, script.length - 1)]
    if (next === "throw") throw new Error("connect ECONNREFUSED")
    if (typeof next === "object")
      return new Response(null, { status: 302, headers: { location: next.redirect } })
    return new Response(next === 200 ? "ok" : "nope", { status: next })
  }
  return { hits, fetch }
}

const drain = (i: Instance, webhooks: ReturnType<typeof createWebhooks>, maxAttempts = 10) =>
  drainOutbox(i.db, { send: (m) => webhooks.send(m) }, { backoff: () => 0, maxAttempts })

for (const backend of backends) {
  describe(`webhooks: ${backend.name}`, () => {
    let i: Instance
    afterEach(async () => i?.close())

    async function setup(opts: Partial<Parameters<typeof createWebhooks>[1]> = {}, cipher = false) {
      i = await backend.make(
        cipher ? { cipher: createCipher({ keys: { k: generateKey() }, current: "k" }) } : {},
      )
      const T = i.db.dialect === "pg" ? pgc.webhookTables() : sqc.webhookTables()
      await i.exec(ddl(T.webhookEndpoints))
      await i.exec(ddl(T.webhookDeliveries))
      const webhooks = createWebhooks(i.db, {
        endpoints: T.webhookEndpoints,
        deliveries: T.webhookDeliveries,
        // A public address: tests never touch real DNS unless they ask to.
        resolveHost: async () => ["93.184.216.34"],
        ...opts,
      })
      return { webhooks, T }
    }

    test("register, list without secrets, owner isolation", async () => {
      const r = receiver()
      const { webhooks } = await setup({ fetch: r.fetch })
      const { endpoint, secret } = await webhooks.register({
        owner: "org1",
        url: "https://hooks.example.com/in",
        events: ["order.created"],
      })
      expect(secret).toMatch(/^whsec_/)
      expect("secret" in endpoint).toBe(false)
      const list = await webhooks.list("org1")
      expect(list.map((x) => x.id)).toEqual([endpoint.id])
      expect("secret" in (list[0] as object)).toBe(false)
      expect(await webhooks.list("org2")).toEqual([])
      expect(await webhooks.get("org2", endpoint.id)).toBeNull()
      expect(await webhooks.update("org2", endpoint.id, { enabled: false })).toBeNull()
      expect(await webhooks.remove("org2", endpoint.id)).toBe(false)
      await expect(
        webhooks.register({ owner: "o", url: "http://hooks.example.com", events: ["*"] }),
      ).rejects.toThrow("https")
      await expect(
        webhooks.register({ owner: "o", url: "https://hooks.example.com", events: [] }),
      ).rejects.toThrow("events")
    })

    test("signed delivery verifies on the receiver; response is logged", async () => {
      const r = receiver([200])
      const { webhooks } = await setup({ fetch: r.fetch })
      const { secret } = await webhooks.register({
        owner: "org1",
        url: "https://hooks.example.com/in",
        events: ["order.created"],
      })
      await webhooks.register({
        owner: "org1",
        url: "https://other.example.com",
        events: ["user.deleted"],
      })
      await webhooks.register({ owner: "org2", url: "https://org2.example.com", events: ["*"] })
      expect(
        await webhooks.emit({ owner: "org1", type: "order.created", data: { id: "o1" } }),
      ).toBe(1)
      expect(await drain(i, webhooks)).toEqual({ sent: 1, failed: 0, dead: 0 })
      expect(r.hits.length).toBe(1)
      const hit = r.hits[0] as Hit
      expect(hit.url).toBe("https://hooks.example.com/in")
      expect(await verifyWebhook(secret, hit.headers, hit.body)).toBe(true)
      expect(await verifyWebhook(secret, hit.headers, hit.body.replace("o1", "o2"))).toBe(false)
      expect(JSON.parse(hit.body)).toMatchObject({ type: "order.created", data: { id: "o1" } })
      const [log] = await webhooks.deliveries("org1")
      expect(log).toMatchObject({
        status: "delivered",
        attempts: 1,
        responseStatus: 200,
        responseBody: "ok",
      })
      expect(log?.deliveredAt).toBeInstanceOf(Date)
      expect(await webhooks.deliveries("org2")).toEqual([])
    })

    test("statements go in the caller's atomic batch", async () => {
      const { webhooks } = await setup({ fetch: receiver().fetch })
      await webhooks.register({ owner: "u1", url: "https://h.example.com", events: ["*"] })
      const s = await webhooks.statements({ owner: "u1", type: "note.created", data: {} })
      await i.db.batch([
        (tx: any) => tx.insert(i.S.tags).values({ userId: "u1", label: "x" }),
        ...s,
      ])
      expect((await webhooks.deliveries("u1")).length).toBe(1)
      const outbox = await i.db.orm.select().from(i.S.outbox)
      expect(outbox.map((m: { topic: string }) => m.topic)).toEqual([WEBHOOK_TOPIC])
    })

    test("retries with backoff keep the same webhook-id, then deliver", async () => {
      const r = receiver([500, "throw", 200])
      const { webhooks } = await setup({ fetch: r.fetch })
      const { endpoint } = await webhooks.register({
        owner: "o",
        url: "https://h.example.com",
        events: ["*"],
      })
      await webhooks.emit({ owner: "o", type: "t", data: 1, id: "evt_fixed" })
      expect(await drain(i, webhooks)).toEqual({ sent: 0, failed: 1, dead: 0 })
      expect((await webhooks.deliveries("o"))[0]).toMatchObject({
        status: "retrying",
        attempts: 1,
        responseStatus: 500,
        error: "HTTP 500",
      })
      expect((await webhooks.get("o", endpoint.id))?.failures).toBe(1)
      await drain(i, webhooks)
      expect((await webhooks.deliveries("o"))[0]?.error).toContain("ECONNREFUSED")
      expect(await drain(i, webhooks)).toEqual({ sent: 1, failed: 0, dead: 0 })
      expect(r.hits.map((h) => h.headers["webhook-id"])).toEqual([
        "evt_fixed",
        "evt_fixed",
        "evt_fixed",
      ])
      expect((await webhooks.deliveries("o"))[0]).toMatchObject({
        status: "delivered",
        attempts: 3,
      })
      expect((await webhooks.get("o", endpoint.id))?.failures).toBe(0)
    })

    test("gives up after maxAttempts: log failed, outbox dead", async () => {
      const r = receiver([503])
      const { webhooks } = await setup({ fetch: r.fetch, maxAttempts: 2 })
      await webhooks.register({ owner: "o", url: "https://h.example.com", events: ["*"] })
      await webhooks.emit({ owner: "o", type: "t", data: 1 })
      await drain(i, webhooks, 2)
      expect(await drain(i, webhooks, 2)).toEqual({ sent: 0, failed: 0, dead: 1 })
      expect((await webhooks.deliveries("o"))[0]).toMatchObject({ status: "failed", attempts: 2 })
      expect(await drain(i, webhooks, 2)).toEqual({ sent: 0, failed: 0, dead: 0 })
    })

    test("idempotent: a delivered message sent again is not re-posted; redeliver reuses the event id", async () => {
      const r = receiver([200])
      const { webhooks } = await setup({ fetch: r.fetch })
      await webhooks.register({ owner: "o", url: "https://h.example.com", events: ["*"] })
      await webhooks.emit({ owner: "o", type: "t", data: 1 })
      const [msg] = await i.db.orm.select().from(i.S.outbox)
      await drain(i, webhooks)
      // At-least-once outbox: the same message can arrive twice.
      await webhooks.send({ id: msg.id, topic: msg.topic, payload: msg.payload })
      expect(r.hits.length).toBe(1)

      const [first] = await webhooks.deliveries("o")
      expect(await webhooks.redeliver("other", first?.id as string)).toBeNull()
      const again = await webhooks.redeliver("o", first?.id as string)
      expect(again?.id).not.toBe(first?.id)
      expect(again).toMatchObject({ eventId: first?.eventId, body: first?.body, status: "pending" })
      await drain(i, webhooks)
      expect(r.hits.length).toBe(2)
      expect(r.hits[1]?.headers["webhook-id"]).toBe(r.hits[0]?.headers["webhook-id"] as string)
      expect(r.hits[1]?.body).toBe(r.hits[0]?.body as string)
    })

    test("disables after repeated failures; skips its queued deliveries; enable resets", async () => {
      const r = receiver([500])
      const { webhooks } = await setup({ fetch: r.fetch, disableAfter: 2 })
      const { endpoint } = await webhooks.register({
        owner: "o",
        url: "https://h.example.com",
        events: ["*"],
      })
      await webhooks.emit({ owner: "o", type: "a", data: 1 })
      await webhooks.emit({ owner: "o", type: "b", data: 2 })
      await webhooks.emit({ owner: "o", type: "c", data: 3 })
      // Two attempts fail and switch it off; the rest come up afterwards and are skipped, never posted.
      await drainOutbox(i.db, { send: (m) => webhooks.send(m) }, { backoff: () => 0, batch: 2 })
      const ep = await webhooks.get("o", endpoint.id)
      expect(ep?.disabledAt).toBeInstanceOf(Date)
      expect(ep?.disabledReason).toContain("2 failed attempts")
      expect(await drain(i, webhooks)).toEqual({ sent: 2, failed: 0, dead: 0 })
      const statuses = (await webhooks.deliveries("o")).map((x) => [x.type, x.status])
      expect(statuses).toEqual([
        ["c", "skipped"],
        ["b", "failed"],
        ["a", "skipped"],
      ])
      expect(r.hits.length).toBe(2)
      expect(await webhooks.emit({ owner: "o", type: "d", data: 4 })).toBe(0)
      const [first] = await webhooks.deliveries("o")
      await expect(webhooks.redeliver("o", first?.id as string)).rejects.toThrow("enable it first")
      const back = await webhooks.update("o", endpoint.id, { enabled: true })
      expect(back).toMatchObject({ disabledAt: null, failures: 0 })
      expect(await webhooks.emit({ owner: "o", type: "e", data: 5 })).toBe(1)
    })

    test("SSRF: a host resolving to a private address is refused before connecting", async () => {
      for (const [addrs, shown] of [
        [["127.0.0.1"], "127.0.0.1"],
        [["93.184.216.34", "10.1.2.3"], "10.1.2.3"],
        [["::1"], "::1"],
        [["::ffff:127.0.0.1"], "::ffff:127.0.0.1"],
        [["100.64.0.9"], "100.64.0.9"],
        [["fd00::1"], "fd00::1"],
      ] as const) {
        if (shown !== "127.0.0.1") await i.close() // afterEach closes the last one
        const r = receiver([200])
        const { webhooks } = await setup({ fetch: r.fetch, resolveHost: async () => [...addrs] })
        const { endpoint } = await webhooks.register({
          owner: "o",
          url: "https://rebind.example.com/in",
          events: ["*"],
        })
        await webhooks.emit({ owner: "o", type: "t", data: 1 })
        expect(await drain(i, webhooks)).toEqual({ sent: 0, failed: 1, dead: 0 })
        expect(r.hits.length).toBe(0)
        const [log] = await webhooks.deliveries("o")
        expect(log?.status).toBe("retrying")
        expect(log?.error).toBe(
          `Refused: rebind.example.com resolves to a private address (${shown})`,
        )
        const ep = await webhooks.get("o", endpoint.id)
        expect([ep?.failures, ep?.disabledAt]).toEqual([1, null])
      }
    })

    test("SSRF: an unresolvable host is a failed attempt", async () => {
      const r = receiver([200])
      const { webhooks } = await setup({
        fetch: r.fetch,
        resolveHost: async () => {
          throw new Error("ENOTFOUND")
        },
      })
      await webhooks.register({ owner: "o", url: "https://gone.example.com", events: ["*"] })
      await webhooks.emit({ owner: "o", type: "t", data: 1 })
      await drain(i, webhooks)
      expect(r.hits.length).toBe(0)
      expect((await webhooks.deliveries("o"))[0]?.error).toBe(
        "Could not resolve gone.example.com: ENOTFOUND",
      )
    })

    test("redirects are never followed, and count as a failure", async () => {
      const r = receiver([{ redirect: "http://169.254.169.254/latest/meta-data" }])
      const { webhooks } = await setup({ fetch: r.fetch })
      await webhooks.register({ owner: "o", url: "https://h.example.com", events: ["*"] })
      await webhooks.emit({ owner: "o", type: "t", data: 1 })
      expect(await drain(i, webhooks)).toEqual({ sent: 0, failed: 1, dead: 0 })
      expect(r.hits.length).toBe(1)
      expect(r.hits[0]?.redirect).toBe("manual")
      expect((await webhooks.deliveries("o"))[0]).toMatchObject({
        status: "retrying",
        responseStatus: 302,
        error: "HTTP 302: redirect to http://169.254.169.254/latest/meta-data not followed",
      })
    })

    test("secret is ciphertext at rest when the db has a cipher, and still signs", async () => {
      const r = receiver([200])
      const { webhooks, T } = await setup({ fetch: r.fetch }, true)
      const { endpoint, secret } = await webhooks.register({
        owner: "o",
        url: "https://h.example.com",
        events: ["*"],
      })
      const [row] = await i.db.orm
        .select()
        .from(T.webhookEndpoints)
        .where(eq(T.webhookEndpoints.id, endpoint.id))
      expect(isCiphertext(row.secret)).toBe(true)
      await webhooks.emit({ owner: "o", type: "t", data: 1 })
      await drain(i, webhooks)
      const hit = r.hits[0] as Hit
      expect(await verifyWebhook(secret, hit.headers, hit.body)).toBe(true)
      const { secret: next } = (await webhooks.rotateSecret("o", endpoint.id)) as { secret: string }
      await webhooks.emit({ owner: "o", type: "t", data: 2 })
      await drain(i, webhooks)
      const h2 = r.hits[1] as Hit
      expect(await verifyWebhook(next, h2.headers, h2.body)).toBe(true)
      expect(await verifyWebhook(secret, h2.headers, h2.body)).toBe(false)
    })
  })
}

test("assertWebhookUrl refuses private hosts and credentials", () => {
  for (const bad of [
    "https://localhost/x",
    "https://127.0.0.1/x",
    "https://10.0.0.5/x",
    "https://192.168.1.1/x",
    "https://172.16.0.1/x",
    "https://169.254.169.254/latest",
    "https://[::1]/x",
    `https://${["user", "pw"].join(":")}@h.example.com`,
    "ftp://h.example.com",
    "not a url",
  ]) {
    let threw = false
    try {
      assertWebhookUrl(bad)
    } catch (e) {
      threw = isSignetDbError(e, "BAD_VALUE")
    }
    expect([bad, threw]).toEqual([bad, true])
  }
  assertWebhookUrl("https://hooks.example.com/in")
  assertWebhookUrl("http://localhost:3000/in", true)
})

test("isPrivateAddress", () => {
  for (const ip of [
    "0.0.0.0",
    "127.0.0.1",
    "10.0.0.1",
    "172.31.255.255",
    "192.168.0.1",
    "169.254.169.254",
    "100.64.0.1",
    "100.127.255.255",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "[::1]",
    "0:0:0:0:0:0:0:1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:8.8.8.8",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1%en0",
    "ff02::1",
    "999.1.1.1",
    "not-an-ip",
  ])
    expect([ip, isPrivateAddress(ip)]).toEqual([ip, true])
  for (const ip of [
    "93.184.216.34",
    "8.8.8.8",
    "100.63.255.255",
    "172.32.0.1",
    "2606:4700::6810:85e5",
    "2001:db8::1",
  ])
    expect([ip, isPrivateAddress(ip)]).toEqual([ip, false])
})

test("the default resolver uses the runtime's DNS: localhost is loopback", async () => {
  const resolve = await defaultResolveHost()
  expect(resolve).not.toBeNull()
  const addrs = await (resolve as (h: string) => Promise<string[]>)("localhost")
  expect(addrs.length).toBeGreaterThan(0)
  expect(addrs.every(isPrivateAddress)).toBe(true)
})
