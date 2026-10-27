import { Hono } from "hono"
import {
  registerProtectedResourceMetadata,
  requireScopes,
  requireToken,
} from "../src/oauth-rs/hono"
import { createJwksCache } from "../src/oauth-rs/jwks"
import { protectedResourceMetadata, wwwAuthenticate } from "../src/oauth-rs/metadata"
import { createTokenVerifier, scopesOf, type TokenError } from "../src/oauth-rs/verify"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

const ISS = "https://auth.example.com"
const AUD = "https://mcp.app-b.example"
const b64url = (b: Uint8Array | string) => {
  const bytes = typeof b === "string" ? new TextEncoder().encode(b) : b
  let s = ""
  for (const x of bytes) s += String.fromCharCode(x)
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
}

// --- real keys, not mocks ---
const pair = (await crypto.subtle.generateKey(
  {
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  },
  true,
  ["sign", "verify"],
)) as CryptoKeyPair
const other = (await crypto.subtle.generateKey(
  {
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  },
  true,
  ["sign", "verify"],
)) as CryptoKeyPair

const jwk = {
  ...(await crypto.subtle.exportKey("jwk", pair.publicKey)),
  kid: "key-1",
  use: "sig",
  alg: "RS256",
}
let servedKeys = [jwk]
let fetches = 0
const fetchImpl = (async () => {
  fetches++
  return new Response(JSON.stringify({ keys: servedKeys }), {
    headers: { "content-type": "application/json" },
  })
}) as typeof fetch

