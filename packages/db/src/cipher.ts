/**
 * AES-GCM field encryption for `encrypted()` columns, with key ids so keys can
 * be rotated.
 *
 * Stored values look like `enc:v1:<keyId>:<iv>:<ciphertext>` (base64). The key
 * id travels with the ciphertext, so old rows keep decrypting after a new key
 * becomes `current`; `onStaleKey` tells you when a row still uses an old one,
 * and `rotate(value)` re-encrypts it.
 *
 * Keys come from config, never from env at module scope.
 */

import { SignetDbError } from "./errors.js"

const PREFIX = "enc:v1:"

export type CipherConfig = {
  /** Key id → a 256-bit AES-GCM CryptoKey, or its 32 raw bytes as base64. */
  keys: Record<string, CryptoKey | string>
  /** The key id new values are encrypted with. */
  current: string
  /** Called when a value decrypts with a key other than `current`. */
  onStaleKey?: (info: { keyId: string }) => void
  /**
   * Called when rows read through signet-db had encrypted fields that did not
   * decrypt. Those fields are returned as `null`, never as ciphertext.
   */
  onUndecrypted?: (info: { table: string; paths: string[] }) => void
}

export type Cipher = {
  readonly current: string
  encrypt(plain: string): Promise<string>
  /** Throws on a wrong key, an unknown key id or a tampered value. */
  decrypt(value: string): Promise<string>
  /** Re-encrypt with the current key. Returns the value unchanged if it already uses it. */
  rotate(value: string): Promise<string>
  /** The key id inside a stored value, or null if it is not one. */
  keyIdOf(value: string): string | null
  readonly onUndecrypted?: CipherConfig["onUndecrypted"]
}

const toB64 = (bytes: Uint8Array): string => {
  let s = ""
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}
const fromB64 = (s: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Whether a value has the shape of a signet ciphertext. */
export function isCiphertext(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(PREFIX) && value.split(":").length === 5
}

/**
 * The driver mapping of every `encrypted()` column. It refuses plaintext, so a
 * raw Drizzle insert that skips signet-db fails instead of storing the secret.
 */
export function assertCiphertext(value: string): string {
  if (!isCiphertext(value)) {
    throw new SignetDbError(
      "PLAINTEXT_WRITE",
      "Refusing to write plaintext to an encrypted() column. Write through scoped() or audited() on a db with a cipher, or pass the value through cipher.encrypt() first.",
    )
  }
  return value
}

/** A 32-byte random key as base64, for `keys` (e.g. to put in a secret store). */
export function generateKey(): string {
  return toB64(crypto.getRandomValues(new Uint8Array(32)))
}

export function createCipher(config: CipherConfig): Cipher {
  const { keys, current, onStaleKey, onUndecrypted } = config
  for (const id of Object.keys(keys)) {
    if (!/^[\w.-]+$/.test(id))
      throw new SignetDbError(
        "BAD_CIPHER_CONFIG",
        `Key id "${id}" is invalid: use only letters, digits, _ . and -.`,
      )
  }
  if (!(current in keys))
    throw new SignetDbError(
      "BAD_CIPHER_CONFIG",
      `current is "${current}" but keys has no such id. Add it to keys or set current to one of: ${Object.keys(keys).join(", ")}.`,
    )

  const imported = new Map<string, Promise<CryptoKey>>()
  const key = (id: string): Promise<CryptoKey> => {
    const k = keys[id]
    if (k === undefined)
      return Promise.reject(
        new SignetDbError(
          "UNKNOWN_KEY",
          `The value was encrypted with key "${id}", which is not in keys. Add the old key to keys to keep reading it.`,
        ),
      )
    let p = imported.get(id)
    if (!p) {
      p =
        typeof k === "string"
          ? crypto.subtle.importKey("raw", fromB64(k), "AES-GCM", false, ["encrypt", "decrypt"])
          : Promise.resolve(k)
      imported.set(id, p)
    }
    return p
  }

  const keyIdOf = (value: string) => (isCiphertext(value) ? (value.split(":")[2] ?? null) : null)

  const encrypt = async (plain: string) => {
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ct = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await key(current),
      new TextEncoder().encode(plain),
    )
    return `${PREFIX}${current}:${toB64(iv)}:${toB64(new Uint8Array(ct))}`
  }

  const decrypt = async (value: string) => {
    if (!isCiphertext(value))
      throw new SignetDbError(
        "NOT_CIPHERTEXT",
        "The value is not a signet ciphertext (enc:v1:...). It was stored without encryption or is corrupted.",
      )
    const [, , id, iv, ct] = value.split(":") as [string, string, string, string, string]
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(iv) },
      await key(id),
      fromB64(ct),
    )
    if (id !== current) onStaleKey?.({ keyId: id })
    return new TextDecoder().decode(plain)
  }

  const rotate = async (value: string) =>
    keyIdOf(value) === current ? value : encrypt(await decrypt(value))

  return { current, encrypt, decrypt, rotate, keyIdOf, onUndecrypted }
}
