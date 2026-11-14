import type { BlobStore } from "../src/adapters/index"
import { createUploads, sniffType, type Upload } from "../src/storage/index"

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

/** An in-memory store; `sign` adds a supabase/upstash-like `signedUrl`. */
function stubStore(sign: boolean) {
  const files = new Map<string, { body: ArrayBuffer; contentType?: string }>()
  const store: BlobStore = {
    async put(key, body, opts) {
      const bytes = typeof body === "string" ? new TextEncoder().encode(body) : new Uint8Array(body)
      files.set(key, { body: bytes.slice().buffer, contentType: opts?.contentType })
    },
    async get(key) {
      return files.get(key) ?? null
    },
    async delete(key) {
      files.delete(key)
    },
    ...(sign
      ? {
          async signedUrl(key: string, o: { expiresInSeconds: number; method?: "GET" | "PUT" }) {
            return `https://storage.example/${o.method ?? "GET"}/${key}?ttl=${o.expiresInSeconds}`
          },
        }
      : {}),
  }
  return { store, files }
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70])
const PDF = new TextEncoder().encode("%PDF-1.7\n")
const ctx = { userId: "user-a" }

console.log("sniffing")
ok("png", sniffType(PNG) === "image/png")
ok("jpeg", sniffType(JPEG) === "image/jpeg")
ok("pdf", sniffType(PDF) === "application/pdf")
ok("gif", sniffType(new TextEncoder().encode("GIF89a....")) === "image/gif")
ok("webp", sniffType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ")) === "image/webp")
ok("text is unknown", sniffType(new TextEncoder().encode("hello")) === undefined)

console.log("presign")
{
  const { store } = stubStore(true)
  const uploads = createUploads({
    store,
    maxBytes: 1000,
    allowedTypes: ["image/png", "image/jpeg"],
    urlTtlSeconds: 60,
  })
  ok(
    "too large rejected before signing",
    (await code(() =>
      uploads.presignUpload(ctx, { name: "a.png", type: "image/png", size: 1001 }),
    )) === "TOO_LARGE",
  )
  ok(
    "empty rejected",
    (await code(() =>
      uploads.presignUpload(ctx, { name: "a.png", type: "image/png", size: 0 }),
    )) === "EMPTY",
  )
  ok(
    "type rejected",
    (await code(() =>
      uploads.presignUpload(ctx, { name: "a.exe", type: "application/x-msdownload", size: 10 }),
    )) === "TYPE_NOT_ALLOWED",
  )
  const p = await uploads.presignUpload(ctx, {
    name: "../../My Photo!.png",
    type: "image/png",
    size: 500,
  })
  ok("per-user key", p.key.startsWith("user-a/") && !p.key.includes(".."), p.key)
  ok("safe name kept", p.key.endsWith("-My-Photo-.png"), p.key)
  ok(
    "signed PUT url with ttl",
    p.url.includes("/PUT/") && p.url.endsWith("ttl=60") && p.method === "PUT",
  )
  ok("content type header", p.headers["Content-Type"] === "image/png")
  const d = await uploads.presignDownload(ctx, p.key)
  ok("signed GET url", d.url.includes("/GET/"))
  ok(
    "other user's key forbidden",
    (await code(() => uploads.presignDownload({ userId: "user-b" }, p.key))) === "FORBIDDEN",
  )
  ok(
    "traversal rejected",
    (await code(() => uploads.presignDownload(ctx, "user-a/../user-b/x.png"))) === "BAD_KEY",
  )
  ok(
    "absolute rejected",
    (await code(() => uploads.presignDownload(ctx, "/etc/passwd"))) === "BAD_KEY",
  )
  ok(
    "family wildcard",
    (await code(() =>
      createUploads({ store, maxBytes: 10, allowedTypes: ["image/*"] }).presignUpload(ctx, {
        name: "x",
        type: "image/gif",
        size: 5,
      }),
    )) === "none",
  )
  const evil = createUploads({
    store,
    maxBytes: 10,
    allowedTypes: ["image/png"],
    keyFor: () => "../escape",
  })
  ok(
    "bad keyFor rejected",
    (await code(() => evil.presignUpload(ctx, { name: "x", type: "image/png", size: 5 }))) ===
      "BAD_KEY",
  )
}

console.log("confirm")
{
  const { store, files } = stubStore(true)
  const after: Upload[] = []
  const uploads = createUploads({
    store,
    maxBytes: 100,
    allowedTypes: ["image/png"],
    afterUpload: (u) => void after.push(u),
  })
  const p = await uploads.presignUpload(ctx, { name: "a.png", type: "image/png", size: 12 })
  ok(
    "confirm before upload is NOT_FOUND",
    (await code(() => uploads.confirmUpload(ctx, p.key))) === "NOT_FOUND",
  )
  await store.put(p.key, PNG, { contentType: "image/png" })
  const u = await uploads.confirmUpload(ctx, p.key)
  ok("confirmed", u.size === 12 && u.type === "image/png")
  ok("afterUpload ran (follow-up job hook)", after[0]?.key === p.key)
  // The client lied: it PUT a JPEG as image/png at a signed URL.
  const q = await uploads.presignUpload(ctx, { name: "b.png", type: "image/png", size: 10 })
  await store.put(q.key, JPEG, { contentType: "image/png" })
  ok(
    "confirm rejects wrong content",
    (await code(() => uploads.confirmUpload(ctx, q.key))) === "TYPE_MISMATCH",
  )
  ok("and deletes it", !files.has(q.key))
  const r = await uploads.presignUpload(ctx, { name: "c.png", type: "image/png", size: 12 })
  await store.put(r.key, new Uint8Array(200), { contentType: "image/png" })
  ok(
    "confirm rejects oversize",
    (await code(() => uploads.confirmUpload(ctx, r.key))) === "TOO_LARGE",
  )
}

console.log("acceptUpload (no presign)")
{
  const { store, files } = stubStore(false)
  const uploads = createUploads({ store, maxBytes: 64, allowedTypes: ["image/png", "image/jpeg"] })
  ok(
    "presign unsupported is explicit",
    (await code(() =>
      uploads.presignUpload(ctx, { name: "a.png", type: "image/png", size: 5 }),
    )) === "PRESIGN_UNSUPPORTED",
  )
  const req = (body: Uint8Array<ArrayBuffer>, type: string) =>
    new Request("https://app.example/upload", {
      method: "PUT",
      headers: { "content-type": type },
      body,
    })
  const u = await uploads.acceptUpload(ctx, req(PNG, "image/png"), { name: "pic.png" })
  ok("stored", u.key.startsWith("user-a/") && files.get(u.key)?.contentType === "image/png")
  ok(
    "renamed file rejected",
    (await code(() => uploads.acceptUpload(ctx, req(JPEG, "image/png")))) === "TYPE_MISMATCH",
  )
  ok(
    "text posing as image rejected",
    (await code(() =>
      uploads.acceptUpload(ctx, req(new TextEncoder().encode("not an image"), "image/png")),
    )) === "TYPE_MISMATCH",
  )
  ok(
    "disallowed type",
    (await code(() => uploads.acceptUpload(ctx, req(PDF, "application/pdf")))) ===
      "TYPE_NOT_ALLOWED",
  )
  const big = new Uint8Array(100)
  big.set(PNG)
  ok(
    "oversize stream stopped",
    (await code(() => uploads.acceptUpload(ctx, req(big, "image/png")))) === "TOO_LARGE",
  )
  ok("only the good file stored", files.size === 1)
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
