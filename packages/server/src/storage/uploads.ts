/**
 * File uploads over any `BlobStore`: size, type and quota checked before a signed PUT URL is issued, or streamed through the server with magic-byte sniffing and metadata stripping.
 *
 * ```ts
 * const uploads = createUploads({ store: supabaseBlobStore(cfg), kv, maxBytes: 5_000_000,
 *   allowedTypes: ["image/png", "image/jpeg"], afterUpload: (u) => thumbnail.enqueue({ key: u.key }) })
 * const { url, key } = await uploads.presignUpload({ userId }, { name, type, size })
 * // browser PUTs the file to url, then:
 * await uploads.confirmUpload({ userId }, key)
 * ```
 *
 * Keys are per user by default (`<userId>/<random>-<name>`) and every method
 * refuses a key outside the caller's prefix. With a `kv`, uploads also get
 * quotas, abandoned-upload cleanup and content-hash dedupe.
 */

import { assertBlobKey, type BlobStore, type KeyValue } from "../adapters/index.js"
import { defineJob, type Job } from "../jobs/jobs.js"
import { sniffType, stripMetadata } from "./metadata.js"

/** Who is uploading. */
export type UploadContext = { userId: string }

export type UploadFile = { name: string; type: string; size: number }

export type Upload = { key: string; type: string; size: number; userId: string; sha256?: string }

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
      | "QUOTA_EXCEEDED"
      | "PRESIGN_UNSUPPORTED"
      | "RESUMABLE_UNSUPPORTED",
    message: string,
    /** The HTTP status to answer with. */
    readonly status: 400 | 403 | 404 | 413 | 415 | 501,
  ) {
    super(message)
    this.name = "UploadError"
  }
}

/** A `BlobStore` that can run S3-style multipart uploads (`s3BlobStore`). */
export type MultipartBlobStore = BlobStore & {
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

/** Where a TUS client (tus-js-client, Uppy) sends a resumable upload. */
export type TusTarget = {
  endpoint: string
  headers: Record<string, string>
  metadata: Record<string, string>
  chunkSize: number
}

/** A `BlobStore` that can take TUS resumable uploads (`supabaseBlobStore`). */
export type ResumableBlobStore = BlobStore & {
  resumable(key: string, opts: { contentType: string }): Promise<TusTarget>
}

/**
 * Resize bytes into a new image. `cloudflareImagesResizer(env.IMAGES)` on
 * Workers; on Node, wrap the image library you already use.
 */
export type Resizer = (
  bytes: Uint8Array,
  opts: {
    width?: number
    height?: number
    fit?: "scale-down" | "contain" | "cover"
    format: string
  },
) => Promise<{ body: Uint8Array | ArrayBuffer; type: string }>

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
  /**
   * Bookkeeping: pending uploads (for `cleanupAbandoned`), per-key size and
   * hash, quota usage and dedupe counts. Required by `quota` (without
   * `usage`) and `dedupe`. Without it none of those run.
   */
  kv?: KeyValue
  /**
   * Bytes per user. Checked before presign and accept, counted on confirm and
   * accept, released on `remove`. `usage` replaces the kv counter (e.g. a SUM
   * over your files table).
   */
  quota?: { bytes: number; usage?: (ctx: UploadContext) => Promise<number> }
  /** Store identical content once (SHA-256), reference-counted in `kv`. Default false. */
  dedupe?: boolean
  /** Strip EXIF/XMP/IPTC from JPEG, PNG and WebP in `acceptUpload`. Default true. */
  stripMetadata?: boolean
  /** Unconfirmed uploads older than this are removed by `cleanupAbandoned`. Default 24. */
  abandonAfterHours?: number
  /** For `uploads.resize`. */
  resizer?: Resizer
}

const baseType = (t: string) => (t.split(";")[0] ?? "").trim().toLowerCase()

const SNIFFABLE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"])

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

const safeName = (name: string) =>
  name
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+/, "")
    .slice(-100) || "file"

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

type Meta = { size: number; type: string; userId: string; sha256?: string }
type Pending = { key: string; at: number; uploadId?: string }

const MIN_PART = 5 * 1024 * 1024
const PENDING = "signet-upload:pending"

