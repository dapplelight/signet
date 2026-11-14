/**
 * Sortable string ids: 26 characters, Crockford base32, the first ten encode
 * the creation time in milliseconds (the ULID layout).
 *
 * Ids sort by creation time as plain strings, in SQL and in JS. Within one
 * millisecond the random part is incremented (ULID's monotonic mode), so ids
 * from one process also sort in creation order. The last sixteen characters
 * carry 80 random bits from `crypto.getRandomValues`.
 */

import { SignetDbError } from "./errors.js"

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

/** A new time-ordered id. `now` is for tests and backfills. */
export function newId(now: number = Date.now()): string {
  let time = ""
  let t = now
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time
    t = Math.floor(t / 32)
  }
  if (now === lastTime) {
    // Increment with carry. Overflow needs 2^80 ids in one millisecond.
    for (let i = 15; i >= 0 && ++(last[i] as number) === 32; i--) last[i] = 0
  } else {
    // 256 is a multiple of 32, so `& 31` keeps every value equally likely.
    last = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b & 31)
    lastTime = now
  }
  return time + last.map((v) => ALPHABET[v]).join("")
}

let lastTime = -1
let last: number[] = []

/** The creation time encoded in an id from `newId`. */
export function idTime(id: string): Date {
  let t = 0
  for (const ch of id.slice(0, 10).toUpperCase()) {
    const v = ALPHABET.indexOf(ch)
    if (v < 0)
      throw new SignetDbError(
        "BAD_ID",
        `"${id}" is not an id from newId(): expected 26 Crockford base32 characters.`,
      )
    t = t * 32 + v
  }
  return new Date(t)
}
