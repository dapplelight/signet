import type { Chip, Reader } from "./readers.js"
import { norm, quality, typo } from "./text.js"
import { addPick, boost, memoryStore, recent, type Store } from "./usage.js"

/** What the readers made of the query. `alt` is `text` with the app's word list applied ("bijli" -> "electricity"). */
export type Query = {
  raw: string
  text: string
  alt: string
  chips: Chip[]
  /** Each reader's value by reader name; people collects a list. */
  filters: Record<string, unknown>
}

/**
 * One kind of result. Small lists hand over `items` and the engine matches them; big lists (payments, server
 * data) provide `find`, which queries the app's own store with the parsed query and returns candidates.
 */
export type Source<T> = {
  kind: string
  title: string
  key(item: T): string
  name(item: T): string
  /** Extra names people search by ("pin", "encrypt" for Private mode). */
  words?(item: T): readonly string[]
  items?: readonly T[] | (() => readonly T[])
  find?(q: Query): readonly T[]
  /** 0 to 6 points: how much the item gets used anyway (payment count, how often a screen is opened). */
  weight?(item: T): number
  /** Multiplier on the match score, default 1. */
  prior?: number
  /** The section leads whenever the query has a chip (payments with a date or amount). */
  usesFilters?: boolean
  /** Keep `find`'s order (newest first) instead of sorting by score. */
  keepOrder?: boolean
}

export type Hit = { kind: string; key: string; name: string; item: unknown; score: number }
export type Section = { kind: string; title: string; score: number; hits: Hit[] }
export type Result = {
  query: Query
  /** One row on top, only when a single result clearly wins. */
  best: Hit | null
  sections: Section[]
  /** The word the engine searched for instead of a typo ("swigy" -> "swiggy"), or null. */
  fixed: string | null
}

export type Config = {
  sources: readonly Source<unknown>[]
  readers?: readonly Reader[]
  /** The app's word list: what people type -> what the data says. */
  words?: Readonly<Record<string, string>>
  store?: Store
  now?: () => number
}

/** Erases a source's item type so sources of different kinds share one list. */
export const source = <T>(s: Source<T>) => s as unknown as Source<unknown>

const BEST_FLOOR = 70
const BEST_MARGIN = 12
const FILTER_LEAD = 1000 // above any match score: a date, amount or person chip means you want those rows

export function createSearch(cfg: Config) {
  const store = cfg.store ?? memoryStore()
  const now = cfg.now ?? Date.now
  const words = cfg.words ?? {}
  const swap = (t: string) =>
    t
      .split(" ")
      .map((w) => words[w] ?? w)
      .join(" ")

  function parse(raw: string): Query {
    let s = ` ${raw.toLowerCase().replace(/\s+/g, " ").trim()} `
    const chips: Chip[] = []
    const ctx = { now: new Date(now()) }
    for (const r of cfg.readers ?? []) {
      const out = r.read(s, ctx)
      s = out.s.replace(/\s+/g, " ")
      if (s === "") s = " "
      chips.push(...out.chips)
    }
    const filters: Record<string, unknown> = {}
    for (const c of chips) {
      if (c.reader === "people") filters.people = [...((filters.people as string[]) ?? []), c.value]
      else filters[c.reader] = c.value
    }
    const text = norm(s)
    return { raw, text, alt: swap(text), chips, filters }
  }

  function score(src: Source<unknown>, item: unknown, q: Query, picks: ReturnType<Store["load"]>) {
    const name = norm(src.name(item))
    const extra = (src.words?.(item) ?? []).map(norm)
    const m = Math.max(
      quality(name, extra, q.text),
      q.alt === q.text ? 0 : quality(name, extra, q.alt) * 0.95,
    )
    return {
      m,
      s:
        m * (src.prior ?? 1) +
        Math.min(6, src.weight?.(item) ?? 0) +
        boost(picks, src.key(item), norm(q.raw), now()),
    }
  }

  function run(q: Query): { sections: Section[]; typos: Hit[]; strong: boolean } {
    const picks = store.load()
    const sections: Section[] = []
    const typos: Hit[] = []
    let strong = false // a real match by match quality alone, before prior and boost
    for (const src of cfg.sources) {
      const hits: Hit[] = []
      let top = 0
      if (src.find) {
        for (const item of src.find(q)) {
          const { m, s } = q.text ? score(src, item, q, picks) : { m: 0, s: 0 }
          top = Math.max(top, s)
          if (m >= 45) strong = true
          hits.push({ kind: src.kind, key: src.key(item), name: src.name(item), item, score: s })
        }
        if (!src.keepOrder) hits.sort(order)
        if (hits.length)
          sections.push({
            kind: src.kind,
            title: src.title,
            score: src.usesFilters && q.chips.length ? FILTER_LEAD : top,
            hits,
          })
        continue
      }
      if (!q.text) continue
      const items = typeof src.items === "function" ? src.items() : (src.items ?? [])
      for (const item of items) {
        const { m, s } = score(src, item, q, picks)
        if (m === 0) continue
        const hit = { kind: src.kind, key: src.key(item), name: src.name(item), item, score: s }
        if (m >= 45) strong = true
        if (m <= 25) typos.push(hit)
        else hits.push(hit)
      }
      hits.sort(order)
      if (hits.length)
        sections.push({ kind: src.kind, title: src.title, score: (hits[0] as Hit).score, hits })
    }
    return { sections, typos, strong }
  }

  function search(raw: string): Result {
    const query = parse(raw)
    let { sections, typos, strong } = run(query)
    let fixed: string | null = null
    // Nothing real matched: search for the nearest name instead (Uber Eats' zero-result fallback).
    if (!strong && typos.length && !query.text.includes(" ")) {
      const word = nearest(query.text, typos)
      if (word) {
        const again = { ...query, text: word, alt: swap(word) }
        const r = run(again)
        if (r.sections.length) {
          sections = r.sections
          fixed = word
        }
      }
    }
    sections.sort((a, b) => b.score - a.score)
    let best: Hit | null = null
    if (!query.chips.length) {
      const ranked = sections.flatMap((s) => s.hits).sort(order)
      const [a, b] = ranked
      if (a && a.score >= BEST_FLOOR && (!b || a.score - b.score >= BEST_MARGIN)) {
        best = a
        for (const s of sections) s.hits = s.hits.filter((h) => h !== a)
        sections = sections.filter((s) => s.hits.length)
      }
    }
    return { query: { ...query, text: fixed ?? query.text }, best, sections, fixed }
  }

  /** Call when a result is opened from search. */
  function pick(raw: string, hit: Pick<Hit, "key">) {
    store.save(addPick(store.load(), { q: norm(raw), key: hit.key, at: now() }))
  }

  return { search, pick, recent: (n?: number) => recent(store.load(), n), parse }
}

const order = (a: Hit, b: Hit) => b.score - a.score || a.name.length - b.name.length

/** The word in the typo hits' names closest to what was typed. */
function nearest(q: string, typos: readonly Hit[]): string | null {
  for (const h of [...typos].sort(order)) {
    const w = norm(h.name)
      .split(" ")
      .find((t) => typo(q, t))
    if (w) return w
  }
  return null
}
