/**
 * The JOSE and X.509 pieces the app store adapters need, on Web Crypto alone:
 * base64url, PEM, signing a JWT (ES256 for the App Store Server API, RS256 for
 * a Google service account), verifying a JWS, and a minimal DER reader that
 * verifies an x5c certificate chain up to a pinned root.
 *
 * The chain check covers what Apple's JWSDecodedHeader page asks for (leaf with
 * the receipt-signing extension, intermediate with the WWDR extension, an Apple
 * root): each signature, each validity window, the intermediate being a CA,
 * and the root's SHA-256 fingerprint. It does not check revocation (OCSP/CRL).
 */

import { PaymentsError } from "./errors.js"
import type { Json } from "./http.js"

const enc = new TextEncoder()
const dec = new TextDecoder()

export function b64urlEncode(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? enc.encode(data) : data
  let s = ""
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/** Standard or URL-safe base64, padded or not. */
export function b64Decode(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, ""))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export const pemToDer = (pem: string) =>
  b64Decode(pem.replace(/-----(BEGIN|END)[^-]+-----/g, "").replace(/\\n/g, ""))

const hexOf = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("")

// ---------------------------------------------------------------- JWT / JWS

export async function signJwt(
  header: Record<string, unknown>,
  claims: Record<string, unknown>,
  key: CryptoKey,
): Promise<string> {
  const input = `${b64urlEncode(JSON.stringify(header))}.${b64urlEncode(JSON.stringify(claims))}`
  const algo =
    key.algorithm.name === "ECDSA"
      ? { name: "ECDSA", hash: "SHA-256" }
      : { name: "RSASSA-PKCS1-v1_5" }
  const sig = await crypto.subtle.sign(algo, key, enc.encode(input))
  return `${input}.${b64urlEncode(new Uint8Array(sig))}`
}

export type Jws = { header: Json; payload: Json; input: string; signature: Uint8Array<ArrayBuffer> }

/** Split and decode a compact JWS. Verifies nothing. */
export function decodeJws(jws: string): Jws {
  const parts = typeof jws === "string" ? jws.split(".") : []
  if (parts.length !== 3) throw new PaymentsError("BAD_SIGNATURE", "Not a compact JWS.")
  try {
    return {
      header: JSON.parse(dec.decode(b64Decode(parts[0]))),
      payload: JSON.parse(dec.decode(b64Decode(parts[1]))),
      input: `${parts[0]}.${parts[1]}`,
      signature: b64Decode(parts[2]),
    }
  } catch {
    throw new PaymentsError("BAD_SIGNATURE", "JWS header or payload is not base64url JSON.")
  }
}

export async function verifyJws(jws: Jws, key: CryptoKey): Promise<boolean> {
  const algo =
    key.algorithm.name === "ECDSA"
      ? { name: "ECDSA", hash: "SHA-256" }
      : { name: "RSASSA-PKCS1-v1_5" }
  return crypto.subtle.verify(algo, key, jws.signature, enc.encode(jws.input))
}

// ---------------------------------------------------------------- DER

type Node = { tag: number; start: number; body: number; end: number }

function read(buf: Uint8Array, pos: number): Node {
  const tag = buf[pos]
  let len = buf[pos + 1]
  let body = pos + 2
  if (len & 0x80) {
    const n = len & 0x7f
    len = 0
    for (let i = 0; i < n; i++) len = len * 256 + buf[body + i]
    body += n
  }
  if (body + len > buf.length) throw new Error("DER length runs past the end")
  return { tag, start: pos, body, end: body + len }
}

function kids(buf: Uint8Array, n: Node): Node[] {
  const out: Node[] = []
  for (let p = n.body; p < n.end; ) {
    const c = read(buf, p)
    out.push(c)
    p = c.end
  }
  return out
}

function oid(buf: Uint8Array, n: Node): string {
  const b = buf.subarray(n.body, n.end)
  const out = [Math.floor(b[0] / 40), b[0] % 40]
  let v = 0
  for (let i = 1; i < b.length; i++) {
    v = v * 128 + (b[i] & 0x7f)
    if (!(b[i] & 0x80)) {
      out.push(v)
      v = 0
    }
  }
  return out.join(".")
}

function time(buf: Uint8Array, n: Node): number {
  const s = dec.decode(buf.subarray(n.body, n.end))
  // UTCTime YYMMDDHHMMSSZ (years 1950-2049) or GeneralizedTime YYYYMMDDHHMMSSZ.
  const full = n.tag === 0x17 ? `${Number(s.slice(0, 2)) < 50 ? "20" : "19"}${s}` : s
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(full)
  if (!m) throw new Error(`unreadable certificate time ${s}`)
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
}

const CURVE: Record<string, { name: string; size: number }> = {
  "1.2.840.10045.3.1.7": { name: "P-256", size: 32 },
  "1.3.132.0.34": { name: "P-384", size: 48 },
}
const SIG_HASH: Record<string, string> = {
  "1.2.840.10045.4.3.2": "SHA-256",
  "1.2.840.10045.4.3.3": "SHA-384",
}

