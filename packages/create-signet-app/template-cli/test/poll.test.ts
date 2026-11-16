import { describe, expect, test } from "bun:test"
import { pollDeviceToken } from "../src/poll.ts"

/** A fake token endpoint that answers from a script and records each call. */
function fake(script: Array<{ status: number; body: object }>) {
  const calls: URLSearchParams[] = []
  const f = (async (_url: string, init: RequestInit) => {
    calls.push(init.body as URLSearchParams)
    const step = script[Math.min(calls.length, script.length) - 1] as (typeof script)[number]
    return new Response(JSON.stringify(step.body), { status: step.status })
  }) as unknown as typeof fetch
  return { f, calls }
}

function run(script: Parameters<typeof fake>[0], expiresIn = 600) {
  const { f, calls } = fake(script)
  const waits: number[] = []
  let t = 0
  const p = pollDeviceToken({
    tokenUrl: "http://x/token",
    clientId: "cli",
    deviceCode: "dc",
    interval: 5,
    expiresIn,
    fetch: f,
    sleep: async (ms) => {
      waits.push(ms / 1000)
      t += ms
    },
    now: () => t,
  })
  return { p, calls, waits }
}

const pending = { status: 400, body: { error: "authorization_pending" } }
const ok = { status: 200, body: { access_token: "a", refresh_token: "r", expires_in: 900 } }

describe("pollDeviceToken", () => {
  test("pending then success, sending the device grant", async () => {
    const { p, calls, waits } = run([pending, pending, ok])
    expect((await p).access_token).toBe("a")
    expect(waits).toEqual([5, 5, 5])
    expect(calls[0]?.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:device_code")
    expect(calls[0]?.get("device_code")).toBe("dc")
  })

  test("slow_down adds 5 seconds to every later wait", async () => {
    const { p, waits } = run([pending, { status: 400, body: { error: "slow_down" } }, pending, ok])
    await p
    expect(waits).toEqual([5, 5, 10, 10])
  })

  test("expired_token stops", async () => {
    const { p } = run([pending, { status: 400, body: { error: "expired_token" } }])
    await expect(p).rejects.toThrow(/expired/)
  })

  test("gives up at expires_in even if the server keeps saying pending", async () => {
    const { p, calls } = run([pending], 12)
    await expect(p).rejects.toThrow(/expired/)
    expect(calls.length).toBe(2)
  })

  test("any other error surfaces its message", async () => {
    const { p } = run([{ status: 400, body: { error: "access_denied", error_description: "No." } }])
    await expect(p).rejects.toThrow("No.")
  })
})
