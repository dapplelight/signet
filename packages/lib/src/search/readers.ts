/**
 * Readers pull structured parts out of a query before text matching (Stripe's dashboard search does the same).
 * Each one takes the padded, lower-case query and returns what it found plus the query without it. Apps pick
 * the readers they need; a reader only an app needs can live in that app.
 */
export type Chip = { reader: string; label: string; value: unknown }
export type ReaderContext = { now: Date }
export type Reader = {
  name: string
  read(s: string, ctx: ReaderContext): { s: string; chips: Chip[] }
}

export type DateRange = { from: Date; to: Date }
export type AmountRange = { min?: number; max?: number; exact?: number }
export type Command = { verb: string; amount?: number }

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
]
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const day = (d: Date, add = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + add)
const end = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
const month = (y: number, m: number): DateRange => ({
  from: new Date(y, m, 1),
  to: end(new Date(y, m + 1, 0)),
})

/** Replace the first match of `re` (which must have a leading and trailing space) and hand back its groups. */
function take(s: string, re: RegExp): [string, RegExpMatchArray | null] {
  const m = s.match(re)
  return m ? [s.replace(re, " "), m] : [s, null]
}

/** What a date chip says. An app passes its own words (its language); English by default. */
export type DateLabels = {
  today: string
  yesterday: string
  thisWeek: string
  lastWeek: string
  lastDays: (n: number) => string
  /** `month` is 0-11; `year` is null for the current year. */
  month: (month: number, year: number | null) => string
}
const DATE_LABELS: DateLabels = {
  today: "Today",
  yesterday: "Yesterday",
  thisWeek: "This week",
  lastWeek: "Last week",
  lastDays: (n) => `Last ${n} days`,
  month: (m, y) => (y === null ? cap(MONTHS[m] as string) : `${cap(MONTHS[m] as string)} ${y}`),
}

