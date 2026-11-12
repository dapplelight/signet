// Test data only. Two unrelated apps on the same engine: a money app and a tasks-and-notes
// app. If anything about payments leaks into the engine, the tasks tests break.
import { createSearch, type Query, source } from "../../src/search/engine"
import {
  type AmountRange,
  amounts,
  commands,
  type DateRange,
  dates,
  people,
} from "../../src/search/readers"
import { memoryStore } from "../../src/search/usage"

export const NOW = new Date(2026, 10, 12, 10, 0).getTime()

type Page = { id: string; title: string; words: string[]; opens?: number }
const SCREENS: Page[] = [
  { id: "budgets", title: "Budgets", words: ["budget", "limit"], opens: 12 },
  { id: "analytics", title: "Analytics", words: ["spend", "charts", "insights"], opens: 8 },
  { id: "net-worth", title: "Net worth", words: ["wealth", "assets"], opens: 6 },
  {
    id: "privacy",
    title: "Private mode",
    words: ["privacy", "encryption", "encrypt", "pin", "lock"],
  },
  {
    id: "appearance",
    title: "Appearance",
    words: ["dark mode", "theme", "light", "text size", "font"],
  },
  { id: "notifications", title: "Notifications", words: ["alerts", "reminders"] },
  { id: "auto-add", title: "Auto-add payments", words: ["sms", "bank sms", "capture"] },
  { id: "sms-privacy", title: "SMS and your privacy", words: ["sms", "permission"] },
  { id: "household", title: "Household", words: ["family", "invite", "members"] },
  { id: "rules", title: "Rules", words: ["auto categorise", "rule"] },
  { id: "tax", title: "Tax", words: ["income tax", "regime", "80c"] },
  { id: "goals", title: "Goals", words: ["savings", "target"] },
  { id: "debts", title: "Debts", words: ["loan", "emi", "owe"] },
  { id: "insurance", title: "Insurance", words: ["policy", "renewal", "health"] },
  { id: "calculators", title: "Calculators", words: ["emi calculator", "sip", "fire", "xirr"] },
  { id: "duplicates", title: "Duplicates", words: ["duplicate", "same"] },
  { id: "export", title: "Export", words: ["csv", "download", "backup"] },
  { id: "language", title: "Language", words: ["hindi", "english", "bhasha"] },
]
const SETTINGS: Page[] = [
  { id: "hide-amounts", title: "Hide amounts", words: ["hide", "mask"] },
  { id: "text-size", title: "Text size", words: ["font", "bigger", "large text"] },
  { id: "month-start", title: "Month starts on", words: ["salary day", "cycle"] },
  { id: "privacy-pin", title: "Privacy PIN", words: ["pin", "change pin"] },
  { id: "lock-private", title: "Lock Private mode", words: ["lock", "forget key"] },
  { id: "bank-sms", title: "Bank SMS", words: ["sms", "read sms"] },
  { id: "haptics", title: "Haptics", words: ["vibration", "vibrate"] },
  { id: "sign-out", title: "Sign out", words: ["logout", "log out"] },
]
type Saved = { id: string; name: string; words: string[] }
const SAVED: Saved[] = [
  { id: "goal-goa", name: "Goa trip", words: ["goal", "trip", "travel"] },
  { id: "goal-kutch", name: "Kutch, Jan 2027", words: ["goal", "trip"] },
  { id: "debt-car", name: "Car loan", words: ["loan", "emi", "hdfc"] },
  { id: "debt-laptop", name: "Laptop EMI", words: ["emi", "bajaj"] },
  { id: "policy-star", name: "Star Health Family", words: ["insurance", "policy", "health"] },
  { id: "sub-netflix", name: "Netflix", words: ["subscription", "ott"] },
  { id: "acct-hdfc", name: "HDFC Swiggy ····0042", words: ["card", "credit card", "hdfc"] },
]
type Action = { id: string; title: string; words: string[] }
const ACTIONS: Action[] = [
  { id: "add", title: "Add expense", words: ["spend", "paid"] },
  { id: "scan", title: "Scan a bill", words: ["receipt", "photo"] },
  { id: "import", title: "Import a statement", words: ["statement", "pdf"] },
  { id: "budget-set", title: "Set a budget", words: ["budget", "limit"] },
]
export const PEOPLE = ["Arjun", "Meera", "Rohan"]

