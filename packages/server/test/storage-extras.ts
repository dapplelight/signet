import { type BlobStore, memoryKv } from "../src/adapters/index"
import { s3BlobStore } from "../src/adapters/s3"
import { supabaseBlobStore } from "../src/adapters/supabase"
import { createTestJobs } from "../src/jobs/index"
import {
  abandonedUploadsJob,
  cloudflareImagesResizer,
  createUploads,
  type ImagesBindingLike,
  sniffType,
  stripMetadata,
} from "../src/storage/index"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}
const code = async (fn: () => Promise<unknown>) => {
  try {
    await fn()
    return "none"
  } catch (e) {
    return (e as { code?: string }).code ?? String(e)
  }
}
const te = new TextEncoder()
const bytesOf = (...parts: (number[] | string | Uint8Array)[]) => {
  const arrs = parts.map((p) =>
    typeof p === "string" ? te.encode(p) : p instanceof Uint8Array ? p : new Uint8Array(p),
  )
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0))
  let at = 0
  for (const a of arrs) {
    out.set(a, at)
    at += a.length
  }
  return out
}
const has = (b: Uint8Array, s: string) => new TextDecoder("latin1").decode(b).includes(s)
const be16 = (n: number) => [n >> 8, n & 0xff]
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
const le32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]
function crc32(b: Uint8Array) {
  let c = ~0
  for (const x of b) {
    c ^= x
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
  }
  return ~c >>> 0
}
const pngChunk = (type: string, data: Uint8Array | string) => {
  const d = typeof data === "string" ? te.encode(data) : data
  return bytesOf(be32(d.length), type, d, be32(crc32(bytesOf(type, d))))
}

// --- fixtures carrying GPS tags ---
const exifGps = bytesOf("Exif\0\0", "MM\0*", [0, 0, 0, 8], "GPSLatitude 51.5 GPSLongitude -0.12")
const JPEG = bytesOf(
  [0xff, 0xd8],
  [0xff, 0xe0],
  be16(16),
  "JFIF\0",
  [1, 2, 0, 0, 1, 0, 1, 0, 0],
  [0xff, 0xe1],
  be16(exifGps.length + 2),
  exifGps,
  [0xff, 0xe1],
  be16(2 + 29),
  "http://ns.adobe.com/xap/1.0/\0",
  [0xff, 0xfe],
  be16(2 + 7),
  "comment",
  [0xff, 0xda],
  be16(8),
  [1, 1, 0, 0, 63, 0],
  [0x12, 0x34, 0xff, 0x00, 0x56],
  [0xff, 0xd9],
)
const IHDR = pngChunk("IHDR", bytesOf(be32(1), be32(1), [8, 2, 0, 0, 0]))
const IDAT = pngChunk("IDAT", bytesOf([0x78, 0x9c, 0x63, 0, 0, 0, 2, 0, 1]))
const PNG = bytesOf(
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  IHDR,
  pngChunk("eXIf", exifGps.subarray(6)),
  pngChunk("tEXt", "Comment\0GPSLatitude 51.5"),
  IDAT,
  pngChunk("IEND", ""),
)
const vp8x = bytesOf("VP8X", le32(10), [0x0c | 0x10, 0, 0, 0], [0, 0, 0], [0, 0, 0])
const vp8 = bytesOf("VP8 ", le32(5), [1, 2, 3, 4, 5], [0]) // odd: padded
const exifData = exifGps.subarray(6)
const exifChunk = bytesOf("EXIF", le32(exifData.length), exifData, exifData.length % 2 ? [0] : [])
const xmpChunk = bytesOf("XMP ", le32(4), "<x/>")
const webpBody = bytesOf("WEBP", vp8x, vp8, exifChunk, xmpChunk)
const WEBP = bytesOf("RIFF", le32(webpBody.length), webpBody)