export function createUploads(options: UploadsOptions) {
  const { store, kv, maxBytes, allowedTypes, urlTtlSeconds = 900, abandonAfterHours = 24 } = options
  if (options.dedupe && !kv) throw new Error("createUploads: dedupe needs a kv store.")
  if (options.quota && !options.quota.usage && !kv)
    throw new Error("createUploads: quota needs a kv store or a usage function.")
  const keyFor =
    options.keyFor ??
    ((ctx: UploadContext, file: UploadFile) =>
      `${ctx.userId}/${crypto.randomUUID()}-${safeName(file.name)}`)
  const canAccess =
    options.canAccess ?? ((ctx: UploadContext, key: string) => key.startsWith(`${ctx.userId}/`))

  // --- kv bookkeeping (all no-ops without kv) ---
  // ponytail: counters and the pending list are read-modify-write; two
  // writers at the same instant can lose an update. Fine for per-user
  // traffic; reconcile from your files table if exact numbers matter.
  const readJson = async <T>(key: string, fallback: T): Promise<T> => {
    const raw = kv ? await kv.get(key) : null
    return raw ? (JSON.parse(raw) as T) : fallback
  }
  const writeJson = async (key: string, value: unknown) => {
    await kv?.set(key, JSON.stringify(value))
  }
  const metaKey = (key: string) => `signet-upload:meta:${key}`
  const refKey = (hash: string) => `signet-upload:ref:${hash}`
  const usageKey = (userId: string) => `signet-upload:usage:${userId}`
  const contentKey = (hash: string) => `sha256/${hash}`
  const bump = async (key: string, by: number) => {
    const next = Math.max(0, (await readJson<number>(key, 0)) + by)
    if (next === 0) await kv?.delete(key)
    else await writeJson(key, next)
    return next
  }
  const addPending = (entry: Pending) =>
    kv ? readJson<Pending[]>(PENDING, []).then((l) => writeJson(PENDING, [...l, entry])) : undefined
  const dropPending = async (key: string) => {
    if (!kv) return
    const list = await readJson<Pending[]>(PENDING, [])
    if (list.some((p) => p.key === key))
      await writeJson(
        PENDING,
        list.filter((p) => p.key !== key),
      )
  }

  const usage = async (ctx: UploadContext) =>
    options.quota?.usage ? options.quota.usage(ctx) : readJson<number>(usageKey(ctx.userId), 0)

  const checkQuota = async (ctx: UploadContext, size: number) => {
    if (!options.quota) return
    if ((await usage(ctx)) + size > options.quota.bytes)
      throw new UploadError(
        "QUOTA_EXCEEDED",
        `This would go over your ${options.quota.bytes}-byte storage quota.`,
        413,
      )
  }

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
        "This BlobStore cannot sign URLs (filesystem, R2 binding). Stream the file through the server with acceptUpload(ctx, request) instead, or use s3BlobStore for R2.",
        501,
      )
    return store.signedUrl(key, { expiresInSeconds: urlTtlSeconds, method })
  }

  /** Where a logical key's bytes live: itself, or its shared content key when deduped. */
  const blobKey = async (key: string) => {
    const meta = await readJson<Meta | null>(metaKey(key), null)
    return meta?.sha256 ? contentKey(meta.sha256) : key
  }

  /**
   * Record a stored file: dedupe, quota, metadata, pending list, afterUpload.
   * `landedAt` is where the bytes are now (the key itself for direct uploads),
   * or undefined when they still need writing.
   */
  const finish = async (
    ctx: UploadContext,
    key: string,
    bytes: Uint8Array,
    type: string,
    landedAt: string | undefined,
  ): Promise<Upload> => {
    const upload: Upload = { key, type, size: bytes.byteLength, userId: ctx.userId }
    if (options.dedupe) {
      const hash = await sha256Hex(bytes)
      upload.sha256 = hash
      if ((await readJson<number>(refKey(hash), 0)) === 0)
        await store.put(contentKey(hash), bytes, { contentType: type })
      await bump(refKey(hash), 1)
      if (landedAt) await store.delete(landedAt)
    } else if (!landedAt) {
      await store.put(key, bytes, { contentType: type })
    }
    if (kv) {
      const meta: Meta = { size: upload.size, type, userId: ctx.userId }
      if (upload.sha256) meta.sha256 = upload.sha256
      await writeJson(metaKey(key), meta)
      if (options.quota && !options.quota.usage) await bump(usageKey(ctx.userId), upload.size)
      await dropPending(key)
    }
    await options.afterUpload?.(upload)
    return upload
  }

  const uploads = {
    /** Check name, size, type and quota, then return a signed PUT URL for the browser. */
    async presignUpload(ctx: UploadContext, file: UploadFile) {
      checkFile(file)
      await checkQuota(ctx, file.size)
      const key = newKey(ctx, file)
      const url = await signed(key, "PUT")
      await addPending({ key, at: Date.now() })
      return {
        key,
        url,
        method: "PUT" as const,
        headers: { "Content-Type": baseType(file.type) },
        expiresInSeconds: urlTtlSeconds,
      }
    },

    /**
     * Start a resumable upload for a big file. On an S3-compatible store:
     * presigned part URLs (PUT each `partSize` slice, keep each response's
     * ETag, then `completeMultipart`). On Supabase: a TUS target (then
     * `confirmUpload`). Same checks as `presignUpload`.
     */
    async startResumable(ctx: UploadContext, file: UploadFile, opts: { partSize?: number } = {}) {
      checkFile(file)
      await checkQuota(ctx, file.size)
      const key = newKey(ctx, file)
      const type = baseType(file.type)
      if ("multipart" in store) {
        const mp = (store as MultipartBlobStore).multipart
        const partSize = Math.max(
          MIN_PART,
          opts.partSize ?? MIN_PART,
          Math.ceil(file.size / 10_000),
        )
        const uploadId = await mp.create(key, type)
        const count = Math.max(1, Math.ceil(file.size / partSize))
        const partUrls = await Promise.all(
          Array.from({ length: count }, (_, i) => mp.partUrl(key, uploadId, i + 1, urlTtlSeconds)),
        )
        await addPending({ key, at: Date.now(), uploadId })
        return { kind: "multipart" as const, key, uploadId, partSize, partUrls }
      }
      if ("resumable" in store) {
        const target = await (store as ResumableBlobStore).resumable(key, { contentType: type })
        await addPending({ key, at: Date.now() })
        return { kind: "tus" as const, key, ...target }
      }
      throw new UploadError(
        "RESUMABLE_UNSUPPORTED",
        "This BlobStore has no resumable uploads. Use s3BlobStore (S3, R2, MinIO) or supabaseBlobStore.",
        501,
      )
    },

    /** Finish a multipart upload, then run the same checks as `confirmUpload`. */
    async completeMultipart(
      ctx: UploadContext,
      key: string,
      uploadId: string,
      parts: { partNumber: number; etag: string }[],
    ): Promise<Upload> {
      checkKey(ctx, key)
      if (!("multipart" in store))
        throw new UploadError(
          "RESUMABLE_UNSUPPORTED",
          "This BlobStore has no multipart uploads.",
          501,
        )
      await (store as MultipartBlobStore).multipart.complete(key, uploadId, parts)
      return uploads.confirmUpload(ctx, key)
    },

    /** A signed GET URL for one of the caller's files. */
    async presignDownload(ctx: UploadContext, key: string) {
      checkKey(ctx, key)
      return { url: await signed(await blobKey(key), "GET"), expiresInSeconds: urlTtlSeconds }
    },

    /** The bytes of one of the caller's files, or null. For jobs (thumbnails, scans). */
    async read(ctx: UploadContext, key: string) {
      checkKey(ctx, key)
      return store.get(await blobKey(key))
    },

    /**
     * After a direct upload: re-check what actually landed (a signed URL
     * cannot enforce size or content), delete it if it fails, then record it
     * and run `afterUpload`.
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
        await checkQuota(ctx, bytes.byteLength)
      } catch (e) {
        await store.delete(key)
        await dropPending(key)
        throw e
      }
      return finish(ctx, key, bytes, type, key)
    },

    /**
     * Take the file in the request body (raw bytes, `Content-Type` the file's
     * type) and store it, for stores that cannot presign. Rejects early on
     * `Content-Length`, stops reading past `maxBytes`, sniffs the bytes, and
     * strips image metadata (`stripMetadata: false` to keep it).
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
      let bytes = new Uint8Array(size)
      let at = 0
      for (const c of chunks) {
        bytes.set(c, at)
        at += c.byteLength
      }
      checkFile({ type, size })
      assertContentMatches(bytes, type)
      if (options.stripMetadata !== false) bytes = new Uint8Array(stripMetadata(bytes))
      await checkQuota(ctx, bytes.byteLength)
      const key = newKey(ctx, { name: opts.name ?? "file", type, size })
      return finish(ctx, key, bytes, type, undefined)
    },

    /** Delete one of the caller's files, releasing its quota and dedupe reference. */
    async remove(ctx: UploadContext, key: string) {
      checkKey(ctx, key)
      const meta = await readJson<Meta | null>(metaKey(key), null)
      if (meta?.sha256) {
        if ((await bump(refKey(meta.sha256), -1)) === 0) await store.delete(contentKey(meta.sha256))
      } else {
        await store.delete(key)
      }
      if (meta) {
        if (options.quota && !options.quota.usage) await bump(usageKey(meta.userId), -meta.size)
        await kv?.delete(metaKey(key))
      }
    },

    /** Bytes counted against the caller's quota. */
    usage,

    /**
     * Delete uploads presigned (or started) but never confirmed within
     * `abandonAfterHours`, aborting unfinished multipart uploads. Returns how
     * many. Run it from `abandonedUploadsJob` on a schedule. Needs `kv`.
     */
    async cleanupAbandoned(now: number = Date.now()): Promise<number> {
      if (!kv) return 0
      const cutoff = now - abandonAfterHours * 3_600_000
      const list = await readJson<Pending[]>(PENDING, [])
      const old = list.filter((p) => p.at <= cutoff)
      for (const p of old) {
        if (p.uploadId && "multipart" in store)
          await (store as MultipartBlobStore).multipart.abort(p.key, p.uploadId).catch(() => {})
        await store.delete(p.key)
      }
      if (old.length)
        await writeJson(
          PENDING,
          (await readJson<Pending[]>(PENDING, [])).filter((p) => p.at > cutoff),
        )
      return old.length
    },

    /**
     * Resize one of the caller's images with `resizer` and store it beside the
     * original as `<key>@<width>w` (or `@<height>h`). Run it from a job after
     * upload. Variants are not counted in the quota or removed with the original.
     */
    async resize(
      ctx: UploadContext,
      key: string,
      opts: {
        width?: number
        height?: number
        fit?: "scale-down" | "contain" | "cover"
        format?: string
      },
    ) {
      if (!options.resizer) throw new Error("createUploads: resize needs a resizer.")
      const obj = await uploads.read(ctx, key)
      if (!obj) throw new UploadError("NOT_FOUND", "No file at that key.", 404)
      const out = await options.resizer(new Uint8Array(obj.body), {
        ...opts,
        format: opts.format ?? "image/webp",
      })
      const variant = `${key}@${opts.width ? `${opts.width}w` : `${opts.height ?? 0}h`}`
      checkKey(ctx, variant)
      const body = out.body instanceof Uint8Array ? out.body : new Uint8Array(out.body)
      await store.put(variant, body, { contentType: out.type })
      return { key: variant, type: out.type, size: body.byteLength }
    },
  }
  return uploads
}