export type Payment = {
  id: string
  shop: string
  cat: string
  amt: number
  at: number
  who: string
  out: boolean
}
const SHOPS: [string, string, number][] = [
  ["Swiggy", "Food delivery", 380],
  ["Zomato", "Food delivery", 520],
  ["Zepto", "Groceries", 640],
  ["Uber", "Cabs", 260],
  ["BESCOM", "Electricity", 2200],
  ["Apollo Pharmacy", "Medicine", 900],
  ["Indian Oil", "Fuel", 2500],
  ["IndiGo", "Flights", 7200],
  ["Rent", "Rent", 45000],
]
const D = 86_400_000
export const PAYMENTS: Payment[] = Array.from({ length: 180 }, (_, i) => {
  const [shop, cat, base] = SHOPS[i % SHOPS.length] as [string, string, number]
  return {
    id: `p${i}`,
    shop,
    cat,
    amt: base + ((i * 37) % 200),
    at: NOW - Math.floor(i / 2) * D,
    who: PEOPLE[i % 2] as string,
    out: true,
  }
}).concat([
  {
    id: "salary",
    shop: "Salary",
    cat: "Salary",
    amt: 171400,
    at: NOW - 11 * D,
    who: "Arjun",
    out: false,
  },
])

const MERCHANTS = SHOPS.map(([name]) => ({
  name,
  count: PAYMENTS.filter((p) => p.shop === name).length,
}))

function findPayments(q: Query): Payment[] {
  const d = q.filters.dates as DateRange | undefined
  const a = q.filters.amounts as AmountRange | undefined
  const who = q.filters.people as string[] | undefined
  if (!q.text && !d && !a && !who) return []
  const words = [q.text, q.alt].filter(Boolean)
  return PAYMENTS.filter(
    (p) =>
      (!d || (p.at >= d.from.getTime() && p.at <= d.to.getTime())) &&
      (!a ||
        ((a.min == null || p.amt >= a.min) &&
          (a.max == null || p.amt <= a.max) &&
          (a.exact == null || p.amt === a.exact))) &&
      (!who || who.includes(p.who)) &&
      (!words.length || words.some((w) => `${p.shop} ${p.cat}`.toLowerCase().includes(w))),
  ).sort((x, y) => y.at - x.at)
}

export const money = () =>
  createSearch({
    now: () => NOW,
    store: memoryStore(),
    words: {
      bijli: "electricity",
      dawai: "medicine",
      petrol: "fuel",
      cab: "cabs",
      khana: "food",
      pvt: "private",
    },
    readers: [
      commands(["add", "paid", "split"]),
      dates(),
      amounts((n) => `₹${n.toLocaleString("en-IN")}`),
      people(() => PEOPLE),
    ],
    sources: [
      source<Page>({
        kind: "screen",
        title: "Screens",
        items: SCREENS,
        key: (p) => `screen:${p.id}`,
        name: (p) => p.title,
        words: (p) => p.words,
        weight: (p) => (p.opens ?? 0) / 2,
      }),
      source<Page>({
        kind: "setting",
        title: "Settings",
        items: SETTINGS,
        key: (p) => `setting:${p.id}`,
        name: (p) => p.title,
        words: (p) => p.words,
        prior: 0.95,
      }),
      source<Saved>({
        kind: "saved",
        title: "Saved",
        items: SAVED,
        key: (s) => `saved:${s.id}`,
        name: (s) => s.name,
        words: (s) => s.words,
        weight: () => 3,
      }),
      source<Action>({
        kind: "action",
        title: "Actions",
        items: ACTIONS,
        key: (a) => `action:${a.id}`,
        name: (a) => a.title,
        words: (a) => a.words,
        prior: 0.9,
      }),
      source<{ name: string; count: number }>({
        kind: "merchant",
        title: "Merchants",
        items: MERCHANTS,
        key: (m) => `merchant:${m.name}`,
        name: (m) => m.name,
        weight: (m) => Math.log2(m.count),
      }),
      source<string>({
        kind: "person",
        title: "People",
        items: PEOPLE,
        key: (p) => `person:${p}`,
        name: (p) => p,
      }),
      source<Payment>({
        kind: "payment",
        title: "Payments",
        find: findPayments,
        key: (p) => `payment:${p.id}`,
        name: (p) => p.shop,
        usesFilters: true,
        keepOrder: true,
      }),
    ],
  })

