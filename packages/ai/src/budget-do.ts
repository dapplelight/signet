/**
 * An exact, global AI budget on Cloudflare Workers, backed by a Durable Object.
 *
 * `memoryBudgetStore` is per isolate, so "$5/day" is $5 per isolate per cold
 * start. Every request for one budget key reaches the same single-threaded
 * Durable Object, so the total it keeps is the real one.
 *
 * No `cloudflare:workers` import: the class uses the classic `fetch` interface,
 * so this module loads (and is testable) under Bun and Node.
 *
 *   // worker entry: export the class so the binding can find it
 *   export { BudgetCounter } from "@dapplelight/signet-ai/budget-do"
 *
 *   // wrangler.jsonc
 *   "durable_objects": { "bindings": [{ "name": "AI_BUDGET", "class_name": "BudgetCounter" }] },
 *   "migrations": [{ "tag": "v1", "new_sqlite_classes": ["BudgetCounter"] }]
 *
 *   createBudgetLedger(5, 86_400, { store: durableObjectBudgetStore(env.AI_BUDGET) })
 */

import type { BudgetStore } from "./budget.js"

/** The subset of DurableObjectState this uses. */
export type BudgetCounterState = {
  storage: {
    get<T>(key: string): Promise<T | undefined>
    put<T>(key: string, value: T): Promise<void>
    deleteAll(): Promise<void>
    setAlarm(scheduledTime: number): Promise<void>
  }
}

/** The subset of DurableObjectNamespace this uses. */
export type BudgetNamespace = {
  idFromName(name: string): unknown
  get(id: never): { fetch(input: string, init?: RequestInit): Promise<Response> }
}

type Spend = { at: number; usd: number }
type Body = { op: "spent" | "record"; windowSeconds: number; usd?: number; now: number }

export class BudgetCounter {
  constructor(private readonly state: BudgetCounterState) {}

  async fetch(request: Request): Promise<Response> {
    const { op, windowSeconds, usd, now } = (await request.json()) as Body
    const cutoff = now - windowSeconds * 1000
    const spends = ((await this.state.storage.get<Spend[]>("spends")) ?? []).filter(
      (s) => s.at > cutoff,
    )
    if (op === "record" && usd && usd > 0) {
      spends.push({ at: now, usd })
      // Empty the object once its newest spend leaves the window.
      await this.state.storage.setAlarm(now + windowSeconds * 1000)
    }
    await this.state.storage.put("spends", spends)
    return Response.json({ spent: spends.reduce((n, s) => n + s.usd, 0) })
  }

  async alarm(): Promise<void> {
    await this.state.storage.deleteAll()
  }
}

/** A BudgetStore over a BudgetCounter namespace. Throws when the object cannot be reached. */
export function durableObjectBudgetStore(namespace: BudgetNamespace): BudgetStore {
  const call = async (key: string, body: Body) => {
    const stub = namespace.get(namespace.idFromName(key) as never)
    const res = await stub.fetch("https://ai-budget/", {
      method: "POST",
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`AI budget store returned ${res.status}`)
    return ((await res.json()) as { spent: number }).spent
  }
  return {
    spent: (key, windowSeconds, now) => call(key, { op: "spent", windowSeconds, now }),
    async record(key, usd, windowSeconds, now) {
      await call(key, { op: "record", windowSeconds, usd, now })
    },
  }
}
