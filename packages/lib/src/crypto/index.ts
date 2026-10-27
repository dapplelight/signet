/**
 * Fail-closed field decryption for apps that encrypt user data on the client
 * (app-a's private mode). The app brings its own `decrypt`; this module owns
 * the one rule that is easy to get wrong:
 *
 *   A field that should be ciphertext and does not decrypt becomes `null`.
 *   It is never passed through.
 *
 * The usual bug is the opposite fallback: "decrypt failed, so it must be
 * legacy plaintext, leave it". A wrong key, a rotated key or a truncated value
 * all look like that, and the ciphertext ends up in UI or tool output. Here,
 * a value is passed through as plaintext only when the app's `isCiphertext`
 * says it is not ciphertext. With no `isCiphertext`, every non-empty string
 * at a listed path is treated as ciphertext.
 *
 * `decryptFields` never throws and never mutates its input.
 */

export type DecryptFieldsOptions = {
  /**
   * Decrypts one value. May throw or reject: that counts as a failure. It
   * gets the path, e.g. "merchant.cleanName", for per-field keys.
   */
  decrypt: (ciphertext: string, path: string) => string | Promise<string>
  /**
   * Whether a stored value is ciphertext. Return false only for values that
   * are certainly plaintext (legacy rows written before encryption). Default:
   * every non-empty string is ciphertext. If it throws, the value is treated
   * as ciphertext.
   */
  isCiphertext?: (value: string, path: string) => boolean
}

export type DecryptFieldsResult<T> = {
  /** A copy of the input with each listed field decrypted, or null where it failed. */
  data: T
  /**
   * The concrete paths that failed, with array indexes, e.g.
   * "transactions.3.description". Empty when everything decrypted.
   */
  undecrypted: string[]
}

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v)

/**
 * Decrypt the fields at `paths` in `input`.
 *
 * A path is dot-separated keys: "description", "merchant.cleanName". Arrays
 * are walked through without an index, so "transactions.description" means
 * the description of every transaction, and on an array input "description"
 * means every element's. A missing key, `null`, `undefined`, `""` or a
 * non-string value at a path is left as it is.
 *
 * For each string found: not ciphertext (by `isCiphertext`) → kept;
 * decrypts → plaintext; otherwise → `null`, and its path is reported in
 * `undecrypted`.
 */
export async function decryptFields<T>(
  input: T,
  paths: readonly string[],
  { decrypt, isCiphertext }: DecryptFieldsOptions,
): Promise<DecryptFieldsResult<T>> {
  const undecrypted: string[] = []
  const pending: Promise<void>[] = []

  const looksEncrypted = (value: string, path: string) => {
    if (!isCiphertext) return true
    try {
      return isCiphertext(value, path) !== false
    } catch {
      return true
    }
  }

  const decryptInto = (target: Obj, key: string, value: string, path: string) => {
    pending.push(
      (async () => {
        try {
          const plain = await decrypt(value, path)
          if (typeof plain !== "string") throw new TypeError("decrypt returned a non-string")
          target[key] = plain
        } catch {
          target[key] = null
          undecrypted.push(path)
        }
      })(),
    )
  }

  // Copies each container on the way down, so the input is never mutated.
  // A container is copied once: later paths through it ("merchant.rawId"
  // after "merchant.cleanName") reuse that copy. Copying a copy would detach
  // it from a decrypt still in flight, and the returned data would keep the
  // ciphertext.
  const copies = new Map<unknown, unknown>()
  const mine = new WeakSet<object>()
  const copyOf = <V extends object>(v: V): V => {
    if (mine.has(v)) return v
    let c = copies.get(v) as V | undefined
    if (!c) {
      c = (Array.isArray(v) ? [...v] : { ...v }) as V
      copies.set(v, c)
      mine.add(c)
    }
    return c
  }

  const walk = (node: unknown, keys: string[], at: string, set: (v: unknown) => void) => {
    if (Array.isArray(node)) {
      const arr = copyOf(node)
      set(arr)
      arr.forEach((item, i) => {
        walk(item, keys, at ? `${at}.${i}` : String(i), (v) => {
          arr[i] = v
        })
      })
      return
    }
    if (!isObj(node) || keys.length === 0) return
    const [key, ...rest] = keys as [string, ...string[]]
    if (!Object.hasOwn(node, key)) return
    const obj = copyOf(node)
    set(obj)
    const path = at ? `${at}.${key}` : key
    const value = obj[key]
    if (rest.length > 0) {
      walk(value, rest, path, (v) => {
        obj[key] = v
      })
      return
    }
    if (typeof value === "string" && value !== "" && looksEncrypted(value, path)) {
      decryptInto(obj, key, value, path)
    }
  }

  let data = input
  for (const p of paths) {
    const keys = p.split(".").filter(Boolean)
    if (keys.length === 0) continue
    walk(data, keys, "", (v) => {
      data = v as T
    })
  }
  await Promise.all(pending)
  undecrypted.sort()
  return { data, undecrypted }
}
