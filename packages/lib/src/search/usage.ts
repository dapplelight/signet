/**
 * What you picked from search, kept on the device. Ranking uses it the way Slack's quick switcher does: each of
 * an item's last 10 picks scores by age, and a pick made after typing the same letters counts double (Firefox's
 * adaptive history). The app decides where it is stored (MMKV, localStorage, a file).
 */
export type Pick = { q: string; key: string; at: number }
export type Store = { load(): Pick[]; save(picks: Pick[]): void }

export function memoryStore(start: Pick[] = []): Store {
  let picks = start
  return {
    load: () => picks,
    save: (p) => {
      picks = p
    },
  }
}

const H = 3_600_000
const D = 24 * H
const BUCKETS: [number, number][] = [
  [4 * H, 100],
  [D, 80],
  [3 * D, 60],
  [7 * D, 40],
  [30 * D, 20],
  [90 * D, 10],
]
const KEEP = 500
export const BOOST_CAP = 20

const bucket = (age: number) => BUCKETS.find(([upTo]) => age <= upTo)?.[1] ?? 0

/** 0 to BOOST_CAP. Capped so a past pick never beats a clearly better name match. */
export function boost(picks: readonly Pick[], key: string, q: string, now: number): number {
  let sum = 0
  let n = 0
  for (let i = picks.length - 1; i >= 0 && n < 10; i--) {
    const p = picks[i] as Pick
    if (p.key !== key) continue
    sum += bucket(now - p.at) * (q && p.q === q ? 2 : 1)
    n++
  }
  return Math.min(BOOST_CAP, sum / 10)
}

export const addPick = (picks: readonly Pick[], p: Pick) => [...picks, p].slice(-KEEP)

/** Your last searches that led somewhere, newest first, each once. */
export function recent(picks: readonly Pick[], n = 5): string[] {
  const out: string[] = []
  for (let i = picks.length - 1; i >= 0 && out.length < n; i--) {
    const q = (picks[i] as Pick).q
    if (q && !out.includes(q)) out.push(q)
  }
  return out
}