console.log("stripMetadata")
{
  const j = stripMetadata(JPEG)
  ok("jpeg: still a jpeg", sniffType(j) === "image/jpeg")
  ok(
    "jpeg: no EXIF, GPS, XMP or comment",
    !has(j, "Exif") && !has(j, "GPS") && !has(j, "adobe") && !has(j, "comment"),
  )
  ok("jpeg: JFIF and scan data kept", has(j, "JFIF") && j.at(-3) === 0x56 && j.at(-1) === 0xd9)
  ok(
    "jpeg: smaller by the stripped segments",
    j.length === JPEG.length - (exifGps.length + 4) - 33 - 11,
  )

  const p = stripMetadata(PNG)
  ok("png: no eXIf/tEXt/GPS", !has(p, "eXIf") && !has(p, "tEXt") && !has(p, "GPS"))
  ok(
    "png: IHDR, IDAT, IEND kept byte for byte",
    has(p, "IHDR") &&
      has(p, "IDAT") &&
      has(p, "IEND") &&
      p.length === 8 + IHDR.length + IDAT.length + 12,
  )

  const w = stripMetadata(WEBP)
  const view = new DataView(w.buffer, w.byteOffset, w.byteLength)
  ok("webp: no EXIF/XMP/GPS", !has(w, "EXIF") && !has(w, "XMP ") && !has(w, "GPS"))
  ok("webp: RIFF size fixed", view.getUint32(4, true) === w.length - 8)
  ok(
    "webp: VP8X exif/xmp flags cleared, others kept",
    ((w[20] as number) & 0x0c) === 0 && ((w[20] as number) & 0x10) === 0x10,
  )
  ok(
    "webp: image chunk kept with padding",
    has(w, "VP8 ") && w.length === 12 + vp8x.length + vp8.length,
  )

  const pdf = te.encode("%PDF-1.7 GPS")
  ok("other types unchanged", stripMetadata(pdf) === pdf)
  const broken = bytesOf([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff])
  ok("malformed unchanged", stripMetadata(broken) === broken)
}

