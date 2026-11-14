/**
 * File uploads over any `BlobStore`: size and type checked before a signed PUT URL is issued, or streamed through the server with magic-byte sniffing.
 *
 * ```ts
 * const uploads = createUploads({ store: supabaseBlobStore(cfg), maxBytes: 5_000_000,
 *   allowedTypes: ["image/png", "image/jpeg"], afterUpload: (u) => thumbnail.enqueue({ key: u.key }) })
 * const { url, key } = await uploads.presignUpload({ userId }, { name, type, size })
 * // browser PUTs the file to url, then:
 * await uploads.confirmUpload({ userId }, key)
 * ```
 *
 * Keys are per user by default (`<userId>/<random>-<name>`) and every method
 * refuses a key outside the caller's prefix.
 */

import { assertBlobKey, type BlobStore } from "../adapters/index.js"

/** Who is uploading. */
export type UploadContext = { userId: string }

export type UploadFile = { name: string; type: string; size: number }

export type Upload = { key: string; type: string; size: number; userId: string }

export class UploadError extends Error {
  constructor(
    readonly code:
      | "TOO_LARGE"
      | "EMPTY"
      | "TYPE_NOT_ALLOWED"
      | "TYPE_MISMATCH"
      | "BAD_KEY"
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "PRESIGN_UNSUPPORTED",
    message: string,
    /** The HTTP status to answer with. */
    readonly status: 400 | 403 | 404 | 413 | 415 | 501,
  ) {
    super(message)
    this.name = "UploadError"
  }
}

export type UploadsOptions = {
  store: BlobStore
  maxBytes: number
  /** Exact types (`image/png`) or a family (`image/*`). */
  allowedTypes: readonly string[]
  /** Default `<userId>/<uuid>-<safe name>`. Must stay under `canAccess`. */
  keyFor?: (ctx: UploadContext, file: UploadFile) => string
  /** Who may touch a key. Default: keys under `<userId>/`. */
  canAccess?: (ctx: UploadContext, key: string) => boolean
  /** Lifetime of signed URLs. Default 900 (15 min). */
  urlTtlSeconds?: number
  /** Runs after `confirmUpload` and `acceptUpload`: enqueue a follow-up job here. */
  afterUpload?: (upload: Upload) => unknown
}

