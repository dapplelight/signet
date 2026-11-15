// dbCache behind signet-ai's real extractor, on every backend (SQLite, D1, Postgres).
import { afterEach, describe, expect, test } from "bun:test"
import { z } from "zod"
import { createExtractor } from "../../ai/src/extract"
import type { Cache, CacheEntry } from "../../ai/src/types"
import type { UsageReport } from "../../ai/src/usage"
import { dbCache, pruneAiCache } from "../src/ai-cache"
import { createCipher, generateKey, isCiphertext } from "../src/cipher"
import * as pgc from "../src/columns/pg"
import * as sqc from "../src/columns/sqlite"
import { backends, ddl, type Instance } from "./harness"

const schema = z.object({ budget: z.number(), category: z.string() })
const args = { schema, input: "a snowboard under 8000", instructions: "Pull budget and category." }

// Type test: the entry type is inferred from signet-ai's Cache, no annotation needed.
const typed = (c: Cache) => c
void ((db: Parameters<typeof dbCache>[0]) => typed(dbCache(db, sqc.aiCache())))
// @ts-expect-error a cache of the wrong entry type is refused
void ((db: Parameters<typeof dbCache>[0]) => typed(dbCache<{ nope: true }>(db, sqc.aiCache())))

describe.each(backends)("$name", (backend) => {
  let open: Instance | undefined
  afterEach(async () => {
    await open?.close()
    open = undefined
  })
  const make = async (cipher?: ReturnType<typeof createCipher>) => {
    open = await backend.make({ cipher })
    const table = open.db.dialect === "pg" ? pgc.aiCache() : sqc.aiCache()
    await open.exec(ddl(table))
    return { db: open.db, table }
  }
  const provider = (paid: { n: number }) => ({
    name: "p",
    model: "m1",
    pricing: { perCallUsd: 0.01 },
    async generate<T>() {
      paid.n++
      return { value: { budget: 8000, category: "snowboard" } as T }
    },
  })

  test("a second extractor (a restart) is answered from the table and reports the saving", async () => {
    const { db, table } = await make()
    const paid = { n: 0 }
    const reports: UsageReport[] = []
    // Held in a variable, so annotated; passed inline it is inferred.
    const opts = {
      cache: dbCache<CacheEntry>(db, table),
      onUsage: (u: UsageReport) => void reports.push(u),
    }
    const first = await createExtractor({ providers: [provider(paid)], ...opts }).extract(args)
    const again = await createExtractor({ providers: [provider(paid)], ...opts }).extract(args)
    expect(paid.n).toBe(1)
    expect(first.meta.cacheHit).toBe(false)
    expect(again.meta.cacheHit).toBe(true)
    expect(again.value.category).toBe("snowboard")
    expect(reports.map((r) => [r.costUsd, r.cacheHit, r.savedUsd])).toEqual([
      [0.01, undefined, undefined],
      [0, true, 0.01],
    ])
  }, 30_000) // PGlite's first start compiles WASM

  test("set overwrites a key; expired rows miss, are deleted on read and pruned", async () => {
    const { db, table } = await make()
    const cache = dbCache<CacheEntry>(db, table)
    const entry = (v: number) => ({ value: v, meta: { cacheHit: false } as CacheEntry["meta"] })
    await cache.set("k", entry(1), 60)
    await cache.set("k", entry(2), 60)
    expect((await cache.get("k"))?.value).toBe(2)
    expect(await cache.get("absent")).toBeUndefined()
    await cache.set("old", entry(3), -1)
    await cache.set("old2", entry(4), -1)
    expect(await cache.get("old")).toBeUndefined()
    expect(await db.orm.select().from(table)).toHaveLength(2) // "old" deleted on read
    expect(await pruneAiCache(db, table)).toBe(1)
    expect((await db.orm.select().from(table)).map((r: { key: string }) => r.key)).toEqual(["k"])
  })

  test("with a cipher the entry is stored encrypted; a corrupt row is a miss", async () => {
    const { db, table } = await make(createCipher({ keys: { k: generateKey() }, current: "k" }))
    const cache = dbCache<CacheEntry>(db, table)
    await cache.set("k", { value: { pan: "ABCDE1234F" }, meta: {} as CacheEntry["meta"] }, 60)
    const [row] = await db.orm.select().from(table)
    expect(row.entry).not.toContain("ABCDE1234F")
    expect(isCiphertext(row.entry)).toBe(true)
    expect((await cache.get("k"))?.value).toEqual({ pan: "ABCDE1234F" })
    await db.orm.update(table).set({ entry: "{not json" })
    expect(await cache.get("k")).toBeUndefined()
  })
})
