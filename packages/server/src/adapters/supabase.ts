/**
 * Supabase Storage as a `BlobStore`, over its REST API with plain fetch.
 *
 * Uses the service role key, which bypasses row-level security: call it from
 * the server only, and never send the key to a browser. Hand browsers a
 * `signedUrl` instead.
 */

import { assertBlobKey, type BlobStore } from "./index.js"

export type SupabaseStorageConfig = {
  /** Project URL, e.g. `https://abc.supabase.co`. */
  url: string
  serviceRoleKey: string
  bucket: string
  /**
   * The project's publishable (anon) key, sent as `apikey` by TUS clients.
   * Only needed for `resumable`; never the service role key.
   */
  publishableKey?: string
}

export type SupabaseBlobStore = BlobStore & {
  signedUrl: NonNullable<BlobStore["signedUrl"]>
  /**
   * A TUS target for a resumable upload of `key` (tus-js-client, Uppy): the
   * `/upload/resumable/sign` endpoint with a signed upload token as
   * `x-signature`, so the browser never sees the service role key. Supabase
   * requires 6 MiB chunks. Confirm the upload afterwards like any other.
   */
  resumable(
    key: string,
    opts: { contentType: string },
  ): Promise<{
    endpoint: string
    headers: Record<string, string>
    metadata: Record<string, string>
    chunkSize: number
  }>
}

export function supabaseBlobStore(cfg: SupabaseStorageConfig): SupabaseBlobStore {
  const base = `${cfg.url.replace(/\/+$/, "")}/storage/v1`
  const auth = { Authorization: `Bearer ${cfg.serviceRoleKey}`, apikey: cfg.serviceRoleKey }
  const path = (key: string) => {
    assertBlobKey(key)
    return `${encodeURIComponent(cfg.bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`
  }
  const fail = async (what: string, res: Response): Promise<never> => {
    throw new Error(`Supabase Storage ${what} ${res.status}: ${await res.text().catch(() => "")}`)
  }
  const sign = async (route: string, key: string, init: RequestInit) => {
    const res = await fetch(`${base}/object/${route}/${path(key)}`, { method: "POST", ...init })
    if (!res.ok) return fail(route, res)
    return (await res.json()) as { signedURL?: string; url?: string }
  }

  return {
    async put(key, body, opts) {
      const res = await fetch(`${base}/object/${path(key)}`, {
        method: "POST",
        headers: {
          ...auth,
          "x-upsert": "true",
          "Content-Type": opts?.contentType ?? "application/octet-stream",
        },
        body: body as BodyInit,
      })
      if (!res.ok) await fail("upload", res)
    },
    async get(key) {
      const res = await fetch(`${base}/object/${path(key)}`, { headers: auth })
      if (res.ok) {
        return {
          body: await res.arrayBuffer(),
          contentType: res.headers.get("content-type") ?? undefined,
        }
      }
      // Older Storage versions answer a missing object with 400 and statusCode "404" in the body.
      const text = await res.text().catch(() => "")
      if (res.status === 404 || /"statusCode":\s*"404"/.test(text)) return null
      throw new Error(`Supabase Storage download ${res.status}: ${text}`)
    },
    async delete(key) {
      assertBlobKey(key)
      const res = await fetch(`${base}/object/${encodeURIComponent(cfg.bucket)}`, {
        method: "DELETE",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ prefixes: [key] }),
      })
      if (!res.ok) await fail("delete", res)
    },
    /**
     * GET: a download URL valid for `expiresInSeconds`. PUT: an upload URL
     * the client PUTs the file to; Supabase fixes its lifetime (two hours) and
     * ignores `expiresInSeconds`.
     */
    async signedUrl(key, { expiresInSeconds, method = "GET" }) {
      if (method === "PUT") {
        const data = await sign("upload/sign", key, { headers: { ...auth, "x-upsert": "true" } })
        if (!data.url) throw new Error("Supabase Storage upload/sign: no url in response")
        return `${base}${data.url}`
      }
      const data = await sign("sign", key, {
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ expiresIn: expiresInSeconds }),
      })
      if (!data.signedURL) throw new Error("Supabase Storage sign: no signedURL in response")
      return `${base}${data.signedURL}`
    },
    async resumable(key, { contentType }) {
      const data = await sign("upload/sign", key, { headers: { ...auth, "x-upsert": "true" } })
      const token = data.url && new URL(data.url, base).searchParams.get("token")
      if (!token) throw new Error("Supabase Storage upload/sign: no token in response")
      return {
        endpoint: `${base}/upload/resumable/sign`,
        headers: {
          "x-signature": token,
          "x-upsert": "true",
          ...(cfg.publishableKey ? { apikey: cfg.publishableKey } : {}),
        },
        metadata: { bucketName: cfg.bucket, objectName: key, contentType },
        chunkSize: 6 * 1024 * 1024,
      }
    },
  }
}
