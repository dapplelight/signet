import {
  b64urlDecode,
  b64urlEncode,
  createPusher,
  encryptAes128gcm,
  vapidJwt,
  webCryptoPushSender,
} from "../src/notify/push"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

// --- RFC 8291 section 5 test vector ---
const rfc = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  asPublic:
    "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  uaPublic:
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
}
const body = await encryptAes128gcm(
  new TextEncoder().encode(rfc.plaintext),
  { p256dh: rfc.uaPublic, auth: rfc.auth },
  {
    salt: b64urlDecode(rfc.salt),
    serverKey: { publicKey: rfc.asPublic, privateKey: rfc.asPrivate },
  },
)
ok("RFC 8291 vector: body matches", b64urlEncode(body) === rfc.body, b64urlEncode(body))

// --- RFC 8292 section 2 example JWT verifies against the example public key ---
const rfc8292 = {
  jwt: "eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJhdWQiOiJodHRwczovL3B1c2guZXhhbXBsZS5uZXQiLCJleHAiOjE0NTM1MjM3NjgsInN1YiI6Im1haWx0bzpwdXNoQGV4YW1wbGUuY29tIn0.i3CYb7t4xfxCDquptFOepC9GAu_HLGkMlMuCGSK2rpiUfnK9ojFwDXb1JrErtmysazNjjvW2L9OkSSHzvoD1oA",
  publicKey:
    "BA1Hxzyi1RUM1b5wjxsn7nGxAszw2u61m164i3MrAIxHF6YK5h4SDYic-dRuU_RCPCfA5aq9ojSwk5Y2EmClBPs",
}
const verify = async (jwt: string, publicKey: string) => {
  const pub = b64urlDecode(publicKey)
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x: b64urlEncode(pub.slice(1, 33)), y: b64urlEncode(pub.slice(33)) },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  )
  const [h, c, s] = jwt.split(".")
  return crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    b64urlDecode(s as string),
    new TextEncoder().encode(`${h}.${c}`),
  )
}
ok("RFC 8292 example JWT verifies (ES256 raw r||s)", await verify(rfc8292.jwt, rfc8292.publicKey))

// --- our own JWT: claims and signature ---
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"])
const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey)
const pub = new Uint8Array([4, ...b64urlDecode(jwk.x as string), ...b64urlDecode(jwk.y as string)])
const vapid = {
  subject: "mailto:ops@example.com",
  publicKey: b64urlEncode(pub),
  privateKey: jwk.d as string,
}
const jwt = await vapidJwt(vapid, "https://push.example.net/send/abc", 1_000_000_000_000)
const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(jwt.split(".")[1] as string)))
ok(
  "VAPID claims",
  claims.aud === "https://push.example.net" &&
    claims.sub === vapid.subject &&
    claims.exp === 1_000_043_200,
  JSON.stringify(claims),
)
ok("VAPID signature verifies", await verify(jwt, vapid.publicKey))

// --- round trip: decrypt what we produce with the subscriber's private key ---
const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
  "deriveBits",
])
const uaRaw = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey))
const authSecret = crypto.getRandomValues(new Uint8Array(16))
const sub = {
  id: "1",
  endpoint: "https://push.example.net/send/abc",
  keys: { p256dh: b64urlEncode(uaRaw), auth: b64urlEncode(authSecret) },
}
const sent = await encryptAes128gcm(new TextEncoder().encode("héllo"), sub.keys)
const asPub = sent.slice(21, 21 + sent[20]!)
const asKey = await crypto.subtle.importKey(
  "jwk",
  {
    kty: "EC",
    crv: "P-256",
    x: b64urlEncode(asPub.slice(1, 33)),
    y: b64urlEncode(asPub.slice(33)),
  },
  { name: "ECDH", namedCurve: "P-256" },
  false,
  [],
)
const secret = await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, ua.privateKey, 256)
const e = new TextEncoder()
type Bytes = Uint8Array<ArrayBuffer>
const hkdf = async (ikm: ArrayBuffer | Bytes, salt: Bytes, info: Bytes, n: number) =>
  new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt, info },
      await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]),
      n * 8,
    ),
  )
const ikm = await hkdf(
  secret,
  authSecret,
  new Uint8Array([...e.encode("WebPush: info\0"), ...uaRaw, ...asPub]),
  32,
)
const salt = sent.slice(0, 16)
const cek = await crypto.subtle.importKey(
  "raw",
  await hkdf(ikm, salt, e.encode("Content-Encoding: aes128gcm\0"), 16),
  "AES-GCM",
  false,
  ["decrypt"],
)
const iv = await hkdf(ikm, salt, e.encode("Content-Encoding: nonce\0"), 12)
const plain = new Uint8Array(
  await crypto.subtle.decrypt({ name: "AES-GCM", iv }, cek, sent.slice(21 + sent[20]!)),
)
ok(
  "round trip decrypts, last byte is 0x02 delimiter",
  new TextDecoder().decode(plain.slice(0, -1)) === "héllo" && plain.at(-1) === 2,
)

let threw = ""
await encryptAes128gcm(new Uint8Array(3994), sub.keys).catch((err) => {
  threw = String(err)
})
ok("rejects oversize payload", threw.includes("3993"), threw)

// --- sender: request shape and 410 pruning through createPusher ---
const reqs: Array<{ url: string; init: RequestInit }> = []
let status = 201
const sender = webCryptoPushSender({
  vapid,
  urgency: "high",
  fetch: (async (url: string, init: RequestInit) => {
    reqs.push({ url, init })
    return new Response(null, { status })
  }) as unknown as typeof fetch,
})
const pruned: string[] = []
const pusher = createPusher({
  send: sender,
  removeSubscription: async (id) => void pruned.push(id),
})
ok("delivers on 201", (await pusher.sendTo([sub], { title: "T", message: "M" })) === 1)
const h = reqs[0]?.init.headers as Record<string, string>
ok("posts to the endpoint", reqs[0]?.url === sub.endpoint)
ok(
  "aes128gcm + octet-stream",
  h["Content-Encoding"] === "aes128gcm" && h["Content-Type"] === "application/octet-stream",
)
ok("TTL and Urgency", h.TTL === "86400" && h.Urgency === "high")
ok(
  "vapid Authorization",
  h.Authorization?.startsWith("vapid t=") === true &&
    h.Authorization.endsWith(`, k=${vapid.publicKey}`),
)
status = 410
ok("410 not counted", (await pusher.sendTo([sub], { title: "T", message: "M" })) === 0)
ok("410 prunes the subscription", pruned[0] === "1")
status = 500
await pusher.sendTo([{ ...sub, id: "2" }], { title: "T", message: "M" })
ok("500 does not prune", !pruned.includes("2"))

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