console.log("stripMetadata keeps orientation")
{
  /** A TIFF block: Make, Orientation, a GPS IFD pointer, then camera and GPS data. */
  const tiff = (le: boolean, orientation: number | undefined) => {
    const u16 = (n: number) => (le ? [n & 0xff, n >> 8] : be16(n))
    const u32 = (n: number) => (le ? le32(n) : be32(n))
    const entries: number[][] = [[...u16(0x010f), ...u16(2), ...u32(6), ...u32(0)]]
    if (orientation) entries.push([...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0, 0])
    entries.push([...u16(0x8825), ...u16(4), ...u32(1), ...u32(0)])
    const dataAt = 8 + 2 + entries.length * 12 + 4
    entries[0]!.splice(8, 4, ...u32(dataAt)) // Make's offset
    entries.at(-1)!.splice(8, 4, ...u32(dataAt + 6)) // GPS IFD's offset
    return bytesOf(
      le ? "II" : "MM",
      u16(42),
      u32(8),
      u16(entries.length),
      ...entries,
      u32(0),
      "Camra\0",
      u16(1),
      u16(2),
      u16(5),
      u32(3),
      u32(0),
      "GPSLatitude 51.5",
    )
  }
  /** Orientation read back independently of the stripper. */
  const orientationIn = (b: Uint8Array) => {
    const s = new TextDecoder("latin1").decode(b)
    const at = Math.max(s.indexOf("MM\0*"), s.indexOf("II*\0"))
    if (at < 0) return undefined
    const t = b.subarray(at)
    const le = t[0] === 0x49
    const v = new DataView(t.buffer, t.byteOffset, t.byteLength)
    const ifd = v.getUint32(4, le)
    for (let n = 0; n < v.getUint16(ifd, le); n++) {
      const e = ifd + 2 + n * 12
      if (v.getUint16(e, le) === 0x0112) return v.getUint16(e + 8, le)
    }
    return undefined
  }
  const jpegWith = (t: Uint8Array) =>
    bytesOf(
      [0xff, 0xd8],
      [0xff, 0xe1],
      be16(t.length + 8),
      "Exif\0\0",
      t,
      [0xff, 0xda],
      be16(8),
      [1, 1, 0, 0, 63, 0],
      [0x12, 0xff, 0xd9],
    )
  for (const le of [false, true]) {
    const src = jpegWith(tiff(le, 6))
    ok(
      `fixture has orientation 6 and GPS (${le ? "II" : "MM"})`,
      orientationIn(src) === 6 && has(src, "GPS") && has(src, "Camra"),
    )
    const out = stripMetadata(src)
    ok(
      `jpeg keeps orientation 6, drops GPS and camera (${le ? "II" : "MM"})`,
      orientationIn(out) === 6 && !has(out, "GPS") && !has(out, "Camra") && has(out, "Exif"),
    )
    ok("jpeg still ends with its scan", out.at(-1) === 0xd9 && sniffType(out) === "image/jpeg")
  }
  const plain = stripMetadata(jpegWith(tiff(false, undefined)))
  ok("jpeg without orientation: no EXIF at all", !has(plain, "Exif") && !has(plain, "GPS"))

  const pngWith = (t: Uint8Array) =>
    bytesOf(
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      IHDR,
      pngChunk("eXIf", t),
      IDAT,
      pngChunk("IEND", ""),
    )
  const p = stripMetadata(pngWith(tiff(true, 6)))
  ok(
    "png keeps orientation 6 in eXIf, no GPS",
    orientationIn(p) === 6 && has(p, "eXIf") && !has(p, "GPS"),
  )
  const exifAt = new TextDecoder("latin1").decode(p).indexOf("eXIf")
  const exifChunkOut = p.subarray(exifAt - 4, exifAt + 4 + 26 + 4)
  const crcOut = new DataView(exifChunkOut.buffer, exifChunkOut.byteOffset).getUint32(34)
  ok("png eXIf CRC valid", crcOut === crc32(p.subarray(exifAt, exifAt + 4 + 26)))
  ok(
    "png without orientation: no eXIf",
    !has(stripMetadata(pngWith(tiff(true, undefined))), "eXIf"),
  )

  const webpWith = (t: Uint8Array) => {
    const body = bytesOf("WEBP", vp8x, vp8, "EXIF", le32(t.length), t, t.length % 2 ? [0] : [])
    return bytesOf("RIFF", le32(body.length), body)
  }
  const w = stripMetadata(webpWith(tiff(false, 6)))
  ok("webp keeps orientation 6, no GPS", orientationIn(w) === 6 && has(w, "EXIF") && !has(w, "GPS"))
  ok("webp EXIF flag on, XMP flag off", ((w[20] as number) & 0x0c) === 0x08)
  ok("webp RIFF size", new DataView(w.buffer, w.byteOffset).getUint32(4, true) === w.length - 8)
  const wPlain = stripMetadata(webpWith(tiff(false, undefined)))
  ok(
    "webp without orientation: no EXIF, flag off",
    !has(wPlain, "EXIF") && ((wPlain[20] as number) & 0x08) === 0,
  )
}

function memStore(sign = true) {
  const files = new Map<string, { body: ArrayBuffer; contentType?: string }>()
  const store: BlobStore = {
    async put(key, body, opts) {
      const b = typeof body === "string" ? te.encode(body) : new Uint8Array(body)
      files.set(key, { body: b.slice().buffer, contentType: opts?.contentType })
    },
    get: async (key) => files.get(key) ?? null,
    delete: async (key) => void files.delete(key),
    ...(sign
      ? {
          signedUrl: async (key: string, o: { method?: string }) =>
            `https://s.example/${o.method ?? "GET"}/${key}`,
        }
      : {}),
  }
  return { store, files }
}
const put = (body: Uint8Array, type: string) =>
  new Request("https://app.example/u", {
    method: "PUT",
    headers: { "content-type": type },
    body: body as Uint8Array<ArrayBuffer>,
  })
const alice = { userId: "alice" }
const bob = { userId: "bob" }

// What acceptUpload stores for PNG: the same image without its metadata.
const CLEAN = stripMetadata(PNG) as Uint8Array<ArrayBuffer>

