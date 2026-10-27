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

async function pbkdf2(passcode: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passcode),
    "PBKDF2",
    false,
    ["deriveBits"],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: ITERATIONS, hash: "SHA-256" },
    key,
    256,
  )
  return toHex(new Uint8Array(bits))
}

/** Produce a `salt:hash` string to store in an env secret. Run this offline. */
export async function hashPasscode(passcode: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return `${toHex(salt)}:${await pbkdf2(passcode, salt)}`
}

/** Verify a submitted passcode against a stored `salt:hash`. Constant-time. */
export async function verifyPasscode(
  passcode: string | undefined | null,
  stored: string | undefined | null,
): Promise<boolean> {
  if (!passcode || !stored) return false
  const [saltHex, hash] = stored.split(":")
  if (!saltHex || !hash) return false
  try {
    return timingSafeEqual(await pbkdf2(passcode, fromHex(saltHex)), hash)
  } catch {
    return false
  }
}