async function mint(
  over: Record<string, unknown> = {},
  key = pair.privateKey,
  header: Record<string, unknown> = {},
) {
  const h = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "key-1", ...header }))
  const now = Math.floor(Date.now() / 1000)
  const p = b64url(
    JSON.stringify({
      iss: ISS,
      aud: AUD,
      sub: "user-1",
      exp: now + 3600,
      iat: now,
      scope: "read write",
      ...over,
    }),
  )
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${h}.${p}`),
  )
  return `${h}.${p}.${b64url(new Uint8Array(sig))}`
}

const jwks = createJwksCache({ jwksUri: "https://auth.example.com/jwks", fetchImpl })
const verifier = createTokenVerifier({ issuer: ISS, audience: AUD, jwksUri: "x", jwks })
const reject = async (t: string) => {
  try {
    await verifier.verify(t)
    return null
  } catch (e) {
    return e as TokenError
  }
}

// --- the happy path ---
const good = await verifier.verify(await mint())
ok("valid token verifies", good.claims.sub === "user-1")
ok("scopes parsed from `scope`", good.scopes.join(",") === "read,write")
ok("scopes parsed from `scp` array", scopesOf({ scp: ["a", "b"] } as never).join(",") === "a,b")

// --- THE AUDIENCE CHECK: a token for someone else must be rejected ---
const wrongAud = await reject(await mint({ aud: "https://someone-elses-api.example" }))
ok(
  "REJECTS a token minted for another audience",
  wrongAud?.code === "invalid_token",
  String(wrongAud?.message),
)
ok("rejection names the audience problem", /audience/i.test(wrongAud?.message ?? ""))
const arrayAudOk = await verifier.verify(await mint({ aud: ["https://other.example", AUD] }))
ok("accepts an aud ARRAY containing us", arrayAudOk.claims.sub === "user-1")
ok(
  "REJECTS an aud array without us",
  (await reject(await mint({ aud: ["https://a.example", "https://b.example"] }))) !== null,
)
ok("REJECTS a token with no aud at all", (await reject(await mint({ aud: undefined }))) !== null)

// --- signature / algorithm ---
ok(
  "REJECTS a token signed by a different key",
  (await reject(await mint({}, other.privateKey)))?.message === "Invalid signature",
)
ok(
  "REJECTS alg=none",
  /Unsupported algorithm/.test(
    (await reject(await mint({}, pair.privateKey, { alg: "none" })))?.message ?? "",
  ),
)
ok(
  "REJECTS alg=HS256 (symmetric confusion)",
  /Unsupported algorithm/.test(
    (await reject(await mint({}, pair.privateKey, { alg: "HS256" })))?.message ?? "",
  ),
)
ok(
  "REJECTS a tampered payload",
  (await reject((await mint()).replace(/\.[^.]+\./, ".eyJzdWIiOiJhdHRhY2tlciJ9."))) !== null,
)
ok("REJECTS a malformed token", (await reject("not.a.jwt"))?.message === "Malformed token")
ok("REJECTS an empty token", (await reject("")) !== null)

// --- time and identity ---
ok(
  "REJECTS an expired token",
  /expired/i.test(
    (await reject(await mint({ exp: Math.floor(Date.now() / 1000) - 7200 })))?.message ?? "",
  ),
)
ok(
  "REJECTS a not-yet-valid token",
  /not yet valid/i.test(
    (await reject(await mint({ nbf: Math.floor(Date.now() / 1000) + 7200 })))?.message ?? "",
  ),
)
ok(
  "REJECTS a wrong issuer",
  /issuer/i.test((await reject(await mint({ iss: "https://evil.example" })))?.message ?? ""),
)
ok(
  "REJECTS a token with no subject",
  /subject/i.test((await reject(await mint({ sub: undefined })))?.message ?? ""),
)
ok(
  "accepts expiry inside clock skew",
  (await verifier.verify(await mint({ exp: Math.floor(Date.now() / 1000) - 30 }))).claims.sub ===
    "user-1",
)

// --- key rotation, and the flood guard that constrains it ---
// An unknown kid triggers a refetch, but at most once per minRefetchSeconds:
// rotation must not cause an outage, and a stream of bogus kids must not be
// turnable into a fetch flood. Those pull in opposite directions, so both
// halves are asserted rather than only the convenient one.
const beforeFlood = fetches
for (let i = 0; i < 20; i++) await reject(await mint({}, pair.privateKey, { kid: `bogus-${i}` }))
ok(
  "20 bogus kids do NOT cause 20 refetches",
  fetches - beforeFlood <= 1,
  `${fetches - beforeFlood} fetches`,
)
ok(
  "unknown kid still rejected",
  (await reject(await mint({}, pair.privateKey, { kid: "nope" })))?.message ===
    "No matching signing key",
)

// With the cooldown elapsed, a rotated key is picked up without a restart.
const rotatedJwk = {
  ...(await crypto.subtle.exportKey("jwk", other.publicKey)),
  kid: "key-2",
  use: "sig",
  alg: "RS256",
}
servedKeys = [jwk, rotatedJwk]
let clock = Date.now()
const rotCache = createJwksCache({
  jwksUri: "x",
  fetchImpl,
  minRefetchSeconds: 60,
  now: () => clock,
})
const rotVerifier = createTokenVerifier({
  issuer: ISS,
  audience: AUD,
  jwksUri: "x",
  jwks: rotCache,
})
await rotVerifier.verify(await mint()) // warm the cache
servedKeys = [rotatedJwk] // issuer rotates
clock += 61_000 // cooldown elapses
const rotated = await rotVerifier.verify(await mint({}, other.privateKey, { kid: "key-2" }))
ok("a ROTATED key is picked up once the cooldown passes", rotated.claims.sub === "user-1")

// --- metadata ---
const doc = protectedResourceMetadata({
  resource: AUD,
  authorizationServers: [ISS],
  scopesSupported: ["read", "write"],
})
ok("metadata names the resource", doc.resource === AUD)
ok("metadata names the authorization server", doc.authorization_servers[0] === ISS)
ok("metadata advertises header-only bearer", doc.bearer_methods_supported?.join(",") === "header")
const wa = wwwAuthenticate({
  resourceMetadataUrl: "https://x/.well-known/oauth-protected-resource",
  error: "insufficient_scope",
  requiredScopes: ["write"],
})
ok("WWW-Authenticate carries resource_metadata", wa.includes('resource_metadata="https://x/'))
ok("WWW-Authenticate names the missing scope (step-up)", wa.includes('scope="write"'))

// --- hono integration ---
const app = new Hono<{ Variables: { subject: string | undefined } }>()
registerProtectedResourceMetadata(app as never, { resource: AUD, authorizationServers: [ISS] })
const META = `${AUD}/.well-known/oauth-protected-resource`
app.use("/mcp/*", requireToken({ verifier, resourceMetadataUrl: META }))
app.get("/mcp/read", (c) => c.json({ sub: c.get("subject") }))
app.get("/mcp/admin", requireScopes(META, "admin"), (c) => c.json({ ok: true }))

const meta = await app.request("/.well-known/oauth-protected-resource")
ok("metadata endpoint is public", meta.status === 200)
ok(
  "metadata endpoint returns the document",
  ((await meta.json()) as { resource: string }).resource === AUD,
)

const noTok = await app.request("/mcp/read")
ok("401 without a token", noTok.status === 401)
ok(
  "401 carries WWW-Authenticate with metadata URL",
  noTok.headers.get("WWW-Authenticate")?.includes("resource_metadata") === true,
)

const withTok = await app.request("/mcp/read", {
  headers: { authorization: `Bearer ${await mint()}` },
})
ok("200 with a valid token", withTok.status === 200)
ok("subject reaches the handler", ((await withTok.json()) as { sub: string }).sub === "user-1")

const foreign = await app.request("/mcp/read", {
  headers: { authorization: `Bearer ${await mint({ aud: "https://elsewhere.example" })}` },
})
ok("ROUTE rejects a token for another audience", foreign.status === 401)

const stepUp = await app.request("/mcp/admin", {
  headers: { authorization: `Bearer ${await mint()}` },
})
ok("403 when a scope is missing", stepUp.status === 403)
ok(
  "403 names the required scope for step-up",
  stepUp.headers.get("WWW-Authenticate")?.includes('scope="admin"') === true,
)
const admin = await app.request("/mcp/admin", {
  headers: { authorization: `Bearer ${await mint({ scope: "read write admin" })}` },
})
ok("200 once the scope is present", admin.status === 200)

// --- the raw token must not be reachable from the context ---
const leak = new Hono()
leak.use("/x", requireToken({ verifier, resourceMetadataUrl: META }))
leak.get("/x", (c) => c.json({ raw: c.get("token" as never) }))
const leaked = (await (
  await leak.request("/x", { headers: { authorization: `Bearer ${await mint()}` } })
).json()) as { raw: unknown }
ok(
  "context exposes claims, never the raw token",
  JSON.stringify(leaked).includes("user-1") && !JSON.stringify(leaked).includes("eyJhbGciOi"),
)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