console.log("acceptUpload strips metadata")
{
  const { store, files } = memStore(false)
  const uploads = createUploads({ store, maxBytes: 10_000, allowedTypes: ["image/*"] })
  const u = await uploads.acceptUpload(alice, put(JPEG, "image/jpeg"))
  const stored = new Uint8Array(files.get(u.key)!.body)
  ok(
    "stored without GPS",
    !has(stored, "GPS") && u.size === stored.length && sniffType(stored) === "image/jpeg",
  )
  const keep = createUploads({
    store,
    maxBytes: 10_000,
    allowedTypes: ["image/*"],
    stripMetadata: false,
  })
  const k = await keep.acceptUpload(alice, put(JPEG, "image/jpeg"))
  ok("opt out keeps it", has(new Uint8Array(files.get(k.key)!.body), "GPS"))
}

console.log("quotas")
{
  const { store } = memStore()
  const kv = memoryKv()
  const uploads = createUploads({
    store,
    kv,
    maxBytes: 1000,
    allowedTypes: ["image/png"],
    quota: { bytes: CLEAN.length * 2 },
  })
  const a = await uploads.presignUpload(alice, {
    name: "a.png",
    type: "image/png",
    size: CLEAN.length,
  })
  await store.put(a.key, CLEAN, { contentType: "image/png" })
  await uploads.confirmUpload(alice, a.key)
  ok("usage counted on confirm", (await uploads.usage(alice)) === CLEAN.length)
  await uploads.acceptUpload(alice, put(CLEAN, "image/png"))
  ok("usage counted on accept", (await uploads.usage(alice)) === CLEAN.length * 2)
  ok(
    "over quota refused before presign",
    (await code(() =>
      uploads.presignUpload(alice, { name: "c.png", type: "image/png", size: 1 }),
    )) === "QUOTA_EXCEEDED",
  )
  ok(
    "over quota refused on accept",
    (await code(() => uploads.acceptUpload(alice, put(CLEAN, "image/png")))) === "QUOTA_EXCEEDED",
  )
  ok(
    "other users unaffected",
    (await code(() =>
      uploads.presignUpload(bob, { name: "c.png", type: "image/png", size: 10 }),
    )) === "none",
  )
  await uploads.remove(alice, a.key)
  ok("remove releases quota", (await uploads.usage(alice)) === CLEAN.length)
  const custom = createUploads({
    store,
    maxBytes: 1000,
    allowedTypes: ["image/png"],
    quota: { bytes: 100, usage: async () => 95 },
  })
  ok(
    "usage function",
    (await code(() =>
      custom.presignUpload(alice, { name: "x.png", type: "image/png", size: 10 }),
    )) === "QUOTA_EXCEEDED",
  )
  ok(
    "quota without kv or usage refused",
    (await code(async () =>
      createUploads({ store, maxBytes: 1, allowedTypes: [], quota: { bytes: 1 } }),
    )) !== "none",
  )
}

console.log("content-hash dedupe")
{
  const { store, files } = memStore()
  const kv = memoryKv()
  const uploads = createUploads({
    store,
    kv,
    maxBytes: 1000,
    allowedTypes: ["image/png"],
    dedupe: true,
  })
  const a = await uploads.acceptUpload(alice, put(CLEAN, "image/png"))
  const b = await uploads.acceptUpload(bob, put(CLEAN, "image/png"))
  const p = await uploads.presignUpload(bob, {
    name: "c.png",
    type: "image/png",
    size: CLEAN.length,
  })
  await store.put(p.key, CLEAN, { contentType: "image/png" })
  const c = await uploads.confirmUpload(bob, p.key)
  const blobs = [...files.keys()]
  ok("one copy stored", blobs.length === 1 && blobs[0] === `sha256/${a.sha256}`, blobs)
  ok("same hash for all three", a.sha256 === b.sha256 && b.sha256 === c.sha256)
  ok(
    "download resolves to the content",
    (await uploads.presignDownload(bob, b.key)).url.endsWith(`sha256/${a.sha256}`),
  )
  ok("read resolves", (await uploads.read(alice, a.key))?.body.byteLength === CLEAN.length)
  ok("still per-user", (await code(() => uploads.read(alice, b.key))) === "FORBIDDEN")
  await uploads.remove(alice, a.key)
  await uploads.remove(bob, b.key)
  ok("kept while referenced", files.size === 1)
  await uploads.remove(bob, c.key)
  ok("deleted at zero references", files.size === 0)
}