/** Dates in English and Hindi: today/aaj, yesterday/kal, this/last week, month, year, "last 30 days", March. */
export function dates(labels: Partial<DateLabels> = {}): Reader {
  const L = { ...DATE_LABELS, ...labels }
  return {
    name: "dates",
    read(input, { now }) {
      let s = input
      const chips: Chip[] = []
      const add = (label: string, value: DateRange) => chips.push({ reader: "dates", label, value })
      const monday = day(now, -((now.getDay() + 6) % 7))
      const rules: [RegExp, (m: RegExpMatchArray) => void][] = [
        [/ (today|aaj) /, () => add(L.today, { from: day(now), to: end(now) })],
        [
          / (yesterday|kal) /,
          () => add(L.yesterday, { from: day(now, -1), to: end(day(now, -1)) }),
        ],
        [/ (this week|is hafte) /, () => add(L.thisWeek, { from: monday, to: end(now) })],
        [
          / (last week|pichle hafte) /,
          () => add(L.lastWeek, { from: day(monday, -7), to: end(day(monday, -1)) }),
        ],
        [
          / (?:last|past|pichle) ([1-9]\d{0,2}) (?:days|din) /,
          (m) => add(L.lastDays(Number(m[1])), { from: day(now, -Number(m[1]) + 1), to: end(now) }),
        ],
        [
          / (this month|is mahine) /,
          () => add(L.month(now.getMonth(), null), month(now.getFullYear(), now.getMonth())),
        ],
        [
          / (last month|pichle mahine) /,
          () => {
            const d = new Date(now.getFullYear(), now.getMonth() - 1, 1)
            add(
              L.month(d.getMonth(), d.getFullYear() === now.getFullYear() ? null : d.getFullYear()),
              month(d.getFullYear(), d.getMonth()),
            )
          },
        ],
        [
          / (this year|is saal) /,
          () =>
            add(String(now.getFullYear()), {
              from: new Date(now.getFullYear(), 0, 1),
              to: end(now),
            }),
        ],
        [
          / (last year|pichle saal) /,
          () => {
            const y = now.getFullYear() - 1
            add(String(y), { from: new Date(y, 0, 1), to: end(new Date(y, 11, 31)) })
          },
        ],
      ]
      for (const [re, fn] of rules) {
        const [rest, m] = take(s, re)
        if (!m) continue
        const before = chips.length
        fn(m)
        if (chips.length > before) s = rest
      }
      // Month names: the first word that really is one ("marathon march" -> March; "may i pay" is not May).
      for (const m of s.matchAll(MONTH_RE)) {
        const word = m[1] as string
        const mo = MONTHS.findIndex((x) => x.startsWith(word.slice(0, 3)))
        const full = MONTHS[mo] as string
        if (!full.startsWith(word) || (word === "may" && !m[2] && s.trim() !== "may")) continue
        const y = m[2]
          ? Number(m[2])
          : mo > now.getMonth()
            ? now.getFullYear() - 1
            : now.getFullYear()
        add(L.month(mo, y === now.getFullYear() ? null : y), month(y, mo))
        s = s.replace(m[0], " ")
        break
      }
      return { s, chips }
    },
  }
}
const MONTH_RE = /(?<= )((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*) (?:(20\d\d) )?/g

const NUM = String.raw`(\d+(?:\.\d+)?) ?(k|l|lac|lakh|lakhs|cr|crore|crores)?`
export function amount(n: string, unit?: string): number {
  const u = (unit ?? "").toLowerCase()
  const x = Number(n)
  if (u === "k") return x * 1e3
  if (u.startsWith("l")) return x * 1e5
  if (u.startsWith("c")) return x * 1e7
  return x
}

/**
 * Amounts: 500, ₹1,200, 3k, 1.2L, 2 lakh, 1.5cr; over/under/above/below/zyada/kam; 500-1000 or 500 to 1k.
 * A bare number counts only when it is the whole query (otherwise "goa 2027" would be an amount).
 */
/** What an amount chip says, given the formatted amounts. English by default. */
export type AmountLabels = {
  over: (min: string) => string
  under: (max: string) => string
  range: (min: string, max: string) => string
}
const AMOUNT_LABELS: AmountLabels = {
  over: (a) => `Over ${a}`,
  under: (b) => `Under ${b}`,
  range: (a, b) => `${a}–${b}`,
}

export function amounts(
  format: (n: number) => string = (n) => n.toLocaleString("en-IN"),
  labels: Partial<AmountLabels> = {},
): Reader {
  const L = { ...AMOUNT_LABELS, ...labels }
  return {
    name: "amounts",
    read(input) {
      let s = input
        .replace(/₹|(?<= )rs\.?(?=\s?\d)/g, " ")
        .replace(/(\d),(?=\d)/g, "$1")
        .replace(/\s+/g, " ")
      const v: AmountRange = {}
      let label = ""
      let m: RegExpMatchArray | null
      ;[s, m] = take(s, new RegExp(` ${NUM} ?(?:-|to) ?${NUM} `))
      if (m) {
        v.min = amount(m[1] as string, m[2])
        v.max = amount(m[3] as string, m[4])
        if (v.min > v.max) [v.min, v.max] = [v.max, v.min]
        label = L.range(format(v.min), format(v.max))
      }
      ;[s, m] = take(s, new RegExp(` (?:>|over|above|more than|zyada|se zyada) ?${NUM} `))
      if (m) {
        v.min = amount(m[1] as string, m[2])
        label = L.over(format(v.min))
      }
      if (!m) [s, m] = take(s, new RegExp(` ${NUM} (?:se )?(?:zyada|jyada|upar|plus|\\+) `))
      if (m && v.min == null) {
        v.min = amount(m[1] as string, m[2])
        label = L.over(format(v.min))
      }
      ;[s, m] = take(s, new RegExp(` (?:<|under|below|less than|kam|se kam) ?${NUM} `))
      if (!m) [s, m] = take(s, new RegExp(` ${NUM} (?:se )?(?:kam|neeche) `))
      if (m) {
        v.max = amount(m[1] as string, m[2])
        label = v.min != null ? L.range(format(v.min), format(v.max)) : L.under(format(v.max))
      }
      if (!label) {
        ;[s, m] = take(s, new RegExp(`^ ${NUM} $`))
        if (m) {
          v.exact = amount(m[1] as string, m[2])
          label = format(v.exact)
        }
      }
      return { s, chips: label ? [{ reader: "amounts", label, value: v }] : [] }
    },
  }
}

/** People by name or @name, from the app's own list. Value is the name as the app wrote it. */
export function people(names: () => readonly string[]): Reader {
  return {
    name: "people",
    read(input) {
      let s = input
      const chips: Chip[] = []
      // Full names before first names, so "rahul verma" is Rahul Verma even when Rahul Sharma is listed first.
      const all = [...names()].sort((a, b) => b.length - a.length)
      const found = new Set<string>()
      for (const pick of [(n: string) => n, (n: string) => n.split(" ")[0] as string])
        for (const name of all) {
          if (found.has(name)) continue
          const [rest, m] = take(s, new RegExp(` @?${esc(pick(name.toLowerCase()))} `))
          if (!m) continue
          s = rest
          found.add(name)
          chips.push({ reader: "people", label: name, value: name })
        }
      return { s, chips }
    },
  }
}

/**
 * A leading verb turns the query into a command: "add 250 chai" -> { verb: "add", amount: 250 }, the rest stays
 * as text. Only the verbs the app lists count; what a command does is the app's business.
 */
export function commands(verbs: readonly string[]): Reader {
  return {
    name: "commands",
    read(input) {
      const m = input.match(new RegExp(`^ (${verbs.map(esc).join("|")}) `))
      if (!m) return { s: input, chips: [] }
      let s = ` ${input.slice(m[0].length)}`
        .replace(/₹|(?<= )rs\.?(?=\s?\d)/g, " ")
        .replace(/(\d),(?=\d)/g, "$1")
        .replace(/\s+/g, " ")
      const value: Command = { verb: m[1] as string }
      const n = s.match(new RegExp(` ${NUM} `))
      if (n) {
        value.amount = amount(n[1] as string, n[2])
        s = s.replace(n[0], " ")
      }
      return { s, chips: [{ reader: "commands", label: cap(value.verb), value }] }
    },
  }
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
