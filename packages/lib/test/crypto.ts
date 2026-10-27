/**
 * decryptFields must fail closed: a value that should be ciphertext and does
 * not decrypt becomes null, never passes through, and nothing throws. Uses
 * real AES-GCM (WebCrypto), the scheme app-a's private mode uses.
 */
import { decryptFields } from "../src/crypto"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

const newKey = () =>
  crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"])

async function encrypt(plain: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)),
  )
  const all = new Uint8Array(iv.length + ct.length)
  all.set(iv)
  all.set(ct, iv.length)
  return btoa(String.fromCharCode(...all))
}

async function decryptWith(key: CryptoKey, b64: string): Promise<string> {
  const all = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: all.slice(0, 12) },
    key,
    all.slice(12),
  )
  return new TextDecoder().decode(pt)
}

const key = await newKey()
const otherKey = await newKey()
const decrypt = (v: string) => decryptWith(key, v)

// --- the happy path, nested and through arrays ---
const txn = {
  id: 1,
  description: await encrypt("SWIGGY ORDER", key),
  notes: await encrypt("team lunch", key),
  amount: -420,
  merchant: { cleanName: await encrypt("Swiggy", key), rawId: await encrypt("SWG-99", key) },
}
const input = { transactions: [txn, { ...txn, id: 2, notes: null }], total: 2 }
const frozen = JSON.stringify(input)
const r = await decryptFields(
  input,
  [
    "transactions.description",
    "transactions.notes",
    "transactions.merchant.cleanName",
    "transactions.merchant.rawId",
  ],
  { decrypt },
)
const [t0, t1] = r.data.transactions
ok(
  "decrypts a top-level field of each array item",
  t0?.description === "SWIGGY ORDER" && t1?.description === "SWIGGY ORDER",
)
ok(
  "decrypts sibling nested fields (shared copy)",
  t0?.merchant.cleanName === "Swiggy" && t0?.merchant.rawId === "SWG-99",
)
ok("null stays null", t1?.notes === null)
ok("untouched fields are kept", t0?.amount === -420 && r.data.total === 2 && t1?.id === 2)
ok("nothing reported when all decrypt", r.undecrypted.length === 0)
ok("input is not mutated", JSON.stringify(input) === frozen)

// --- fail closed ---
const wrong = await decryptFields(
  input,
  ["transactions.description", "transactions.merchant.cleanName"],
  {
    decrypt: (v) => decryptWith(otherKey, v),
  },
)
const w0 = wrong.data.transactions[0]
ok("wrong key: field becomes null", w0?.description === null && w0?.merchant.cleanName === null)
ok(
  "wrong key: ciphertext appears nowhere in the output",
  !JSON.stringify(
    wrong.data.transactions.map((t) => [t.description, t.merchant.cleanName]),
  ).includes(txn.description.slice(0, 16)),
)
ok(
  "wrong key: every concrete path is reported",
  wrong.undecrypted.join() ===
    "transactions.0.description,transactions.0.merchant.cleanName,transactions.1.description,transactions.1.merchant.cleanName",
  wrong.undecrypted.join(),
)

const sync = await decryptFields({ a: "x" }, ["a"], {
  decrypt: () => {
    throw new Error("boom")
  },
})
ok("a synchronous throw fails closed", sync.data.a === null && sync.undecrypted.join() === "a")

const odd = await decryptFields({ a: "x" }, ["a"], { decrypt: () => 42 as unknown as string })
ok("a non-string result fails closed", odd.data.a === null)

// --- legacy plaintext ---
const legacy = { description: "OLD PLAINTEXT ROW", notes: await encrypt("new", key) }
const isCiphertext = (v: string) => /^[A-Za-z0-9+/]+=*$/.test(v) && v.length >= 40
const l = await decryptFields(legacy, ["description", "notes"], { decrypt, isCiphertext })
ok("isCiphertext=false keeps legacy plaintext", l.data.description === "OLD PLAINTEXT ROW")
ok("and still decrypts real ciphertext", l.data.notes === "new")
const noPred = await decryptFields(legacy, ["description"], { decrypt })
ok(
  "no isCiphertext: an undecryptable string is nulled, not passed",
  noPred.data.description === null,
)
const badPred = await decryptFields(legacy, ["description"], {
  decrypt,
  isCiphertext: () => {
    throw new Error("x")
  },
})
ok("a throwing isCiphertext counts as ciphertext (fails closed)", badPred.data.description === null)
let seenPath = ""
await decryptFields({ m: { n: "v" } }, ["m.n"], {
  decrypt: (_v, p) => {
    seenPath = p
    return "ok"
  },
})
ok("decrypt receives the path", seenPath === "m.n")

// --- shapes that must not throw ---
const shapes: [string, unknown, string[]][] = [
  ["null input", null, ["a"]],
  ["string input", "x", ["a"]],
  ["missing key", { b: 1 }, ["a"]],
  ["path through a non-object", { a: "str" }, ["a.b"]],
  ["path through null", { a: null }, ["a.b"]],
  ["number at the path", { a: 5 }, ["a"]],
  ["empty string at the path", { a: "" }, ["a"]],
  ["empty path", { a: "x" }, ["", "."]],
]
for (const [name, value, paths] of shapes) {
  let threw = false
  let res: Awaited<ReturnType<typeof decryptFields>> | undefined
  try {
    res = await decryptFields(value, paths, {
      decrypt: () => {
        throw new Error("should not be called")
      },
    })
  } catch {
    threw = true
  }
  ok(
    `${name}: no throw, returned as is`,
    !threw && JSON.stringify(res?.data) === JSON.stringify(value),
  )
}

const arr = await decryptFields(
  [{ d: await encrypt("a", key) }, { d: await encrypt("b", key) }],
  ["d"],
  { decrypt },
)
ok("an array input maps each element", arr.data.map((x) => x.d).join() === "a,b")

// Same object referenced twice in the input: both references decrypt.
const shared = { cleanName: await encrypt("Zomato", key) }
const s = await decryptFields(
  { a: { m: shared }, b: { m: shared } },
  ["a.m.cleanName", "b.m.cleanName"],
  { decrypt },
)
ok(
  "a shared object decrypts under every reference",
  s.data.a.m.cleanName === "Zomato" && s.data.b.m.cleanName === "Zomato",
)
ok("the shared input object is untouched", shared.cleanName !== "Zomato")

// The reuse bug: a second path through the same container while a slow
// decrypt of the first is in flight must not detach it.
const slow = await decryptFields(
  { m: { a: await encrypt("A", key), b: await encrypt("B", key) } },
  ["m.a", "m.b"],
  {
    decrypt: async (v, p) => {
      if (p === "m.a") await new Promise((r) => setTimeout(r, 20))
      return decrypt(v)
    },
  },
)
ok(
  "sibling paths with a slow first decrypt both land",
  slow.data.m.a === "A" && slow.data.m.b === "B",
)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) throw new Error(`${fail} failed`)