console.log("abandoned uploads")
{
  const { store, files } = memStore()
  const kv = memoryKv()
  const uploads = createUploads({
    store,
    kv,
    maxBytes: 1000,
    allowedTypes: ["image/png"],
    abandonAfterHours: 6,
  })
  const done = await uploads.presignUpload(alice, {
    name: "a.png",
    type: "image/png",
    size: PNG.length,
  })
  const left = await uploads.presignUpload(alice, {
    name: "b.png",
    type: "image/png",
    size: PNG.length,
  })
  await store.put(done.key, PNG, { contentType: "image/png" })
  await store.put(left.key, PNG, { contentType: "image/png" })
  await uploads.confirmUpload(alice, done.key)
  ok("nothing removed too early", (await uploads.cleanupAbandoned()) === 0 && files.size === 2)
  ok(
    "unconfirmed removed after the window",
    (await uploads.cleanupAbandoned(Date.now() + 7 * 3_600_000)) === 1,
  )
  ok("confirmed kept", files.has(done.key) && !files.has(left.key))

  const again = await uploads.presignUpload(alice, {
    name: "c.png",
    type: "image/png",
    size: PNG.length,
  })
  await store.put(again.key, PNG)
  const cleanup = abandonedUploadsJob({
    cleanupAbandoned: () => uploads.cleanupAbandoned(Date.now() + 7 * 3_600_000),
  })
  const jobs = createTestJobs({ jobs: [cleanup] })
  await cleanup.enqueue({})
  const r = await jobs.runAll()
  ok("the provided job runs it", r[0]?.status === "done" && !files.has(again.key), r)
}

// --- fetch stub for the S3 and Supabase adapters ---
type Call = { url: string; method: string; body: string }
let calls: Call[] = []
let reply: (c: Call) => Response = () => new Response("")
globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
  const c = {
    url: String(url),
    method: init.method ?? "GET",
    body: typeof init.body === "string" ? init.body : "",
  }
  calls.push(c)
  return reply(c)
}) as typeof fetch

