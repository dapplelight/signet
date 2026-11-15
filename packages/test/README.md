<p align="center"><img src="https://raw.githubusercontent.com/dapplelight/signet/main/docs/brand/mark-color.svg" width="72" height="72" alt="Signet"></p>

# @dapplelight/signet-test

Testing kit for [Signet](https://github.com/dapplelight/signet) apps. Fake
providers with the real interfaces, Playwright helpers with visual regression
across every theme, a dev overlay and a demo mode that runs an app fully
offline. Not on npm yet (`private: true`).

| Import | What |
|---|---|
| `@dapplelight/signet-test` | `fakeClock`, `fakeFetch`, `fakeSenders` / `fakeSender` / `createOutbox`, `fakeNotifyStore` |
| `@dapplelight/signet-test/payments` | `fakeGateway`: Razorpay, Stripe and PayU servers behind the real adapters |
| `@dapplelight/signet-test/stores` | `fakeAppStore`, `fakeGooglePlay`: signed payloads from test-generated keys (Node/Bun) |
| `@dapplelight/signet-test/ai` | `fakeModel`: the AI SDK's mock language model |
| `@dapplelight/signet-test/playwright` | `signInAs`, `seed`, `expectAcrossThemes`, `applyTheme`, `THEMES` |
| `@dapplelight/signet-test/overlay` | `DevOverlay` |
| `@dapplelight/signet-test/demo` | `createDemo`, `isDemo` |

Every peer is optional; install the one a subpath needs
(`@dapplelight/signet-payments`, `@dapplelight/signet-server` for the notify
fakes and `signInAs`, `ai`, `@playwright/test`, `react` and
`@dapplelight/signet-ui`).

## Fake providers

Each fake implements the interface the real Signet module takes, so the code
under test runs unchanged, and each records its calls for assertions.

### Payments

`fakeGateway("razorpay" | "stripe" | "payu")` is the real signet-payments
adapter pointed at an in-memory server that speaks that gateway's HTTP API:
its id formats, request and response bodies, checkout handoff (Razorpay order
id, Stripe client secret, PayU POST form), idempotency keys and signed
webhooks. Nothing reaches the network. Your webhook route, the inbox and the
ledger run as in production.

```ts
import { createPayments, memoryStore } from "@dapplelight/signet-payments"
import { fakeGateway } from "@dapplelight/signet-test/payments"

const gw = fakeGateway("razorpay")
const payments = createPayments({ gateways: [gw], db: memoryStore() })
const c = await payments.checkout({ amount: 49900, currency: "INR", idempotencyKey: "k1", userId: "u1" })
await payments.handleWebhook("razorpay", await gw.complete(c.gatewayId)) // or { status: "failed" }
console.log(gw.calls.map((x) => x.method)) // ["createCheckout", "verifyWebhook"]
console.log(gw.state.payments.size) // 1, in Razorpay's payment format
```

- **Subscriptions** (Razorpay, Stripe): `gw.subscribe({ plan })` starts an
  active one and returns its webhooks; `gw.renew(id)` charges the next period
  (`{ fail: true }` for a failed charge: Razorpay halts, Stripe goes
  `past_due`); `cancelSubscription` through the adapter queues the gateway's
  cancel webhook, read with `gw.takeWebhooks()`.
- **Payouts and settlements** (Razorpay, Stripe): `createPayout` stores a
  pending payout; `gw.settlePayout(id, "processed" | "failed" | "reversed")`
  returns its webhook. `listSettlements` reads the payments the server holds.
- **PayU** has no subscription or payout API, so those reject `UNSUPPORTED`,
  as the real adapter does.
- **Failures**: `gw.fail("decline" | "unavailable" | "timeout", { on, times })`
  makes the next matching server requests fail. `on` matches
  `"METHOD /path"` (PayU: the command name). A timeout is processed by the
  server and then lost, so a retry must replay, not repeat.
- `gw.reset()` empties the server between tests. Ids keep counting.

Webhook `Request`s are single-read: `.clone()` one to deliver it twice.

### App Store and Google Play

`fakeAppStore()` builds an ECDSA certificate chain and `fakeGooglePlay()` an
RSA JWKS and service account, all in the test process. Pass `.config` to the
real `appstore()` / `googleplay()` adapter; signed transactions and server
notifications then verify through the adapter's own code.

```ts
import { appstore } from "@dapplelight/signet-payments/appstore"
import { googleplay } from "@dapplelight/signet-payments/googleplay"
import { fakeAppStore, fakeGooglePlay } from "@dapplelight/signet-test/stores"

const apple = fakeAppStore()
const event = await appstore(apple.config).verifyWebhook(
  apple.notification("SUBSCRIBED", "INITIAL_BUY", apple.transaction({ productId: "pro.yearly" })),
)

const play = fakeGooglePlay()
play.subscribe("tok-1", { productId: "pro.monthly" })
await googleplay(play.config).verifyWebhook(play.notification(4, "tok-1")) // 4 = PURCHASED
```

Both have lifecycle helpers that move a subscription the way the store would,
keep the store's API (`getSubscription`, `getPayment`) in step, and return
the signed notification: `subscribe`, `renew`, `failRenewal` (`{ graceDays }`
for a grace period, otherwise billing retry / account hold), `cancelRenewal`
(Play: `cancel`), `expire`, `refund` and, on the App Store, `revoke`.

```ts
import { appstore } from "@dapplelight/signet-payments/appstore"
import { DAY, fakeClock } from "@dapplelight/signet-test"
import { fakeAppStore } from "@dapplelight/signet-test/stores"

const clock = fakeClock("2026-11-01T10:00:00Z")
const store = fakeAppStore({ now: clock.now })
const gw = appstore({ ...store.config, now: clock.now })
const { originalTransactionId, notification } = store.subscribe({ productId: "pro.monthly" })
await gw.verifyWebhook(notification)
clock.advance(30 * DAY)
await gw.verifyWebhook(store.failRenewal(originalTransactionId, { graceDays: 6 }))
```

`apple.serve(transaction)` answers Get Transaction Info for a hand-built
transaction; `apple.calls` / `play.calls` record what the adapter asked.

### Notifications

`fakeSenders()` gives a `Sender` for email, SMS, WhatsApp, push and Telegram
(the interface `createNotifier` takes), all writing to one outbox.
`fakeNotifyStore()` is an in-memory `NotifyStore` (deliveries, inbox, prefs,
opt-ins, suppressions) whose TTLs follow the clock you pass.

```ts
import { createNotifier, defineTemplates } from "@dapplelight/signet-server/notify/notifier"
import { fakeNotifyStore, fakeSenders } from "@dapplelight/signet-test"
import { z } from "zod"

const { outbox, senders } = fakeSenders()
const store = fakeNotifyStore()
const notifier = createNotifier({
  channels: senders,
  store,
  recipients: async () => ({ email: "asha@example.test" }),
  templates: defineTemplates({
    welcome: {
      category: "account",
      data: z.object({ name: z.string() }),
      en: { email: { subject: (d) => `Welcome, ${d.name}`, html: (d) => `<p>Hi ${d.name}</p>` } },
    },
  }),
})
await notifier.notify("u1", "welcome", { name: "Asha" })
// Delivery is deferred: wait a tick, then:
console.log(outbox.last("email")?.rendered.subject) // "Welcome, Asha"
console.log(store.deliveries.size) // 1
outbox.failNext("sms", { code: "INVALID_NUMBER", permanent: true }) // a final failure
outbox.failNext("sms") // a transient one: the notifier retries
```

The failures are real `NotifyError`s, so the notifier treats them as it
would a provider's. A resend with the same idempotency key is recorded once.

### AI model

`fakeModel(replies)` is the AI SDK's `MockLanguageModelV4`: use it with
`generateText`, `streamText`, signet-ai's `aiSdkProvider` or `streamChat`.
A string reply is text, anything else is sent as JSON; a list answers in
order; a function gets the prompt. Streams arrive word by word.

```ts
import { fakeModel } from "@dapplelight/signet-test/ai"
import { generateText } from "ai"

const model = fakeModel(["first", { budget: 8000 }])
await generateText({ model, prompt: "Plan a snowboard trip" })
console.log(model.prompts()[0]) // contains "snowboard"
```

### Clock

`fakeClock(start)` gives `now()` (epoch ms) for every Signet option named
`now`, plus `advance(ms)` and `set(time)`. It does not patch `Date`; use
`setSystemTime` from `bun:test` or Playwright's `page.clock` for that.

## Playwright

```ts
import { test } from "@playwright/test"
import { expectAcrossThemes, seed, signInAs } from "@dapplelight/signet-test/playwright"

const BASE = "http://localhost:5173"
const secret = process.env.SESSION_SECRET as string

test("dashboard", async ({ page }) => {
  await signInAs(page, "user_1", { session: { cookieName: "app_session", secret }, url: BASE })
  await seed(page, { invoices: [{ id: "inv_1" }] })
  await page.goto("/dashboard")
  await expectAcrossThemes(page, "dashboard")
})
```

- `signInAs` sets the session cookie directly: a signet-server stateless
  session minted with your cookie name and secret, or any `token` you mint
  (stored sessions, Better Auth) with `cookieName`.
- `seed` posts to demo mode's `/__signet/seed` (or `path`).
- `expectAcrossThemes(page, name)` screenshots the page in editorial,
  cinematic and finance, light and dark, and compares each with its baseline
  `<name>-<theme>-<mode>.png` (Playwright's `toHaveScreenshot`). All six are
  checked before the test fails. The default switch reloads with `?theme=` and
  sets `signet-theme` in localStorage plus the `.dark` class; pass `apply` if
  your app switches differently, and `themes` / `modes` to narrow it.

Baselines differ by OS and browser build: write them (`--update-snapshots`)
on the machine or CI image that checks them. This package's own suite stores
Linux baselines and skips the comparison elsewhere; CI runs it in Chromium.

## Dev overlay

```tsx
import { DevOverlay } from "@dapplelight/signet-test/overlay"
import { THEMES } from "@dapplelight/signet-test/playwright"

export const Dev = ({ theme, setTheme }: { theme: string; setTheme: (t: string) => void }) => (
  <DevOverlay themes={THEMES} theme={theme} onThemeChange={setTheme} />
)
```

A small panel in the corner: the current user, plan and entitlements, flags,
a theme and light/dark switcher, and the fake providers' outbox. It reads
demo mode's `/__signet/dev` (or the `state` prop). Styled with the theme's
CSS variables, so it needs no Tailwind scanning.

Keeping it out of production:

- Bundlers that honour the `production` export condition (Vite, esbuild,
  Bun, webpack in production mode) resolve the import to a stub that renders
  nothing, so the panel's code is not in the bundle.
- Elsewhere it renders nothing when `process.env.NODE_ENV` is
  `"production"`. It loads without a bundler too (no `process` global).
- `enabled` overrides both checks: `<DevOverlay enabled={isDemo} />`.

## Demo mode

`createDemo` wires every fake, a fake clock and your seed data, so the app
runs with no network and no real provider.

```ts
import { createPayments, type PaymentsStore } from "@dapplelight/signet-payments"
import { razorpay } from "@dapplelight/signet-payments/razorpay"
import { type Sender, kvNotifyStore } from "@dapplelight/signet-server/notify/notifier"
import type { KeyValue } from "@dapplelight/signet-server/adapters"
import { createDemo, isDemo } from "@dapplelight/signet-test/demo"

declare const env: Record<string, string | undefined>
declare const db: PaymentsStore
declare const kv: KeyValue
declare const realSenders: { email: Sender<"email"> }
const SEED = { users: [{ id: "user_1", name: "Test User" }], invoices: [] }

const demo = isDemo(env)
  ? await createDemo({ seed: SEED, user: SEED.users[0], plan: "pro", appEnv: env.APP_ENV })
  : null
const payments =
  demo?.payments ??
  createPayments({ gateways: [razorpay({ keyId: "...", keySecret: "...", webhookSecret: "..." })], db })
const channels = demo?.senders ?? realSenders
const notifyStore = demo?.notifyStore ?? kvNotifyStore(kv)
// In your router: (await demo?.handle(request)) ?? next()
```

`SIGNET_DEMO=1` turns it on. `handle` answers `GET /__signet/dev` (overlay
state), `POST /__signet/seed`, `POST /__signet/reset` (seed, outbox, notify
store, gateways, payments store and clock all start over) and `POST /__signet/pay`
(`{ gateway, checkoutId, status? }`: finish a fake checkout through its
signed webhook). Pass `ai` replies to get `demo.model`, and `onSeed` to load
the data into your own store. It refuses `appEnv: "production"` unless
`allowProduction` is set (a public demo that never touches real providers).
