/**
 * A JSON file as a `StorageAdapter`, for Node and Bun CLIs. Its own import
 * path so browser bundles never see `node:fs`.
 *
 *   import { fileStorage } from "@dapplelight/signet-lib/storage/file"
 *   const storage = fileStorage(join(homedir(), ".config", "my-cli", "auth.json"))
 *
 * The file is written owner-only (0600) through a temp file and a rename, so
 * a crash mid-write never leaves half a file. Writes from this process are
 * queued; two processes writing at once can still lose one write.
 */

import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import type { StorageAdapter } from "./index.js"

export function fileStorage(path: string): StorageAdapter {
  let queue: Promise<unknown> = Promise.resolve()

  const read = async (): Promise<Record<string, string>> => {
    let text: string
    try {
      text = await readFile(path, "utf8")
    } catch (err) {
      if ((err as { code?: string }).code === "ENOENT") return {}
      throw err
    }
    const data = JSON.parse(text) as unknown
    return data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, string>)
      : {}
  }

  const update = (change: (data: Record<string, string>) => void): Promise<void> => {
    const run = queue.then(async () => {
      const data = await read()
      change(data)
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      const tmp = `${path}.${process.pid}.tmp`
      await writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
      await chmod(tmp, 0o600)
      await rename(tmp, path)
    })
    queue = run.catch(() => {})
    return run
  }

  return {
    async get(key) {
      await queue
      const v = (await read())[key]
      return typeof v === "string" ? v : null
    },
    set: (key, value) =>
      update((d) => {
        d[key] = value
      }),
    remove: (key) =>
      update((d) => {
        delete d[key]
      }),
  }
}
