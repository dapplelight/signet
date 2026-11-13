/**
 * Web push fan-out with dead-subscription pruning.
 *
 * The signed POST is an injectable `PushSender`, so Node apps can wrap
 * `web-push`. `webCryptoPushSender` is the ready-made one for Workers: VAPID and
 * RFC 8291 encryption on Web Crypto only.
 *
 * What IS here is the part app-a got right and that is easy to omit: a push
 * endpoint that returns 404 or 410 is permanently gone, and a subscription that
 * is never pruned is retried forever on every future notification.
 */

export type PushSubscription = {
  id: string
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export type PushPayload = {
  title: string
  message: string
  url?: string
}

export type PushSender = (sub: PushSubscription, body: string) => Promise<void>

export type PushConfig = {
  /** Performs the signed POST. `webCryptoPushSender` on Workers, or wrap `web-push` on Node. */
  send: PushSender
  /** Delete a permanently-gone subscription. */
  removeSubscription: (id: string) => Promise<void>
  onEvent?: (event: string, data: Record<string, unknown>) => void
}

// --- Web Crypto sender: VAPID (RFC 8292) + aes128gcm (RFC 8291) ---------------
// Web Crypto, fetch, atob/btoa and TextEncoder only: no Node APIs, so it runs on
// Workers, Deno, Bun and browsers.

const enc = new TextEncoder()

type Bytes = Uint8Array<ArrayBuffer>

export function b64urlDecode(s: string): Bytes {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"))
  return Uint8Array.from(b, (c) => c.charCodeAt(0))
}

export function b64urlEncode(bytes: Uint8Array): string {
  let s = ""
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** A P-256 key from an uncompressed public point (65 bytes) and optional private scalar. */
function p256Jwk(pub: Uint8Array, d?: string): JsonWebKey {
  if (pub.length !== 65 || pub[0] !== 4)
    throw new Error("push: public key must be an uncompressed P-256 point")
  return {
    kty: "EC",
    crv: "P-256",
    x: b64urlEncode(pub.slice(1, 33)),
    y: b64urlEncode(pub.slice(33)),
    ...(d ? { d } : {}),
  }
}

/** RFC 8291 max plaintext in one aes128gcm record the push services accept. */
const MAX_PLAINTEXT = 3993

export type EncryptOptions = {
  /** Test seam: fixed 16-byte salt. Default is random. */
  salt?: Bytes
  /** Test seam: fixed application-server key, public point + private scalar (base64url). */
  serverKey?: { publicKey: string; privateKey: string }
}

/**
 * RFC 8291 aes128gcm body for one subscription, as a single 4096-byte record.
 * Returns the full request body: salt, record size, key id (our public key), ciphertext.
 */
export async function encryptAes128gcm(
  plaintext: Bytes,
  keys: PushSubscription["keys"],
  opts: EncryptOptions = {},
): Promise<Bytes> {
  if (plaintext.length > MAX_PLAINTEXT) throw new Error(`push: payload over ${MAX_PLAINTEXT} bytes`)
  const subtle = crypto.subtle
  const uaPublic = b64urlDecode(keys.p256dh)
  const authSecret = b64urlDecode(keys.auth)
  if (authSecret.length !== 16) throw new Error("push: auth secret must be 16 bytes")

  let asPublic: Bytes
  let asPrivate: CryptoKey
  if (opts.serverKey) {
    asPublic = b64urlDecode(opts.serverKey.publicKey)
    asPrivate = await subtle.importKey(
      "jwk",
      p256Jwk(asPublic, opts.serverKey.privateKey),
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"],
    )
  } else {
    const pair = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
    ])
    asPublic = new Uint8Array(await subtle.exportKey("raw", pair.publicKey))
    asPrivate = pair.privateKey
  }
  const uaKey = await subtle.importKey(
    "jwk",
    p256Jwk(uaPublic),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  )
  const ecdh = await subtle.deriveBits({ name: "ECDH", public: uaKey }, asPrivate, 256)

  // HKDF = extract + expand; Web Crypto does both in one deriveBits call.
  const hkdf = async (ikm: ArrayBuffer | Bytes, salt: Bytes, info: Bytes, bytes: number) => {
    const k = await subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"])
    return new Uint8Array(
      await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, bytes * 8),
    )
  }
  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic)
  const ikm = await hkdf(ecdh, authSecret, keyInfo, 32)
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(ikm, salt, enc.encode("Content-Encoding: aes128gcm\0"), 16)
  const nonce = await hkdf(ikm, salt, enc.encode("Content-Encoding: nonce\0"), 12)

  const aes = await subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"])
  // 0x02 = padding delimiter of the last (here: only) record.
  const record = concat(plaintext, new Uint8Array([2]))
  const cipher = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, record))

  const header = new Uint8Array(21)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, 4096)
  header[20] = asPublic.length
  return concat(header, asPublic, cipher)
}