export type Cert = {
  der: Uint8Array<ArrayBuffer>
  tbs: Uint8Array<ArrayBuffer>
  sigHash: string
  /** DER ECDSA-Sig-Value. */
  sig: Uint8Array<ArrayBuffer>
  spki: Uint8Array<ArrayBuffer>
  curve: { name: string; size: number }
  notBefore: number
  notAfter: number
  extensions: Map<string, Uint8Array>
}

export function parseCert(der: Uint8Array<ArrayBuffer>): Cert {
  const cert = read(der, 0)
  const [tbsN, algN, sigN] = kids(der, cert) as [Node, Node, Node]
  const tbsKids = kids(der, tbsN)
  const i = tbsKids[0].tag === 0xa0 ? 1 : 0 // optional [0] version
  const validity = kids(der, tbsKids[i + 3])
  const spkiN = tbsKids[i + 5]
  const [spkiAlg] = kids(der, spkiN) as [Node]
  const curveOid = oid(der, kids(der, spkiAlg)[1])
  const extensions = new Map<string, Uint8Array>()
  const extWrap = tbsKids.find((k) => k.tag === 0xa3)
  if (extWrap)
    for (const ext of kids(der, kids(der, extWrap)[0])) {
      const parts = kids(der, ext)
      const value = parts[parts.length - 1]
      extensions.set(oid(der, parts[0]), der.subarray(value.body, value.end))
    }
  const sigHash = SIG_HASH[oid(der, kids(der, algN)[0])]
  const curve = CURVE[curveOid]
  if (!sigHash || !curve) throw new Error("only ECDSA P-256/P-384 certificates are supported")
  return {
    der,
    tbs: der.slice(tbsN.start, tbsN.end),
    sigHash,
    sig: der.slice(sigN.body + 1, sigN.end), // skip the BIT STRING's unused-bits byte
    spki: der.slice(spkiN.start, spkiN.end),
    curve,
    notBefore: time(der, validity[0]),
    notAfter: time(der, validity[1]),
    extensions,
  }
}

/** DER ECDSA-Sig-Value (SEQUENCE { r, s }) to the fixed-width r||s Web Crypto takes. */
function rawSig(der: Uint8Array, size: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(size * 2)
  const [r, s] = kids(der, read(der, 0)) as [Node, Node]
  for (const [k, n] of [r, s].entries()) {
    let v = der.subarray(n.body, n.end)
    while (v.length > size && v[0] === 0) v = v.subarray(1)
    out.set(v, size * (k + 1) - v.length)
  }
  return out
}

export const certKey = (c: Cert) =>
  crypto.subtle.importKey("spki", c.spki, { name: "ECDSA", namedCurve: c.curve.name }, false, [
    "verify",
  ])

const isCa = (c: Cert) => {
  const bc = c.extensions.get("2.5.29.19")
  if (!bc || bc.length < 2) return false
  const seq = read(bc, 0)
  const first = seq.body < seq.end ? read(bc, seq.body) : undefined
  return !!first && first.tag === 0x01 && bc[first.body] !== 0
}

/**
 * Verify an x5c chain [leaf, intermediate, root] and return the leaf. Throws
 * BAD_SIGNATURE with the reason on any failure.
 */
export async function verifyChain(
  x5c: unknown,
  opts: {
    roots: readonly string[]
    leafOid: string
    intermediateOid: string
    at: number
    gateway: string
  },
): Promise<Cert> {
  const fail = (why: string) =>
    new PaymentsError("BAD_SIGNATURE", `${opts.gateway}: ${why}. Nothing was processed.`, {
      gateway: opts.gateway,
    })
  if (!Array.isArray(x5c) || x5c.length !== 3) throw fail("x5c must hold three certificates")
  let chain: Cert[]
  try {
    chain = x5c.map((c) => parseCert(b64Decode(String(c))))
  } catch (e) {
    throw fail(`unreadable certificate (${e instanceof Error ? e.message : e})`)
  }
  const [leaf, mid, root] = chain as [Cert, Cert, Cert]
  const fp = hexOf(await crypto.subtle.digest("SHA-256", root.der))
  if (!opts.roots.map((r) => r.toLowerCase().replace(/:/g, "")).includes(fp))
    throw fail("the root certificate is not a trusted root")
  for (const c of chain)
    if (opts.at < c.notBefore || opts.at > c.notAfter)
      throw fail("a certificate in the chain is outside its validity period")
  if (!leaf.extensions.has(opts.leafOid)) throw fail(`the leaf lacks extension ${opts.leafOid}`)
  if (!mid.extensions.has(opts.intermediateOid) || !isCa(mid))
    throw fail(`the intermediate is not a CA with extension ${opts.intermediateOid}`)
  for (const [child, parent] of [
    [mid, root],
    [leaf, mid],
  ] as const) {
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: child.sigHash },
      await certKey(parent),
      rawSig(child.sig, parent.curve.size),
      child.tbs,
    )
    if (!ok) throw fail("a certificate in the chain is not signed by its issuer")
  }
  return leaf
}