type Task = { id: string; title: string; tags: string[]; due: number; done: boolean }
type Note = { id: string; title: string; body: string }
const TASKS: Task[] = [
  { id: "walk", title: "Evening walk", tags: ["habit", "health"], due: NOW, done: false },
  {
    id: "dentist",
    title: "Book dentist appointment",
    tags: ["health", "doctor"],
    due: NOW + 2 * D,
    done: false,
  },
  { id: "plants", title: "Water the plants", tags: ["home", "chore"], due: NOW - D, done: true },
  {
    id: "rent",
    title: "Pay rent to landlord",
    tags: ["money", "home"],
    due: NOW - 9 * D,
    done: true,
  },
  { id: "call-mom", title: "Call Mom", tags: ["family"], due: NOW - D, done: false },
  {
    id: "gym",
    title: "Gym, leg day",
    tags: ["habit", "fitness", "workout"],
    due: NOW - 40 * D,
    done: true,
  },
]
const NOTES: Note[] = [
  { id: "trip", title: "Kutch trip packing list", body: "jacket, charger, tickets" },
  { id: "recipes", title: "Dal makhani recipe", body: "soak overnight" },
  { id: "books", title: "Books to read", body: "Atomic Habits" },
]
const TEND_SCREENS: Page[] = [
  { id: "today", title: "Today", words: ["home", "aaj"] },
  { id: "habits", title: "Habits", words: ["streak", "routine"] },
  { id: "reminders", title: "Reminder settings", words: ["notifications", "alerts"] },
]

export const tasks = () =>
  createSearch({
    now: () => NOW,
    store: memoryStore(),
    words: { exercise: "workout", doctor: "dentist", ghar: "home" },
    readers: [commands(["remind", "todo"]), dates()],
    sources: [
      source<Task>({
        kind: "task",
        title: "Tasks",
        key: (t) => `task:${t.id}`,
        name: (t) => t.title,
        words: (t) => t.tags,
        usesFilters: true,
        // Dates filter tasks by due day; text alone uses the engine's matching through `items`.
        find: (q) => {
          const d = q.filters.dates as DateRange | undefined
          if (!d) return []
          return TASKS.filter(
            (t) =>
              t.due >= d.from.getTime() &&
              t.due <= d.to.getTime() &&
              (!q.text || `${t.title} ${t.tags.join(" ")}`.toLowerCase().includes(q.text)),
          )
        },
      }),
      source<Task>({
        kind: "task-text",
        title: "Tasks",
        items: TASKS,
        key: (t) => `task:${t.id}`,
        name: (t) => t.title,
        words: (t) => t.tags,
      }),
      source<Note>({
        kind: "note",
        title: "Notes",
        items: NOTES,
        key: (n) => `note:${n.id}`,
        name: (n) => n.title,
        words: (n) => n.body.split(", "),
      }),
      source<Page>({
        kind: "screen",
        title: "Screens",
        items: TEND_SCREENS,
        key: (p) => `screen:${p.id}`,
        name: (p) => p.title,
        words: (p) => p.words,
      }),
    ],
  })
