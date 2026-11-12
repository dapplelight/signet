import { describe, expect, it } from "bun:test"
import type { Result } from "../../src/search/engine"
import { money, tasks } from "./fixtures"

// The fixed search list: each search and the result it must return, scored like LinkedIn and Slack grade
// search (top-1, top-3, mean reciprocal rank). Add a case for every ranking complaint; never loosen one.
type Case = { q: string; want: string; top?: 1 | 3 }

const MONEY: Case[] = [
  { q: "private", want: "screen:privacy", top: 1 },
  { q: "privacy", want: "screen:privacy" },
  { q: "pri", want: "screen:privacy" },
  { q: "pin", want: "setting:privacy-pin" },
  { q: "encrypt", want: "screen:privacy", top: 1 },
  { q: "privte", want: "screen:privacy" },
  { q: "hide", want: "setting:hide-amounts", top: 1 },
  { q: "dark mode", want: "screen:appearance", top: 1 },
  { q: "dark", want: "screen:appearance", top: 1 },
  { q: "font", want: "setting:text-size" },
  { q: "sms", want: "setting:bank-sms" },
  { q: "logout", want: "setting:sign-out", top: 1 },
  { q: "budget", want: "screen:budgets", top: 1 },
  { q: "nw", want: "screen:net-worth" },
  { q: "net", want: "screen:net-worth", top: 1 },
  { q: "loan", want: "saved:debt-car" },
  { q: "emi", want: "saved:debt-laptop" },
  { q: "goa", want: "saved:goal-goa", top: 1 },
  { q: "netflix", want: "saved:sub-netflix", top: 1 },
  { q: "insurance", want: "screen:insurance" },
  { q: "star health", want: "saved:policy-star", top: 1 },
  { q: "swiggy", want: "merchant:Swiggy", top: 1 },
  { q: "swigy", want: "merchant:Swiggy", top: 1 },
  { q: "zomatto", want: "merchant:Zomato", top: 1 },
  { q: "apollo", want: "merchant:Apollo Pharmacy", top: 1 },
  { q: "pharmacy", want: "merchant:Apollo Pharmacy" },
  { q: "meera", want: "payment:p1", top: 1 },
  { q: "swiggy last month", want: "payment:p27", top: 1 },
  { q: "uber kal", want: "payment:p3", top: 1 },
  { q: "bijli", want: "payment:p4" },
  { q: "dawai", want: "payment:p5" },
  { q: "over 40k", want: "payment:p8", top: 1 },
  { q: "salary", want: "payment:salary" },
  { q: "scan", want: "action:scan", top: 1 },
  { q: "import", want: "action:import" },
  { q: "statement", want: "action:import" },
  { q: "export", want: "screen:export", top: 1 },
  { q: "hindi", want: "screen:language", top: 1 },
  { q: "family", want: "screen:household", top: 1 },
  { q: "vibration", want: "setting:haptics", top: 1 },
  // Added from the judge run (55 realistic searches, 12 Nov 2026).
  { q: "pvt mode", want: "screen:privacy", top: 1 },
  { q: "networth", want: "screen:net-worth", top: 1 },
  { q: "privasy", want: "screen:privacy", top: 1 },
  { q: "budgt", want: "screen:budgets", top: 1 },
  { q: "bigger text", want: "setting:text-size", top: 1 },
  { q: "log out", want: "setting:sign-out", top: 1 },
  { q: "zomato pichle mahine", want: "payment:p28", top: 1 },
  { q: "apollo 500 se zyada", want: "payment:p5", top: 1 },
  { q: "rent over 40k", want: "payment:p8", top: 1 },
  { q: "meera swiggy", want: "payment:p9", top: 1 },
  { q: "car emi", want: "saved:debt-car", top: 1 },
  { q: "netflix subscription", want: "saved:sub-netflix", top: 1 },
  { q: "hdfc card", want: "saved:acct-hdfc", top: 1 },
  { q: "80c", want: "screen:tax", top: 1 },
  { q: "csv", want: "screen:export", top: 1 },
  { q: "bhasha", want: "screen:language", top: 1 },
  { q: "salary day", want: "setting:month-start", top: 1 },
  { q: "under 300", want: "payment:p120" },
]

const TASKS: Case[] = [
  { q: "walk", want: "task:walk", top: 1 },
  { q: "dentist", want: "task:dentist", top: 1 },
  { q: "doctor", want: "task:dentist", top: 1 },
  { q: "exercise", want: "task:gym" },
  { q: "plants kal", want: "task:plants", top: 1 },
  { q: "mom", want: "task:call-mom", top: 1 },
  { q: "kutch", want: "note:trip", top: 1 },
  { q: "charger", want: "note:trip" },
  { q: "dal", want: "note:recipes", top: 1 },
  { q: "habits", want: "screen:habits", top: 1 },
  { q: "streak", want: "screen:habits", top: 1 },
  { q: "reminder", want: "screen:reminders" },
  { q: "dentsit", want: "task:dentist", top: 1 },
  { q: "leg day", want: "task:gym", top: 1 },
  { q: "mom call", want: "task:call-mom", top: 1 },
  { q: "packing", want: "note:trip", top: 1 },
  { q: "notifications", want: "screen:reminders", top: 1 },
  { q: "today", want: "task:walk", top: 1 },
]

/** Keys in the order the screen shows them: best match, then each section's rows. */
const shown = (r: Result) => [
  ...(r.best ? [r.best.key] : []),
  ...r.sections.flatMap((s) => s.hits.map((h) => h.key)),
]

function grade(name: string, make: () => ReturnType<typeof money>, cases: Case[]) {
  describe(`search list: ${name}`, () => {
    const ranks: number[] = []
    for (const c of cases) {
      it(`"${c.q}" -> ${c.want} in top ${c.top ?? 3}`, () => {
        const order = shown(make().search(c.q))
        const rank = order.indexOf(c.want) + 1
        ranks.push(rank)
        expect(rank, `got ${order.slice(0, 5).join(", ")}`).toBeGreaterThan(0)
        expect(rank).toBeLessThanOrEqual(c.top ?? 3)
      })
    }
    it("scoreboard", () => {
      const n = ranks.length
      const top1 = ranks.filter((r) => r === 1).length / n
      const top3 = ranks.filter((r) => r > 0 && r <= 3).length / n
      const mrr = ranks.reduce((a, r) => a + (r ? 1 / r : 0), 0) / n
      console.log(
        `${name}: ${n} searches · top-1 ${(top1 * 100).toFixed(0)}% · top-3 ${(top3 * 100).toFixed(0)}% · MRR ${mrr.toFixed(2)}`,
      )
      expect(top3).toBe(1)
      expect(mrr).toBeGreaterThanOrEqual(0.85)
    })
  })
}

grade("money app", money, MONEY)
grade("tasks app", tasks, TASKS)