const SIGNATURES: [string, (b: Uint8Array) => boolean][] = [
  [
    "image/png",
    (b) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x),
  ],
  ["image/jpeg", (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ["image/gif", (b) => /^GIF8[79]a/.test(ascii(b, 0, 6))],
  ["image/webp", (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP"],
  ["application/pdf", (b) => ascii(b, 0, 5) === "%PDF-"],
]

function ascii(b: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...b.subarray(from, to))
}

/** The type the first bytes say, for PNG, JPEG, GIF, WebP and PDF; else undefined. */
export function sniffType(bytes: Uint8Array): string | undefined {
  return SIGNATURES.find(([, test]) => test(bytes))?.[0]
}

const SNIFFABLE = new Set(SIGNATURES.map(([t]) => t))

/** Throws TYPE_MISMATCH when the bytes contradict the declared type (a renamed file). */
export function assertContentMatches(bytes: Uint8Array, declared: string): void {
  const sniffed = sniffType(bytes)
  const type = baseType(declared)
  if (sniffed ? sniffed !== type : SNIFFABLE.has(type))
    throw new UploadError(
      "TYPE_MISMATCH",
      `The file's content (${sniffed ?? "unrecognised"}) does not match its type (${type}).`,
      415,
    )
}

const baseType = (t: string) => (t.split(";")[0] ?? "").trim().toLowerCase()

const safeName = (name: string) =>
  name
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+/, "")
    .slice(-100) || "file"

export function createUploads(options: UploadsOptions) {
  const { store, maxBytes, allowedTypes, urlTtlSeconds = 900 } = options
  const keyFor =
    options.keyFor ??
    ((ctx: UploadContext, file: UploadFile) =>
      `${ctx.userId}/${crypto.randomUUID()}-${safeName(file.name)}`)
  const canAccess =
    options.canAccess ?? ((ctx: UploadContext, key: string) => key.startsWith(`${ctx.userId}/`))

  const checkKey = (ctx: UploadContext, key: string) => {
    try {
      assertBlobKey(key)
    } catch {
      throw new UploadError("BAD_KEY", `Invalid key: ${JSON.stringify(key)}.`, 400)
    }
    if (!ctx.userId || !canAccess(ctx, key))
      throw new UploadError("FORBIDDEN", "That file belongs to someone else.", 403)
  }

  const checkFile = (file: { type: string; size: number }) => {
    if (!Number.isFinite(file.size) || file.size <= 0)
      throw new UploadError("EMPTY", "The file is empty.", 400)
    if (file.size > maxBytes)
      throw new UploadError("TOO_LARGE", `The file is over the ${maxBytes}-byte limit.`, 413)
    const type = baseType(file.type)
    const ok = allowedTypes.some((a) =>
      a.endsWith("/*") ? type.startsWith(a.slice(0, -1)) : a === type,
    )
    if (!ok)
      throw new UploadError(
        "TYPE_NOT_ALLOWED",
        `Files of type ${type || "unknown"} are not allowed. Allowed: ${allowedTypes.join(", ")}.`,
        415,
      )
  }

  const newKey = (ctx: UploadContext, file: UploadFile) => {
    const key = keyFor(ctx, file)
    checkKey(ctx, key)
    return key
  }

  const signed = (key: string, method: "GET" | "PUT") => {
    if (!store.signedUrl)
      throw new UploadError(
        "PRESIGN_UNSUPPORTED",
        "This BlobStore cannot sign URLs (filesystem, R2 binding). Stream the file through the server with acceptUpload(ctx, request) instead.",
        501,
      )
    return store.signedUrl(key, { expiresInSeconds: urlTtlSeconds, method })
  }

  return {
    /** Check name, size and type, then return a signed PUT URL for the browser. */
    async presignUpload(ctx: UploadContext, file: UploadFile) {
      checkFile(file)
      const key = newKey(ctx, file)
      const url = await signed(key, "PUT")
      return {
        key,
        url,
        method: "PUT" as const,
        headers: { "Content-Type": baseType(file.type) },
        expiresInSeconds: urlTtlSeconds,
      }
    },

    /** A signed GET URL for one of the caller's files. */
    async presignDownload(ctx: UploadContext, key: string) {
      checkKey(ctx, key)
      return { url: await signed(key, "GET"), expiresInSeconds: urlTtlSeconds }
    },

    /**
     * After a direct upload: re-check what actually landed (a signed URL
     * cannot enforce size or content), delete it if it fails, then run
     * `afterUpload`.
     */
    async confirmUpload(ctx: UploadContext, key: string): Promise<Upload> {
      checkKey(ctx, key)
      const obj = await store.get(key)
      if (!obj) throw new UploadError("NOT_FOUND", "No file was uploaded at that key.", 404)
      const bytes = new Uint8Array(obj.body)
      const type = baseType(obj.contentType ?? sniffType(bytes) ?? "application/octet-stream")
      try {
        checkFile({ type, size: bytes.byteLength })
        assertContentMatches(bytes, type)
      } catch (e) {
        await store.delete(key)
        throw e
      }
      const upload = { key, type, size: bytes.byteLength, userId: ctx.userId }
      await options.afterUpload?.(upload)
      return upload
    },

    /**
     * Take the file in the request body (raw bytes, `Content-Type` the file's
     * type) and store it, for stores that cannot presign. Rejects early on
     * `Content-Length`, stops reading past `maxBytes`, and sniffs the bytes.
     */
    async acceptUpload(ctx: UploadContext, request: Request, opts: { name?: string } = {}) {
      const type = baseType(request.headers.get("content-type") ?? "")
      const declared = Number(request.headers.get("content-length") ?? 0)
      checkFile({ type, size: declared || 1 })
      if (!request.body) throw new UploadError("EMPTY", "The file is empty.", 400)
      const chunks: Uint8Array[] = []
      let size = 0
      const reader = request.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > maxBytes) {
          await reader.cancel()
          throw new UploadError("TOO_LARGE", `The file is over the ${maxBytes}-byte limit.`, 413)
        }
        chunks.push(value)
      }
      const bytes = new Uint8Array(size)
      let at = 0
      for (const c of chunks) {
        bytes.set(c, at)
        at += c.byteLength
      }
      checkFile({ type, size })
      assertContentMatches(bytes, type)
      const key = newKey(ctx, { name: opts.name ?? "file", type, size })
      await store.put(key, bytes, { contentType: type })
      const upload = { key, type, size, userId: ctx.userId }
      await options.afterUpload?.(upload)
      return upload
    },

    /** Delete one of the caller's files. */
    async remove(ctx: UploadContext, key: string) {
      checkKey(ctx, key)
      await store.delete(key)
    },
  }
}

export type Uploads = ReturnType<typeof createUploads>