export type VapidConfig = {
  /** `mailto:` or https URL the push service can contact about this sender. */
  subject: string
  /** Base64url uncompressed P-256 public point (65 bytes), as given to `pushManager.subscribe`. */
  publicKey: string
  /** Base64url P-256 private scalar (32 bytes). */
  privateKey: string
}

export type WebCryptoPushConfig = {
  vapid: VapidConfig
  /** Seconds the push service may hold the message. Default 86400. */
  ttl?: number
  urgency?: "very-low" | "low" | "normal" | "high"
  /** Default global `fetch`, looked up at send time. */
  fetch?: typeof fetch
  /** Test seam: clock in ms. */
  now?: () => number
}

/** ES256 VAPID JWT (RFC 8292) for the push service origin of `endpoint`. */
export async function vapidJwt(
  vapid: VapidConfig,
  endpoint: string,
  nowMs = Date.now(),
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "jwk",
    p256Jwk(b64urlDecode(vapid.publicKey), vapid.privateKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  )
  const part = (o: object) => b64urlEncode(enc.encode(JSON.stringify(o)))
  const input = `${part({ typ: "JWT", alg: "ES256" })}.${part({
    aud: new URL(endpoint).origin,
    exp: Math.floor(nowMs / 1000) + 12 * 3600, // spec max is 24h
    sub: vapid.subject,
  })}`
  // Web Crypto ECDSA output is already raw r||s, which is what JWS ES256 wants.
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(input))
  return `${input}.${b64urlEncode(new Uint8Array(sig))}`
}

/**
 * A `PushSender` for Workers and any other Web Crypto runtime. Throws an error
 * carrying `statusCode` on a non-2xx response, so `createPusher` prunes 404/410.
 * Node users can keep injecting `web-push` instead.
 */
export function webCryptoPushSender(config: WebCryptoPushConfig): PushSender {
  return async (sub, body) => {
    const [jwt, payload] = await Promise.all([
      vapidJwt(config.vapid, sub.endpoint, config.now?.()),
      encryptAes128gcm(enc.encode(body), sub.keys),
    ])
    const headers: Record<string, string> = {
      Authorization: `vapid t=${jwt}, k=${config.vapid.publicKey}`,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(config.ttl ?? 86400),
    }
    if (config.urgency) headers.Urgency = config.urgency
    const res = await (config.fetch ?? fetch)(sub.endpoint, {
      method: "POST",
      headers,
      body: payload,
    })
    if (!res.ok) {
      throw Object.assign(new Error(`push service responded ${res.status}`), {
        statusCode: res.status,
      })
    }
  }
}

/** 404 Not Found and 410 Gone both mean the subscription will never work again. */
export function isGone(err: unknown): boolean {
  const status = (err as { statusCode?: number }).statusCode ?? (err as { status?: number }).status
  return status === 404 || status === 410
}

export function createPusher(config: PushConfig) {
  return {
    /** Returns how many actually delivered. Never throws. */
    async sendTo(subscriptions: PushSubscription[], payload: PushPayload): Promise<number> {
      const body = JSON.stringify(payload)
      let sent = 0
      await Promise.all(
        subscriptions.map(async (sub) => {
          try {
            await config.send(sub, body)
            sent++
          } catch (err) {
            if (isGone(err)) {
              // Prune, or this endpoint is retried on every future send forever.
              await config.removeSubscription(sub.id).catch(() => {})
              config.onEvent?.("push.pruned", { id: sub.id })
            } else {
              config.onEvent?.("push.failed", { id: sub.id, err: String(err) })
            }
          }
        }),
      )
      return sent
    },
  }
}
