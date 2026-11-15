/**
 * Demo mode: one switch that wires every fake and your seed data, so an app
 * runs fully offline for a demo, a screenshot run or a Playwright suite.
 *
 *   // worker.ts
 *   const demo = isDemo(env) ? await createDemo({ seed: SEED, user: SEED.users[0] }) : null
 *   const payments = demo?.payments ?? createPayments({ gateways: [razorpay(...)], db })
 *   const notifier = createNotifier({
 *     channels: demo?.senders ?? realSenders,
 *     store: demo?.notifyStore ?? kvNotifyStore(kv),
 *     ...
 *   })
 *   app.all("/__signet/*", async (c) => (await demo?.handle(c.req.raw)) ?? c.notFound())
 *
 * `handle` serves what the dev overlay and the Playwright helpers call:
 *   GET  /__signet/dev    user, plan, entitlements, flags, outbox (JSON)
 *   POST /__signet/seed   replace the data with the body
 *   POST /__signet/reset  back to the seed: outbox, notify store, gateways,
 *                         payments store and clock all start over
 *   POST /__signet/pay    { gateway, checkoutId, status? }: finish a fake checkout
 *                         and deliver its signed webhook to `payments`
 */
import {
  createPayments,
  memoryStore,
  type Payments,
  type PaymentsStore,
} from "@dapplelight/signet-payments"
import { type FakeClock, fakeClock } from "./clock.js"
import {
  createOutbox,
  type FakeNotifyStore,
  fakeNotifyStore,
  fakeSenders,
  type Outbox,
  type OutboxMessage,
} from "./notify.js"
import { type FakeGateway, fakeGateway } from "./payments.js"

/** What the dev overlay shows. Every field is optional. */
export type DevState = {
  user?: { id: string; email?: string; name?: string } | null
  plan?: string
  entitlements?: string[]
  flags?: Record<string, boolean | string | number>
  outbox?: OutboxMessage[]
  demo?: boolean
}

/** True when `SIGNET_DEMO` is "1" or "true". Pass the env object; nothing is read at import time. */
export const isDemo = (env: Record<string, string | undefined>) =>
  env.SIGNET_DEMO === "1" || env.SIGNET_DEMO === "true"

export type DemoOptions<D> = {
  /** Your seed data. Deep-copied; `demo.data` is the live copy and `reset()` restores it. */
  seed?: D
  user?: DevState["user"]
  plan?: string
  entitlements?: string[]
  flags?: Record<string, boolean | string | number>
  /** Start time for the fake clock. Default now. */
  start?: number | string | Date
  /** Replies for the fake AI model (needs `ai` installed). Omit for no model. */
  ai?: unknown
  /** `APP_ENV`. Demo mode refuses "production" unless `allowProduction`. */
  appEnv?: string
  /** A public demo deployment that should never touch real providers. */
  allowProduction?: boolean
  /** Called after `/__signet/seed` and `/__signet/reset`, to load `data` into your store. */
  onSeed?: (data: D) => void | Promise<void>
}

export type Demo<D> = {
  clock: FakeClock
  outbox: Outbox
  senders: ReturnType<typeof fakeSenders>["senders"]
  /** The notify store for `createNotifier`: deliveries, inbox, prefs, opt-ins. */
  notifyStore: FakeNotifyStore
  gateways: { razorpay: FakeGateway; stripe: FakeGateway; payu: FakeGateway }
  /** `createPayments` over the fake gateways with an in-memory store (emptied by `reset`). */
  payments: Payments
  /** The payments store behind `payments`: records, inbox, ledger. */
  paymentsStore: PaymentsStore
  /** The fake AI model, when `ai` replies were given. */
  model?: import("./ai.js").FakeModel
  /** The live data. */
  data: D
  state: DevState
  reset(): Promise<void>
  /** Answers the `/__signet/*` routes, or null for any other request. */
  handle(request: Request): Promise<Response | null>
}

export async function createDemo<D = unknown>(options: DemoOptions<D> = {}): Promise<Demo<D>> {
  if (options.appEnv === "production" && !options.allowProduction)
    throw new Error(
      "SECURITY: demo mode fakes payments and drops messages; refusing in production (set allowProduction for a public demo).",
    )
  const clock = fakeClock(options.start ?? Date.now())
  const { outbox, senders } = fakeSenders(createOutbox({ now: clock.now }))
  const gateways = {
    razorpay: fakeGateway("razorpay", { now: clock.now }),
    stripe: fakeGateway("stripe", { now: clock.now }),
    payu: fakeGateway("payu", { now: clock.now }),
  }
  const notifyStore = fakeNotifyStore({ now: clock.now })
  // One store object for the app to hold; reset swaps what is behind it.
  let inner = memoryStore()
  const paymentsStore = new Proxy({} as PaymentsStore, {
    get: (_, k) => {
      const v = inner[k as keyof PaymentsStore]
      return typeof v === "function" ? v.bind(inner) : v
    },
  })
  const payments = createPayments({ gateways: Object.values(gateways), db: paymentsStore })
  const startAt = clock.now()
  const model =
    options.ai === undefined ? undefined : (await import("./ai.js")).fakeModel(options.ai)
  const copy = () => structuredClone(options.seed) as D
  const state: DevState = {
    demo: true,
    user: options.user ?? null,
    plan: options.plan,
    entitlements: options.entitlements,
    flags: options.flags,
  }

  const demo: Demo<D> = {
    clock,
    outbox,
    senders,
    notifyStore,
    gateways,
    payments,
    paymentsStore,
    model,
    data: copy(),
    state,
    async reset() {
      demo.data = copy()
      outbox.clear()
      notifyStore.reset()
      for (const g of Object.values(gateways)) g.reset()
      inner = memoryStore()
      clock.set(startAt)
      await options.onSeed?.(demo.data)
    },
    async handle(request) {
      const { pathname } = new URL(request.url)
      const method = request.method.toUpperCase()
      if (pathname === "/__signet/dev" && method === "GET")
        return Response.json({ ...state, outbox: outbox.messages.slice(-20) })
      if (pathname === "/__signet/seed" && method === "POST") {
        demo.data = (await request.json()) as D
        await options.onSeed?.(demo.data)
        return Response.json({ ok: true })
      }
      if (pathname === "/__signet/reset" && method === "POST") {
        await demo.reset()
        return Response.json({ ok: true })
      }
      if (pathname === "/__signet/pay" && method === "POST") {
        const b = (await request.json()) as {
          gateway: keyof typeof gateways
          checkoutId: string
          status?: "captured" | "authorized" | "failed"
        }
        const gw = gateways[b.gateway]
        if (!gw) return Response.json({ error: "unknown gateway" }, { status: 400 })
        const hook = await gw.complete(b.checkoutId, { status: b.status })
        return payments.handleWebhook(gw.name, hook)
      }
      return null
    },
  }
  await options.onSeed?.(demo.data)
  return demo
}
