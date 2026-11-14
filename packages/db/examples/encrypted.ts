/**
 * Encrypted fields with key rotation. `bun examples/encrypted.ts`
 *
 * In an app the keys come from a secret store (a Worker secret, a mounted
 * file), read inside the request or startup path, never at module scope.
 */
import { createCipher, generateKey, scoped } from "../src"
import { createDb } from "../src/sqlite"
import * as schema from "./schema"

const oldKey = generateKey()
const db = createDb(":memory:", {
  cipher: createCipher({ keys: { "2025": oldKey }, current: "2025" }),
})
schema.migrate((sql) => db.orm.run(sql))

const me = scoped(db, { userId: "user-1" })
await me.insert(schema.profiles, { name: "Test User", pan: "ABCDE1234F" })
console.log("at rest:", (await db.orm.select().from(schema.profiles))[0]?.pan)
console.log("read:", (await me.select(schema.profiles))[0]?.pan)

// Rotate: add a new current key, keep the old one for reading, re-encrypt lazily.
const cipher = createCipher({
  keys: { "2025": oldKey, "2026": generateKey() },
  current: "2026",
  onStaleKey: ({ keyId }) => console.log(`row still on key ${keyId}; re-encrypt it`),
})
const rotated = { ...db, cipher }
for (const p of await scoped(rotated, { userId: "user-1" }).select(schema.profiles)) {
  await scoped(rotated, { userId: "user-1" }).update(schema.profiles, { pan: p.pan })
}
const [after] = await db.orm.select().from(schema.profiles)
console.log("now on key:", cipher.keyIdOf(after?.pan ?? ""))
