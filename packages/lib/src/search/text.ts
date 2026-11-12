/** Lower case, accents off, punctuation to spaces: "Café-Coffee Day" -> "cafe coffee day". */
export const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()

/** Edit distance (insert, delete, change one letter). */
export function lev(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0] as number
    d[0] = i
    for (let j = 1; j <= b.length; j++) {
      const keep = d[j] as number
      d[j] = Math.min(keep + 1, (d[j - 1] as number) + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = keep
    }
  }
  return d[b.length] as number
}

/**
 * A sound key for Indian-English spellings, so "biriyani" and "briyani", "swigy" and "swiggy" meet.
 * English Metaphone misses these (Flipkart's finding); this folds the usual variants instead.
 */
export const sound = (w: string) =>
  w
    .replace(/(.)\1+/g, "$1")
    .replace(/aa/g, "a")
    .replace(/(ee|ii)/g, "i")
    .replace(/(oo|uu)/g, "u")
    .replace(/w/g, "v")
    .replace(/([bdgkpt])h/g, "$1")
    .replace(/sh/g, "s")
    .replace(/ph/g, "f")
    .replace(/z/g, "j")
    .replace(/[aeiou]/g, (v, i: number) => (i === 0 ? v : ""))
    .replace(/h$/, "")

const tokens = (s: string) => s.split(" ").filter(Boolean)

/** Close enough to be a typo: one letter off up to 5 letters, two after; or the same sound. */
export function typo(q: string, word: string): boolean {
  if (q.length < 3 || word.length < 3) return false
  const allow = q.length >= 6 ? 2 : 1
  return (
    lev(q, word.slice(0, q.length + 1)) <= allow ||
    lev(q, word) <= allow ||
    sound(q) === sound(word)
  )
}

/**
 * How well a normalised query matches a normalised name and its extra words, 0 to 100.
 * Tiers in the order a command palette ranks them (Slack, Superhuman, match-sorter).
 */
export function quality(name: string, words: readonly string[], q: string): number {
  if (!q) return 0
  const single = phrase(name, words, q)
  if (single || !q.includes(" ")) return single
  // Several words: each must match on its own; the weakest decides.
  let worst = 100
  for (const w of tokens(q)) {
    const s = phrase(name, words, w)
    if (s < 45) return 0
    worst = Math.min(worst, s)
  }
  return worst
}

function phrase(name: string, words: readonly string[], q: string): number {
  if (name === q) return 100
  if (name.startsWith(q)) return 88
  if (words.includes(q)) return 78
  if (q.length >= 4 && name.replaceAll(" ", "").startsWith(q)) return 75 // "networth"
  if (` ${name}`.includes(` ${q}`)) return 72
  if (q.length >= 2 && !q.includes(" ") && initials(name).startsWith(q)) return 60
  if (words.some((w) => w.startsWith(q))) return 55
  if (words.some((w) => ` ${w}`.includes(` ${q}`))) return 45
  if (tokens(name).some((t) => typo(q, t)) || words.some((w) => tokens(w).some((t) => typo(q, t))))
    return 25
  return 0
}

const initials = (name: string) =>
  tokens(name)
    .map((t) => t[0])
    .join("")
