/**
 * Strip image metadata (EXIF, XMP, IPTC, text chunks, so GPS location too) from JPEG, PNG and WebP by walking their container format; pixels are untouched.
 *
 * Kept on purpose: JPEG JFIF/ICC/Adobe segments and PNG/WebP colour profiles
 * (ICCP), because dropping them shifts colours. Lost on purpose: the EXIF
 * orientation tag, so a phone photo that relied on it may show rotated;
 * rotate on the client before upload if that matters. Other types, and bytes
 * that do not parse, come back unchanged.
 */

function ascii(b: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...b.subarray(from, to))
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

/** The type the first bytes say, for PNG, JPEG, GIF, WebP and PDF; else undefined. */
export function sniffType(bytes: Uint8Array): string | undefined {
  return SIGNATURES.find(([, test]) => test(bytes))?.[0]
}

const u8 = (b: Uint8Array) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength)

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.byteLength
  }
  return out
}

/** JPEG: drop APP1 (EXIF, XMP), APP13 (IPTC) and COM segments before the scan. */
function stripJpeg(b: Uint8Array): Uint8Array<ArrayBuffer> | null {
  const keep: Uint8Array[] = [b.subarray(0, 2)]
  let i = 2
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null
    const marker = b[i + 1] as number
    if (marker === 0xff) {
      i++ // fill byte
      continue
    }
    if (marker === 0xda || marker === 0xd9) {
      keep.push(b.subarray(i)) // start of scan: the rest is image data
      return concat(keep)
    }
    const len = ((b[i + 2] as number) << 8) | (b[i + 3] as number)
    if (len < 2 || i + 2 + len > b.length) return null
    const drop = marker === 0xe1 || marker === 0xed || marker === 0xfe
    if (!drop) keep.push(b.subarray(i, i + 2 + len))
    i += 2 + len
  }
  return null
}

const PNG_DROP = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"])

/** PNG: drop eXIf and text chunks. Kept chunks keep their own CRCs. */
function stripPng(b: Uint8Array): Uint8Array<ArrayBuffer> | null {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const keep: Uint8Array[] = [b.subarray(0, 8)]
  let i = 8
  while (i + 12 <= b.length) {
    const len = view.getUint32(i)
    const type = String.fromCharCode(...b.subarray(i + 4, i + 8))
    const end = i + 12 + len
    if (end > b.length) return null
    if (!PNG_DROP.has(type)) keep.push(b.subarray(i, end))
    i = end
    if (type === "IEND") return concat(keep)
  }
  return null
}

/** WebP: drop EXIF and XMP chunks, clear their VP8X flags, fix the RIFF size. */
function stripWebp(b: Uint8Array): Uint8Array<ArrayBuffer> | null {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const keep: Uint8Array[] = []
  let i = 12
  while (i + 8 <= b.length) {
    const type = String.fromCharCode(...b.subarray(i, i + 4))
    const len = view.getUint32(i + 4, true)
    const end = i + 8 + len + (len % 2)
    if (i + 8 + len > b.length) return null
    if (type !== "EXIF" && type !== "XMP ") {
      const chunk = b.slice(i, Math.min(end, b.length))
      if (type === "VP8X" && chunk.length > 8) chunk[8] = (chunk[8] as number) & ~0x0c
      keep.push(chunk)
    }
    i = end
  }
  const body = concat(keep)
  const out = concat([b.subarray(0, 12), body])
  new DataView(out.buffer).setUint32(4, out.length - 8, true)
  return out
}

/**
 * Bytes without EXIF/XMP/IPTC metadata for JPEG, PNG and WebP (by content,
 * not by name); anything else unchanged. Use it in a job after a direct
 * upload: `store.put(key, stripMetadata(new Uint8Array(obj.body)))`.
 */
export function stripMetadata(bytes: Uint8Array): Uint8Array {
  const b = u8(bytes)
  const type = sniffType(b)
  const out =
    type === "image/jpeg"
      ? stripJpeg(b)
      : type === "image/png"
        ? stripPng(b)
        : type === "image/webp"
          ? stripWebp(b)
          : null
  return out ?? bytes
}
