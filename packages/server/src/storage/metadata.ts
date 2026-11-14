/**
 * Strip image metadata (EXIF, XMP, IPTC, text chunks, so GPS location too) from JPEG, PNG and WebP by walking their container format; pixels are untouched.
 *
 * Kept on purpose: JPEG JFIF/ICC/Adobe segments and PNG/WebP colour profiles
 * (ICCP), because dropping them shifts colours, and the EXIF Orientation tag,
 * because phone photos rely on it: when the source has one, the EXIF block is
 * rewritten to a minimal one holding only Orientation. Other types, and bytes
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

/** Orientation (1-8) from a TIFF block (EXIF without its `Exif\0\0` prefix), or undefined. */
function orientationOf(tiff: Uint8Array): number | undefined {
  const le = tiff[0] === 0x49 && tiff[1] === 0x49
  if (tiff.length < 8 || !(le || (tiff[0] === 0x4d && tiff[1] === 0x4d))) return undefined
  const v = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength)
  if (v.getUint16(2, le) !== 42) return undefined
  const ifd = v.getUint32(4, le)
  if (ifd + 2 > tiff.length) return undefined
  const count = v.getUint16(ifd, le)
  for (let n = 0; n < count; n++) {
    const e = ifd + 2 + n * 12
    if (e + 12 > tiff.length) return undefined
    if (v.getUint16(e, le) === 0x0112 && v.getUint16(e + 2, le) === 3) {
      const o = v.getUint16(e + 8, le)
      return o >= 1 && o <= 8 ? o : undefined
    }
  }
  return undefined
}

const EXIF_PREFIX = [0x45, 0x78, 0x69, 0x66, 0, 0] // "Exif\0\0"
const hasExifPrefix = (b: Uint8Array) => EXIF_PREFIX.every((x, i) => b[i] === x)

/** A 26-byte big-endian TIFF block whose only entry is Orientation. */
function orientationTiff(o: number): Uint8Array<ArrayBuffer> {
  // biome-ignore format: the TIFF layout, field by field
  return new Uint8Array([
    0x4d, 0x4d, 0, 42, 0, 0, 0, 8, // "MM", 42, IFD0 at 8
    0, 1, // one entry
    0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, // Orientation, SHORT, 1, value
    0, 0, 0, 0, // no next IFD
  ])
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(b: Uint8Array): number {
  let c = 0xffffffff
  for (const x of b) c = (CRC_TABLE[(c ^ x) & 0xff] as number) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** JPEG: drop APP1 (EXIF, XMP), APP13 (IPTC) and COM segments before the scan; EXIF becomes Orientation only. */
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
    const data = b.subarray(i + 4, i + 2 + len)
    if (marker === 0xe1 && hasExifPrefix(data)) {
      const o = orientationOf(data.subarray(6))
      if (o)
        keep.push(
          concat([
            new Uint8Array([0xff, 0xe1, 0, 34]),
            new Uint8Array(EXIF_PREFIX),
            orientationTiff(o),
          ]),
        )
    } else if (marker !== 0xe1 && marker !== 0xed && marker !== 0xfe) {
      keep.push(b.subarray(i, i + 2 + len))
    }
    i += 2 + len
  }
  return null
}

const PNG_DROP = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"])

/** PNG: drop text chunks; eXIf becomes Orientation only (or goes). Kept chunks keep their own CRCs. */
function stripPng(b: Uint8Array): Uint8Array<ArrayBuffer> | null {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const keep: Uint8Array[] = [b.subarray(0, 8)]
  let i = 8
  while (i + 12 <= b.length) {
    const len = view.getUint32(i)
    const type = String.fromCharCode(...b.subarray(i + 4, i + 8))
    const end = i + 12 + len
    if (end > b.length) return null
    if (type === "eXIf") {
      const o = orientationOf(b.subarray(i + 8, i + 8 + len))
      if (o) {
        const body = concat([new Uint8Array([0x65, 0x58, 0x49, 0x66]), orientationTiff(o)]) // "eXIf" + data
        const head = new Uint8Array(4)
        new DataView(head.buffer).setUint32(0, 26)
        const crc = new Uint8Array(4)
        new DataView(crc.buffer).setUint32(0, crc32(body))
        keep.push(concat([head, body, crc]))
      }
    } else if (!PNG_DROP.has(type)) keep.push(b.subarray(i, end))
    i = end
    if (type === "IEND") return concat(keep)
  }
  return null
}

/** WebP: drop XMP; EXIF becomes Orientation only (or goes); fix the VP8X flags and RIFF size. */
function stripWebp(b: Uint8Array): Uint8Array<ArrayBuffer> | null {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const keep: Uint8Array[] = []
  let vp8x: Uint8Array | undefined
  let keptExif = false
  let i = 12
  while (i + 8 <= b.length) {
    const type = String.fromCharCode(...b.subarray(i, i + 4))
    const len = view.getUint32(i + 4, true)
    const end = i + 8 + len + (len % 2)
    if (i + 8 + len > b.length) return null
    if (type === "EXIF") {
      // The spec says raw TIFF; some writers keep JPEG's "Exif\0\0" prefix.
      const data = b.subarray(i + 8, i + 8 + len)
      const o = orientationOf(hasExifPrefix(data) ? data.subarray(6) : data)
      if (o && !keptExif) {
        keep.push(
          concat([new Uint8Array([0x45, 0x58, 0x49, 0x46, 26, 0, 0, 0]), orientationTiff(o)]),
        )
        keptExif = true
      }
    } else if (type !== "XMP ") {
      const chunk = b.slice(i, Math.min(end, b.length))
      if (type === "VP8X" && chunk.length > 8) vp8x = chunk
      keep.push(chunk)
    }
    i = end
  }
  // VP8X flags: 0x08 EXIF, 0x04 XMP.
  if (vp8x) vp8x[8] = ((vp8x[8] as number) & ~0x0c) | (keptExif ? 0x08 : 0)
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
