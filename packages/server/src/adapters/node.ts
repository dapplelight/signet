/**
 * Filesystem `BlobStore` for Node, Bun and Docker (mount a volume at `dir`).
 *
 * Its own subpath because it imports `node:`. Keys map to files under `dir`;
 * a key with `..`, a leading `/` or a backslash is rejected, so a key taken
 * from a request cannot reach outside it. `contentType` is not stored: serve
 * by extension, or keep it beside the key in your own records.
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, resolve, sep } from "node:path"
import { assertBlobKey, type BlobStore } from "./index.js"

export function fsBlobStore(dir: string): BlobStore {
  const root = resolve(dir)
  const pathOf = (key: string) => {
    assertBlobKey(key)
    const path = resolve(root, key)
    if (!path.startsWith(root + sep)) throw new Error(`Invalid blob key: ${JSON.stringify(key)}`)
    return path
  }
  return {
    async put(key, body) {
      const path = pathOf(key)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, typeof body === "string" ? body : new Uint8Array(body))
    },
    async get(key) {
      try {
        const buf = await readFile(pathOf(key))
        return {
          body: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
        }
      } catch (err) {
        if ((err as { code?: string }).code === "ENOENT") return null
        throw err
      }
    },
    async delete(key) {
      await rm(pathOf(key), { force: true })
    },
  }
}
