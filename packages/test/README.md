<p align="center"><img src="https://raw.githubusercontent.com/dapplelight/signet/main/docs/brand/mark-color.svg" width="72" height="72" alt="Signet"></p>

# @dapplelight/signet-test

Testing kit for [Signet](https://github.com/dapplelight/signet) apps. Fake
providers with the real interfaces, Playwright helpers with visual regression
across every theme, a dev overlay and a demo mode that runs an app fully
offline. Not on npm yet (`private: true`).

| Import | What |
|---|---|
| `@dapplelight/signet-test` | `fakeClock`, `fakeFetch`, `fakeSenders` / `fakeSender` / `createOutbox` |
| `@dapplelight/signet-test/payments` | `fakeGateway`: Razorpay, Stripe and PayU shapes |
| `@dapplelight/signet-test/stores` | `fakeAppStore`, `fakeGooglePlay`: signed payloads from test-generated keys (Node/Bun) |
| `@dapplelight/signet-test/ai` | `fakeModel`: the AI SDK's mock language model |
| `@dapplelight/signet-test/playwright` | `signInAs`, `seed`, `expectAcrossThemes`, `applyTheme`, `THEMES` |
| `@dapplelight/signet-test/overlay` | `DevOverlay` |
| `@dapplelight/signet-test/demo` | `createDemo`, `isDemo` |

Every peer is optional; install the one a subpath needs
(`@dapplelight/signet-payments`, `ai`, `@playwright/test`, `react` and
`@dapplelight/signet-ui`).

## Fake providers

Each fake implements the interface the real Signet module takes, so the code
under test runs unchanged, and each records its calls for assertions.

### Payments

`fakeGateway("razorpay" | "stripe" | "payu")` is a `PaymentGateway` with
in-memory state, that gateway's id formats, checkout handoff (Razorpay order
id, Stripe client secret, PayU POST form) and capabilities. `complete()`
finishes a checkout and returns the gateway's own webhook, signed;
`verifyWebhook` is the real adapter's. So your webhook route, the inbox and
the ledger run as in production.

```ts
import { createPayments, memoryStore } from "@dapplelight/signet-payments"
import { fakeGateway } from "@dapplelight/signet-test/payments"

const gw = fakeGateway("razorpay")
const payments = createPayments({ gateways: [gw], db: memoryStore() })
const c = await payments.checkout({ amount: 49900, currency: "INR", idempotencyKey: "k1", userId: "u1" })
await payments.handleWebhook("razorpay", await gw.complete(c.gatewayId)) // or { status: "failed" }
expect(gw.calls.map((x) => x.method)).toEqual(["createCheckout", "verifyWebhook"])
```

Subscriptions, payouts and settlements fall through to the real adapter, which
rejects `UNSUPPORTED` where the gateway lacks them.

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

`apple.serve(transaction)` answers Get Transaction Info for `getPayment`;
`apple.calls` / `play.calls` record what the adapter asked the store APIs.

### Notifications

`fakeSenders()` gives a `Sender` for email, SMS, WhatsApp, push and Telegram
(the interface `createNotifier` takes), all writing to one outbox.

```ts
import { fakeSenders } from "@dapplelight/signet-test"

const { outbox, senders } = fakeSenders()
const notifier = createNotifier({ channels: senders, store, templates, recipients })
await notifier.notify("u1", "welcome", { name: "Asha" })
expect(outbox.last("email")?.rendered.subject).toBe("Welcome, Asha")
outbox.failNext("sms", { permanent: true }) // the next SMS throws like a provider error
```

### AI model

`fakeModel(replies)` is the AI SDK's `MockLanguageModelV4`: use it with
`generateText`, `streamText`, signet-ai's `aiSdkProvider` or `streamChat`.
A string reply is text, anything else is sent as JSON; a list answers in
order; a function gets the prompt. Streams arrive word by word.

```ts
const model = fakeModel(["first", { budget: 8000 }])
expect(model.prompts()[0]).toContain("snowboard")
```

### Clock

`fakeClock(start)` gives `now()` (epoch ms) for every Signet option named
`now`, plus `advance(ms)` and `set(time)`. It does not patch `Date`; use
`setSystemTime` from `bun:test` or Playwright's `page.clock` for that.

## Playwright

```ts
import { expectAcrossThemes, seed, signInAs } from "@dapplelight/signet-test/playwright"

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
on the machine or CI image that checks them.

## Dev overlay

```tsx
import { DevOverlay } from "@dapplelight/signet-test/overlay"

<DevOverlay themes={THEMES} theme={theme} onThemeChange={applyTheme} />
```

A small panel in the corner: the current user, plan and entitlements, flags,
a theme and light/dark switcher, and the fake providers' outbox. It reads
demo mode's `/__signet/dev` (or the `state` prop). It is `() => null` when
`process.env.NODE_ENV` is `"production"`, which Vite replaces at build time,
so production bundles do not contain it. Styled with the theme's CSS
variables, so it needs no Tailwind scanning.

## Demo mode

`createDemo` wires every fake, a fake clock and your seed data, so the app
runs with no network and no real provider.

```ts
import { createDemo, isDemo } from "@dapplelight/signet-test/demo"

const demo = isDemo(env)
  ? await createDemo({ seed: SEED, user: SEED.users[0], plan: "pro", flags, appEnv: env.APP_ENV })
  : null
const payments = demo?.payments ?? createPayments({ gateways: [razorpay(config)], db })
const channels = demo?.senders ?? realSenders
app.all("/__signet/*", async (c) => (await demo?.handle(c.req.raw)) ?? c.notFound())
```

`SIGNET_DEMO=1` turns it on. `handle` answers `GET /__signet/dev` (overlay
state), `POST /__signet/seed`, `POST /__signet/reset` and `POST /__signet/pay`
(`{ gateway, checkoutId, status? }`: finish a fake checkout through its
signed webhook). Pass `ai` replies to get `demo.model`, and `onSeed` to load
the data into your own store. It refuses `appEnv: "production"` unless
`allowProduction` is set (a public demo that never touches real providers).
