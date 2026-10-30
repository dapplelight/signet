/**
 * Shared-passcode auth. One secret, no user table.
 *
 * Covers the shape found in app-c (dashboard passcode) and the invite
 * tier (`pin-gate`, `LoginScreen`), which currently compare in plaintext.
 *
 * Store only the hash. Generate one with `hashPasscode` in a local script and
 * put the result in an environment secret — never the passcode itself.
 */

import { timingSafeEqual } from "./session.js"

const ITERATIONS = 100_000

function toHex(b: Uint8Array): string {
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("")
}

function fromHex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(s.slice(i * 2, i * 2 + 2), 16)
  return out
}

async function pbkdf2(
  passcode: string,
  salt: Uint8Array,
  iterations = ITERATIONS,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passcode),
    "PBKDF2",
    false,
    ["deriveBits"],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    key,
    256,
  )
  return toHex(new Uint8Array(bits))
}

/**
 * Produce an `iterations:salt:hash` string to store in an env secret. Run this
 * offline. The iteration count is stored so it can rise later without breaking
 * old hashes (Workers cap PBKDF2 at 100,000 today).
 */
export async function hashPasscode(passcode: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return `${ITERATIONS}:${toHex(salt)}:${await pbkdf2(passcode, salt)}`
}

/** Verify against a stored `iterations:salt:hash` (or the older `salt:hash`, 100,000 iterations). Constant-time. */
export async function verifyPasscode(
  passcode: string | undefined | null,
  stored: string | undefined | null,
): Promise<boolean> {
  if (!passcode || !stored) return false
  const parts = stored.split(":")
  const [iter, saltHex, hash] = parts.length === 2 ? [String(ITERATIONS), ...parts] : parts
  const iterations = Number(iter)
  if (parts.length > 3 || !saltHex || !hash || !Number.isInteger(iterations) || iterations < 1)
    return false
  try {
    return timingSafeEqual(await pbkdf2(passcode, fromHex(saltHex), iterations), hash)
  } catch {
    return false
  }
}