console.log("s3: SigV4 and multipart")
{
  // AWS's published presigned-URL example (GET test.txt, examplebucket, 2013-05-24, 86400 s).
  const aws = s3BlobStore({
    endpoint: "https://s3.amazonaws.com",
    region: "us-east-1",
    bucket: "examplebucket",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    virtualHosted: true,
    now: () => new Date("2013-05-24T00:00:00Z"),
  })
  const url = await aws.signedUrl("test.txt", { expiresInSeconds: 86_400 })
  ok(
    "matches AWS's example signature",
    url.endsWith(
      "X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    ),
    url,
  )
  ok("virtual-hosted URL", url.startsWith("https://examplebucket.s3.amazonaws.com/test.txt?"))
  ok(
    "rejects traversal",
    (await code(() => aws.signedUrl("../x", { expiresInSeconds: 60 }))) !== "none",
  )

  const r2 = s3BlobStore({
    endpoint: "https://acct.r2.example",
    region: "auto",
    bucket: "files",
    accessKeyId: "id",
    secretAccessKey: "secret",
  })
  const uploads = createUploads({
    store: r2,
    kv: memoryKv(),
    maxBytes: 50_000_000,
    allowedTypes: ["image/png"],
  })
  reply = (c) =>
    c.url.includes("uploads=")
      ? new Response(
          "<InitiateMultipartUploadResult><UploadId>up-1</UploadId></InitiateMultipartUploadResult>",
        )
      : c.method === "GET"
        ? new Response(PNG as Uint8Array<ArrayBuffer>, { headers: { "content-type": "image/png" } })
        : new Response("<CompleteMultipartUploadResult/>")
  const big = await uploads.startResumable(alice, {
    name: "big.png",
    type: "image/png",
    size: 12 * 1024 * 1024,
  })
  ok("multipart started", big.kind === "multipart" && big.uploadId === "up-1")
  ok(
    "path-style create call",
    calls[0]?.method === "POST" && calls[0]?.url.startsWith("https://acct.r2.example/files/alice/"),
  )
  if (big.kind === "multipart") {
    ok("three 5 MiB parts", big.partUrls.length === 3 && big.partSize === 5 * 1024 * 1024)
    ok(
      "part URLs carry part number and upload id",
      big.partUrls[2]!.includes("partNumber=3") && big.partUrls[2]!.includes("uploadId=up-1"),
    )
    calls = []
    const done = await uploads.completeMultipart(alice, big.key, big.uploadId, [
      { partNumber: 2, etag: '"b"' },
      { partNumber: 1, etag: '"a"' },
    ])
    const complete = calls[0]!
    ok(
      "complete posts parts in order",
      complete.method === "POST" &&
        complete.body.indexOf("<PartNumber>1") < complete.body.indexOf("<PartNumber>2") &&
        complete.body.includes("&quot;a&quot;"),
    )
    ok("then confirmed like a direct upload", done.type === "image/png" && done.size === PNG.length)
  }
  ok(
    "plain store has no resumable",
    (await code(() =>
      createUploads({
        store: memStore().store,
        maxBytes: 1e9,
        allowedTypes: ["image/png"],
      }).startResumable(alice, { name: "x", type: "image/png", size: 10 }),
    )) === "RESUMABLE_UNSUPPORTED",
  )
}

console.log("supabase: TUS resumable")
{
  calls = []
  reply = () => Response.json({ url: "/object/upload/sign/media/alice/x.png?token=tok-123" })
  const sb = supabaseBlobStore({
    url: "https://proj.supabase.example",
    serviceRoleKey: "service",
    bucket: "media",
    publishableKey: "anon",
  })
  const uploads = createUploads({ store: sb, maxBytes: 1e9, allowedTypes: ["image/png"] })
  const t = await uploads.startResumable(alice, {
    name: "x.png",
    type: "image/png",
    size: 50_000_000,
  })
  ok("tus target", t.kind === "tus")
  if (t.kind === "tus") {
    ok(
      "signed endpoint",
      t.endpoint === "https://proj.supabase.example/storage/v1/upload/resumable/sign",
    )
    ok(
      "token as x-signature, anon apikey, no service key",
      t.headers["x-signature"] === "tok-123" &&
        t.headers.apikey === "anon" &&
        !JSON.stringify(t).includes("service"),
    )
    ok(
      "metadata",
      t.metadata.bucketName === "media" &&
        t.metadata.objectName === t.key &&
        t.chunkSize === 6 * 1024 * 1024,
    )
  }
  ok("asked upload/sign", calls[0]?.url.includes("/object/upload/sign/media/alice/") === true)
}

console.log("resize")
{
  const { store, files } = memStore()
  const seen: unknown[] = []
  const binding: ImagesBindingLike = {
    input(b) {
      const chain = {
        transform(t: Record<string, unknown>) {
          seen.push(t)
          return chain
        },
        async output(o: { format: string }) {
          seen.push(o)
          return {
            response: () =>
              new Response(
                bytesOf(
                  "small",
                  b instanceof Uint8Array ? [b.length & 0xff] : [],
                ) as Uint8Array<ArrayBuffer>,
                { headers: { "content-type": o.format } },
              ),
          }
        },
      }
      return chain
    },
  }
  const uploads = createUploads({
    store,
    maxBytes: 1000,
    allowedTypes: ["image/png"],
    resizer: cloudflareImagesResizer(binding),
  })
  await store.put("alice/p.png", PNG, { contentType: "image/png" })
  const v = await uploads.resize(alice, "alice/p.png", { width: 320 })
  ok(
    "variant stored beside the original",
    v.key === "alice/p.png@320w" && files.has(v.key) && v.type === "image/webp",
  )
  ok(
    "binding got width and format",
    (seen[0] as { width?: number }).width === 320 &&
      (seen[1] as { format?: string }).format === "image/webp",
  )
  ok(
    "someone else's image refused",
    (await code(() => uploads.resize(bob, "alice/p.png", { width: 10 }))) === "FORBIDDEN",
  )
  ok(
    "no resizer configured",
    (await code(() =>
      createUploads({ store, maxBytes: 1, allowedTypes: [] }).resize(alice, "alice/p.png", {
        width: 1,
      }),
    )) !== "none",
  )
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
