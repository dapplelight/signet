/**
 * The device flow's polling half (RFC 8628 section 3.5), apart from I/O so it
 * tests against a fake fetch: wait `interval`, POST /token, and on
 * `authorization_pending` wait again, on `slow_down` wait 5 seconds longer from
 * then on, on `expired_token` or any other error stop.
 */

export const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code"

export type TokenBody = { access_token: string; refresh_token?: string; expires_in?: number }

export type PollOptions = {
  tokenUrl: string
  clientId: string
  deviceCode: string
  /** Seconds between polls, from the device-code response. */
  interval: number
  /** Seconds until the device code dies, from the same response. */
  expiresIn: number
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

export async function pollDeviceToken(o: PollOptions): Promise<TokenBody> {
  const doFetch = o.fetch ?? fetch
  const sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  const now = o.now ?? Date.now
  const deadline = now() + o.expiresIn * 1000
  let interval = o.interval

  for (;;) {
    await sleep(interval * 1000)
    if (now() >= deadline) throw new Error("The sign-in code expired. Run login again.")
    const res = await doFetch(o.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: DEVICE_GRANT,
        device_code: o.deviceCode,
        client_id: o.clientId,
      }),
    })
    if (res.ok) return (await res.json()) as TokenBody
    const body = (await res.json().catch(() => ({}))) as {
      error?: string
      error_description?: string
    }
    if (body.error === "authorization_pending") continue
    if (body.error === "slow_down") {
      interval += 5
      continue
    }
    if (body.error === "expired_token")
      throw new Error("The sign-in code expired. Run login again.")
    throw new Error(body.error_description ?? body.error ?? `Sign-in failed (HTTP ${res.status})`)
  }
}