export type Uploads = ReturnType<typeof createUploads>

/** Accepts `{}` only: the input of jobs that take none, without importing zod here. */
const emptyInput = {
  safeParse: (v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? { success: true as const, data: {} }
      : { success: false as const, error: { issues: [{ message: "Expected an object" }] } },
}

/**
 * The scheduled job that removes abandoned uploads. Register it and schedule it:
 * `createJobs({ jobs: [cleanup], schedules: [defineSchedule({ name: "uploads-cleanup", cron: "17 * * * *", job: cleanup })] })`.
 */
export function abandonedUploadsJob(
  uploads: Pick<Uploads, "cleanupAbandoned">,
  name = "signet-uploads-cleanup",
): Job {
  return defineJob({
    name,
    input: emptyInput as never,
    run: async () => {
      await uploads.cleanupAbandoned()
    },
  }) as Job
}

/** The subset of a Cloudflare Images binding (`env.IMAGES`) this uses. */
export type ImagesBindingLike = {
  input(stream: ReadableStream<Uint8Array> | Uint8Array): {
    transform(t: Record<string, unknown>): ReturnType<ImagesBindingLike["input"]>
    output(o: { format: string; quality?: number }): Promise<{ response(): Response }>
  }
}

/** A `Resizer` over the Cloudflare Images binding. */
export function cloudflareImagesResizer(images: ImagesBindingLike): Resizer {
  return async (bytes, { width, height, fit = "scale-down", format }) => {
    const t: Record<string, unknown> = { fit }
    if (width) t.width = width
    if (height) t.height = height
    const res = (await images.input(bytes).transform(t).output({ format })).response()
    return { body: await res.arrayBuffer(), type: res.headers.get("content-type") ?? format }
  }
}
