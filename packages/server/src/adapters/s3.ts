/**
 * S3-compatible storage (AWS S3, Cloudflare R2's S3 API, MinIO) as a `BlobStore` with presigned URLs and multipart uploads, signed with SigV4 over Web Crypto.
 *
 * Every request, the server's own included, goes out as a presigned URL
 * (query-string SigV4, `UNSIGNED-PAYLOAD`), so there is one signer and no
 * SDK. Path-style URLs by default (`<endpoint>/<bucket>/<key>`), which R2 and
 * MinIO expect; `virtualHosted: true` for `<bucket>.<host>`.
 */

import { assertBlobKey, type BlobStore } from "./index.js"

export type S3Config = {
  /** e.g. `https://s3.eu-west-1.amazonaws.com`, `https://<account>.r2.cloudflarestorage.com`. */
  endpoint: string
  /** `auto` for R2. */
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  virtualHosted?: boolean
  /** For tests. Default now. */
  now?: () => Date
}

const enc = new TextEncoder()
const hex = (b: ArrayBuffer) =>
  [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("")
const sha256 = async (s: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)))
async function hmac(key: ArrayBuffer | Uint8Array<ArrayBuffer>, data: string) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ])
  return crypto.subtle.sign("HMAC", k, enc.encode(data))
}
/** RFC 3986 encoding, as SigV4 wants it. */
const rfc3986 = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

export type S3BlobStore = BlobStore & {
  signedUrl: NonNullable<BlobStore["signedUrl"]>
  /** Presign any request: `query` adds sub-resources such as `uploads` or `partNumber`. */
  presign(
    method: string,
    key: string,
    expiresInSeconds: number,
    query?: Record<string, string>,
  ): Promise<string>
  multipart: {
    create(key: string, contentType: string): Promise<string>
    partUrl(
      key: string,
      uploadId: string,
      partNumber: number,
      expiresInSeconds: number,
    ): Promise<string>
    complete(
      key: string,
      uploadId: string,
      parts: { partNumber: number; etag: string }[],
    ): Promise<void>
    abort(key: string, uploadId: string): Promise<void>
  }
}

export function s3BlobStore(cfg: S3Config): S3BlobStore {
  const base = new URL(cfg.endpoint)
  const host = cfg.virtualHosted ? `${cfg.bucket}.${base.host}` : base.host
  const pathOf = (key: string) => {
    assertBlobKey(key)
    const k = key.split("/").map(rfc3986).join("/")
    return cfg.virtualHosted ? `/${k}` : `/${rfc3986(cfg.bucket)}/${k}`
  }

  const presign: S3BlobStore["presign"] = async (method, key, expiresInSeconds, query = {}) => {
    const now = (cfg.now ?? (() => new Date()))()
    const amzDate = now
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "")
    const day = amzDate.slice(0, 8)
    const scope = `${day}/${cfg.region}/s3/aws4_request`
    const params: Record<string, string> = {
      ...query,
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `${cfg.accessKeyId}/${scope}`,
      "X-Amz-Date": amzDate,
      "X-Amz-Expires": String(Math.min(604_800, Math.max(1, Math.floor(expiresInSeconds)))),
      "X-Amz-SignedHeaders": "host",
    }
    const qs = Object.keys(params)
      .sort()
      .map((k) => `${rfc3986(k)}=${rfc3986(params[k] as string)}`)
      .join("&")
    const path = pathOf(key)
    const canonical = [method, path, qs, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n")
    const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256(canonical)].join("\n")
    let k = await hmac(enc.encode(`AWS4${cfg.secretAccessKey}`), day)
    for (const part of [cfg.region, "s3", "aws4_request"]) k = await hmac(k, part)
    const signature = hex(await hmac(k, toSign))
    return `${base.protocol}//${host}${path}?${qs}&X-Amz-Signature=${signature}`
  }

  const call = async (
    method: string,
    key: string,
    query?: Record<string, string>,
    init: RequestInit = {},
  ) => {
    const res = await fetch(await presign(method, key, 300, query), { method, ...init })
    if (!res.ok && res.status !== 404)
      throw new Error(
        `S3 ${method} ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`,
      )
    return res
  }

  return {
    presign,
    async put(key, body, opts) {
      await call("PUT", key, undefined, {
        body: body as BodyInit,
        headers: { "Content-Type": opts?.contentType ?? "application/octet-stream" },
      })
    },
    async get(key) {
      const res = await call("GET", key)
      if (res.status === 404) return null
      return {
        body: await res.arrayBuffer(),
        contentType: res.headers.get("content-type") ?? undefined,
      }
    },
    async delete(key) {
      await call("DELETE", key)
    },
    signedUrl: (key, { expiresInSeconds, method = "GET" }) =>
      presign(method, key, expiresInSeconds),
    multipart: {
      async create(key, contentType) {
        const res = await call(
          "POST",
          key,
          { uploads: "" },
          { headers: { "Content-Type": contentType } },
        )
        const id = (await res.text()).match(/<UploadId>([^<]+)<\/UploadId>/)?.[1]
        if (!id) throw new Error("S3 CreateMultipartUpload: no UploadId in response")
        return id
      },
      partUrl: (key, uploadId, partNumber, expiresInSeconds) =>
        presign("PUT", key, expiresInSeconds, { partNumber: String(partNumber), uploadId }),
      async complete(key, uploadId, parts) {
        const esc = (s: string) =>
          s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;")
        const xml = `<CompleteMultipartUpload>${[...parts]
          .sort((a, b) => a.partNumber - b.partNumber)
          .map(
            (p) =>
              `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${esc(p.etag)}</ETag></Part>`,
          )
          .join("")}</CompleteMultipartUpload>`
        const res = await call(
          "POST",
          key,
          { uploadId },
          { body: xml, headers: { "Content-Type": "application/xml" } },
        )
        // S3 can answer 200 with an <Error> body when completion fails late.
        const text = await res.text()
        if (res.status === 404 || /<Error>/.test(text))
          throw new Error(`S3 CompleteMultipartUpload failed: ${text.slice(0, 300)}`)
      },
      async abort(key, uploadId) {
        await call("DELETE", key, { uploadId })
      },
    },
  }
}
