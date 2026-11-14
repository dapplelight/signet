import { readFileSync } from "node:fs"
import { z } from "zod"
import { memoryKv } from "../src/adapters/index"
import { requestPhoneOtp } from "../src/auth/otp"
import { createJobs, type JobMessage } from "../src/jobs/jobs"
import { memoryStore } from "../src/middleware/rate-limit"
import {
  devSender,
  msg91Sms,
  postmarkSender,
  resendSender,
  smsSenderFor,
  telegramSender,
  twilioSms,
  whatsappSender,
} from "../src/notify/channels"
import {
  createNotifier,
  DEFAULT_EMAIL_THEME,
  defineTemplates,
  htmlToText,
  kvNotifyStore,
  NotifyError,
  notifyJob,
  quietMinutesLeft,
  type Sender,
} from "../src/notify/notifier"
import { notifyTools } from "../src/notify/tools"
import {
  metaWebhook,
  parseResendEvent,
  parseTwilioEvent,
  resendWebhook,
  twilioWebhook,
  unsubscribeRoute,
  verifyMetaSignature,
  verifyResendSignature,
  verifyTwilioSignature,
} from "../src/notify/webhooks"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}
const throws = async (fn: () => unknown, code: string) => {
  try {
    await fn()
    return false
  } catch (e) {
    return (e as { code?: string }).code === code
  }
}

type Call = { url: string; init: RequestInit; body: string }
const fakeFetch = (respond: (url: string) => Response) => {
  const calls: Call[] = []
  const f = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init, body: String(init.body ?? "") })
    return respond(String(url))
  }) as typeof fetch
  return { f, calls }
}
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status })
const hdr = (c: Call | undefined, k: string) => new Headers(c?.init.headers).get(k)
const flush = () => new Promise((r) => setTimeout(r, 20))
const SECRET = "x".repeat(40)

// --- providers ---------------------------------------------------------------
{
  const { f, calls } = fakeFetch(() => json({ id: "re_1" }))
  const s = resendSender({ apiKey: "k", from: "A <a@x.io>", fetch: f })
  const r = await s.send(
    "u@x.io",
    { subject: "Hi", html: "<p>x</p>", text: "x", headers: { "List-Unsubscribe": "<https://u>" } },
    { idempotencyKey: "d1" },
  )
  const b = JSON.parse(calls[0]?.body ?? "{}")
  ok(
    "resend: endpoint + bearer",
    calls[0]?.url === "https://api.resend.com/emails" &&
      hdr(calls[0], "authorization") === "Bearer k",
  )
  ok("resend: Idempotency-Key is the delivery id", hdr(calls[0], "idempotency-key") === "d1")
  ok(
    "resend: headers and body passed",
    b.headers["List-Unsubscribe"] === "<https://u>" && b.to[0] === "u@x.io" && b.text === "x",
  )
  ok("resend: returns provider id", r.id === "re_1" && r.status === "sent")
  const bad = resendSender({
    apiKey: "k",
    from: "a@x.io",
    fetch: fakeFetch(() => new Response("no", { status: 422 })).f,
  })
  const e422 = await bad
    .send("u@x.io", { subject: "", html: "", text: "", headers: {} }, { idempotencyKey: "x" })
    .catch((e) => e)
  ok("resend: 422 is permanent", e422 instanceof NotifyError && e422.permanent)
  const e500 = await resendSender({
    apiKey: "k",
    from: "a",
    fetch: fakeFetch(() => new Response("", { status: 503 })).f,
  })
    .send("u@x.io", { subject: "", html: "", text: "", headers: {} }, { idempotencyKey: "x" })
    .catch((e) => e)
  ok("resend: 503 is retryable", e500 instanceof NotifyError && !e500.permanent)
}
{
  const { f, calls } = fakeFetch(() => json({ MessageID: "pm1", ErrorCode: 0, Message: "OK" }))
  const r = await postmarkSender({ serverToken: "t", from: "a@x.io", fetch: f }).send(
    "u@x.io",
    { subject: "S", html: "<b>h</b>", text: "h", headers: { A: "1" } },
    { idempotencyKey: "d" },
  )
  const b = JSON.parse(calls[0]?.body ?? "{}")
  ok(
    "postmark: token header + PascalCase body",
    hdr(calls[0], "x-postmark-server-token") === "t" &&
      b.HtmlBody === "<b>h</b>" &&
      b.TextBody === "h",
  )
  ok("postmark: Headers as Name/Value", b.Headers[0].Name === "A" && b.Headers[0].Value === "1")
  ok("postmark: MessageID", r.id === "pm1")
}
{
  const { f, calls } = fakeFetch(() => json({ sid: "SM1", status: "queued" }))
  const tw = twilioSms({
    accountSid: "AC1",
    username: "AC1",
    password: "tok",
    from: "+15005550006",
    statusCallback: "https://h/cb",
    fetch: f,
  })
  const r = await tw.send("+15551234567", { text: "hello" }, { idempotencyKey: "d" })
  const form = new URLSearchParams(calls[0]?.body)
  ok(
    "twilio: Messages.json under the account",
    calls[0]?.url === "https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json",
  )
  ok(
    "twilio: basic auth + form body",
    hdr(calls[0], "authorization") === `Basic ${btoa("AC1:tok")}` &&
      form.get("Body") === "hello" &&
      form.get("StatusCallback") === "https://h/cb",
  )
  ok("twilio: sid", r.id === "SM1")
  ok(
    "DLT: twilio refuses +91 without DLT ids",
    await throws(
      () => tw.send("+919876543210", { text: "x" }, { idempotencyKey: "d" }),
      "DLT_REQUIRED",
    ),
  )
  ok("DLT: refusal made no request", calls.length === 1)
  await tw.send(
    "+919876543210",
    { text: "x", dltTemplateId: "1107", senderId: "ACMEIN" },
    { idempotencyKey: "d" },
  )
  ok("DLT: sender id becomes From", new URLSearchParams(calls[1]?.body).get("From") === "ACMEIN")
}
{
  const { f, calls } = fakeFetch(() => json({ type: "success", message: "req1" }))
  const m = msg91Sms({ authKey: "ak", fetch: f })
  ok(
    "DLT: msg91 refuses +91 without DLT ids",
    await throws(
      () =>
        m.send("+919876543210", { text: "x", providerTemplateId: "f1" }, { idempotencyKey: "d" }),
      "DLT_REQUIRED",
    ),
  )
  const r = await m.send(
    "+919876543210",
    {
      text: "x",
      dltTemplateId: "1107",
      senderId: "ACMEIN",
      providerTemplateId: "flow1",
      params: { OTP: "123456" },
    },
    { idempotencyKey: "d" },
  )
  const b = JSON.parse(calls[0]?.body ?? "{}")
  ok(
    "msg91: flow endpoint + authkey",
    calls[0]?.url === "https://control.msg91.com/api/v5/flow/" && hdr(calls[0], "authkey") === "ak",
  )
  ok(
    "msg91: flow_id, sender, recipients with vars",
    b.flow_id === "flow1" &&
      b.sender === "ACMEIN" &&
      b.recipients[0].mobiles === "919876543210" &&
      b.recipients[0].OTP === "123456",
  )
  ok("msg91: request id", r.id === "req1")
  const bad = msg91Sms({
    authKey: "ak",
    fetch: fakeFetch(() => json({ type: "error", message: "flow id missing" })).f,
  })
  ok(
    "msg91: type=error is a failure",
    await throws(
      () =>
        bad.send("+15551234567", { text: "x", providerTemplateId: "f" }, { idempotencyKey: "d" }),
      "MSG91_ERROR",
    ),
  )

  // OTP gets a real sender
  const otp = smsSenderFor(m, {
    dltTemplateId: "1107",
    senderId: "ACMEIN",
    providerTemplateId: "otpflow",
    params: (msg) => ({ OTP: msg.match(/\d{4,8}/)?.[0] ?? "" }),
  })
  const kv = memoryKv()
  await requestPhoneOtp(
    { kv, secret: SECRET, sender: otp, rateLimit: memoryStore() },
    { phone: "9876543210" },
  )
  const ob = JSON.parse(calls[1]?.body ?? "{}")
  ok(
    "otp: SmsSender adapter sends the code as a flow variable",
    ob.flow_id === "otpflow" && /^\d{6}$/.test(ob.recipients[0].OTP),
  )
}
{
  const { f, calls } = fakeFetch(() => json({ messages: [{ id: "wamid.1" }] }))
  let open = false
  const wa = whatsappSender({
    accessToken: "at",
    phoneNumberId: "123",
    apiVersion: "v23.0",
    isWindowOpen: async () => open,
    fetch: f,
  })
  const msg = {
    template: { name: "order_update", language: "en", params: ["A1"] },
    text: "free text",
  }
  const r = await wa.send("+919876543210", msg, { idempotencyKey: "d" })
  const b = JSON.parse(calls[0]?.body ?? "{}")
  ok(
    "whatsapp: graph endpoint + bearer",
    calls[0]?.url === "https://graph.facebook.com/v23.0/123/messages" &&
      hdr(calls[0], "authorization") === "Bearer at",
  )
  ok(
    "whatsapp: template outside the window",
    b.type === "template" &&
      b.template.name === "order_update" &&
      b.template.language.code === "en" &&
      b.template.components[0].parameters[0].text === "A1",
  )
  ok(
    "whatsapp: wamid",
    r.id === "wamid.1" && b.messaging_product === "whatsapp" && b.to === "919876543210",
  )
  open = true
  await wa.send("+919876543210", msg, { idempotencyKey: "d" })
  const b2 = JSON.parse(calls[1]?.body ?? "{}")
  ok("whatsapp: free text inside the window", b2.type === "text" && b2.text.body === "free text")
  open = false
  ok(
    "whatsapp: text only + closed window refused",
    await throws(() => wa.send("+1", { text: "x" }, { idempotencyKey: "d" }), "WINDOW_CLOSED"),
  )
}
{
  const { f, calls } = fakeFetch(() => json({ ok: true, result: { message_id: 7 } }))
  const r = await telegramSender({ botToken: "b", fetch: f }).send(
    "42",
    { title: "T.", body: "b" },
    { idempotencyKey: "d" },
  )
  ok(
    "telegram: per-user chat id, escaped",
    JSON.parse(calls[0]?.body ?? "{}").chat_id === "42" &&
      JSON.parse(calls[0]?.body ?? "{}").text.includes("T\\.") &&
      r.id === "42:7",
  )
}
{
  const lines: string[] = []
  await devSender("sms", { log: (l) => lines.push(l) }).send(
    "+1",
    { text: "code 1" },
    { idempotencyKey: "d" },
  )
  ok("dev sender prints locally", lines[0]?.includes("code 1") === true)
  let threw = 0
  for (const appEnv of ["production", "staging"])
    try {
      devSender("email", { appEnv })
    } catch {
      threw++
    }
  ok("dev sender throws in production and staging", threw === 2)
}

// --- webhooks ----------------------------------------------------------------
const enc = new TextEncoder()
const sign = async (hash: "SHA-1" | "SHA-256", key: Uint8Array<ArrayBuffer>, data: string) => {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash }, false, ["sign"])
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)))
}
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))
{
  // Svix fixture: whsec_ + base64 key, content id.ts.body.
  const keyBytes = enc.encode("resend-test-signing-key-32bytes!")
  const secret = `whsec_${b64(keyBytes)}`
  const body = JSON.stringify({
    type: "email.bounced",
    created_at: "2026-01-01T00:00:00Z",
    data: { email_id: "re_1", to: ["u@x.io"], bounce: { type: "Permanent" } },
  })
  const ts = String(Math.floor(Date.now() / 1000))
  const sig = b64(await sign("SHA-256", keyBytes, `msg_1.${ts}.${body}`))
  const h = new Headers({
    "svix-id": "msg_1",
    "svix-timestamp": ts,
    "svix-signature": `v1,bogus v1,${sig}`,
  })
  ok("resend sig: valid (second of two signatures)", await verifyResendSignature(secret, h, body))
  ok("resend sig: tampered body fails", !(await verifyResendSignature(secret, h, `${body} `)))
  ok(
    "resend sig: stale timestamp fails",
    !(await verifyResendSignature(secret, h, body, { now: Date.now() + 600_000 })),
  )
  ok(
    "resend sig: wrong secret fails",
    !(await verifyResendSignature(`whsec_${b64(enc.encode("other"))}`, h, body)),
  )
  const ev = parseResendEvent(JSON.parse(body))
  ok(
    "resend: hard bounce → bounced + suppress",
    ev[0]?.status === "bounced" && ev[0]?.suppress?.reason === "hard_bounce",
  )
  const soft = parseResendEvent({
    type: "email.bounced",
    data: { email_id: "x", to: ["u@x.io"], bounce: { type: "Temporary" } },
  })
  ok("resend: soft bounce does not suppress", soft[0]?.status === "bounced" && !soft[0]?.suppress)
  ok(
    "resend: opened maps",
    parseResendEvent({ type: "email.opened", data: { email_id: "x" } })[0]?.status === "opened",
  )
}
{
  // Twilio fixture: url + sorted name+value, HMAC-SHA1(authToken), base64.
  const url = "https://mycompany.com/myapp.php?foo=1&bar=2"
  const params = new URLSearchParams({
    To: "+14158141829",
    From: "+14158675310",
    CallSid: "CA1234567890ABCDE",
    Caller: "+14158675310",
    Digits: "1234",
  })
  const expected = b64(
    await sign(
      "SHA-1",
      enc.encode("12345"),
      `${url}CallSidCA1234567890ABCDECaller+14158675310Digits1234From+14158675310To+14158141829`,
    ),
  )
  ok("twilio sig: valid", await verifyTwilioSignature("12345", url, params, expected))
  ok(
    "twilio sig: wrong token fails",
    !(await verifyTwilioSignature("54321", url, params, expected)),
  )
  ok("twilio sig: missing header fails", !(await verifyTwilioSignature("12345", url, params, null)))
  ok(
    "twilio: status callback maps",
    parseTwilioEvent(new URLSearchParams({ MessageSid: "SM1", MessageStatus: "undelivered" }))[0]
      ?.status === "failed",
  )
  const stop = parseTwilioEvent(
    new URLSearchParams({
      MessageSid: "SM2",
      From: "+15551234567",
      Body: " stop ",
      SmsStatus: "received",
    }),
  )
  ok(
    "twilio: STOP suppresses sms",
    stop[0]?.suppress?.channel === "sms" && stop[0]?.suppress?.address === "+15551234567",
  )
  ok(
    "twilio: OptOutType=STOP suppresses",
    parseTwilioEvent(
      new URLSearchParams({ From: "+1555", Body: "Stop please", OptOutType: "STOP" }),
    )[0]?.suppress?.reason === "stop",
  )
  ok(
    "twilio: ordinary reply ignored",
    parseTwilioEvent(new URLSearchParams({ From: "+1555", Body: "thanks" })).length === 0,
  )
}
{
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "1",
        changes: [
          {
            field: "messages",
            value: {
              statuses: [
                {
                  id: "wamid.1",
                  status: "read",
                  timestamp: "1750030073",
                  recipient_id: "919876543210",
                },
              ],
              messages: [{ from: "919876543210", type: "text", text: { body: "STOP" } }],
            },
          },
        ],
      },
    ],
  })
  const hex = [...(await sign("SHA-256", enc.encode("appsecret"), body))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
  ok("meta sig: valid", await verifyMetaSignature("appsecret", body, `sha256=${hex}`))
  ok("meta sig: no prefix fails", !(await verifyMetaSignature("appsecret", body, hex)))
  ok(
    "meta sig: tampered fails",
    !(await verifyMetaSignature("appsecret", `${body}x`, `sha256=${hex}`)),
  )
  const got: unknown[] = []
  const windows: string[] = []
  const h = metaWebhook(
    {
      recordEvents: async (e) => (got.push(...e), e.length),
      openWhatsAppWindow: async (p) => void windows.push(p),
    },
    { appSecret: "appsecret", verifyToken: "vt" },
  )
  const r = await h(
    new Request("https://h/meta", {
      method: "POST",
      body,
      headers: { "x-hub-signature-256": `sha256=${hex}` },
    }),
  )
  ok(
    "meta webhook: 200, status + STOP suppression + window opened",
    r.status === 200 && got.length === 2 && windows[0] === "+919876543210",
  )
  const bad = await h(
    new Request("https://h/meta", {
      method: "POST",
      body,
      headers: { "x-hub-signature-256": "sha256=00" },
    }),
  )
  ok("meta webhook: bad signature 401", bad.status === 401)
  const v = await h(
    new Request("https://h/meta?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=1158201444"),
  )
  ok("meta webhook: verification echoes challenge", (await v.text()) === "1158201444")
  const v2 = await h(
    new Request("https://h/meta?hub.mode=subscribe&hub.verify_token=no&hub.challenge=1"),
  )
  ok("meta webhook: wrong verify token 403", v2.status === 403)
}

// --- notifier ----------------------------------------------------------------
const templates = defineTemplates({
  "order.shipped": {
    category: "orders",
    data: z.object({ orderId: z.string(), url: z.string() }),
    en: {
      email: {
        subject: (d) => `Order ${d.orderId} shipped`,
        html: (d) => `<p>Order <b>${d.orderId}</b> is on its way.</p>`,
        action: { label: () => "Track", url: (d) => d.url },
      },
      sms: { text: (d) => `Order ${d.orderId} shipped`, dltTemplateId: "1107", senderId: "ACMEIN" },
      whatsapp: { template: { name: "order_shipped", language: "en", params: (d) => [d.orderId] } },
      inApp: { title: () => "Shipped", body: (d) => `Order ${d.orderId}`, link: (d) => d.url },
    },
    locales: { hi: { inApp: { title: () => "भेज दिया", body: (d) => `ऑर्डर ${d.orderId}` } } },
  },
  "auth.otp": {
    category: "otp",
    data: z.object({ code: z.string() }),
    en: {
      sms: { text: (d) => `Code ${d.code}` },
      email: { subject: () => "Your code", html: (d) => `<p>${d.code}</p>` },
    },
  },
})

type Sent = { channel: string; to: string; rendered: unknown }
const recorder = <C extends "email" | "sms" | "whatsapp">(
  channel: C,
  sent: Sent[],
  failTimes = 0,
): Sender<C> => {
  let n = 0
  return {
    provider: `fake-${channel}`,
    async send(to, rendered) {
      if (n++ < failTimes) throw new NotifyError("FLAKY", "try again")
      sent.push({ channel, to, rendered })
      return { id: `${channel}-${n}`, status: "sent" }
    },
  }
}

const setup = (over: Partial<Parameters<typeof createNotifier>[0]> = {}) => {
  const sent: Sent[] = []
  const events: Array<[string, Record<string, unknown>]> = []
  const kv = memoryKv()
  const store = kvNotifyStore(kv)
  const n = createNotifier({
    channels: {
      email: recorder("email", sent),
      sms: recorder("sms", sent),
      whatsapp: recorder("whatsapp", sent),
    },
    templates,
    store,
    recipients: async (id) =>
      id === "nobody"
        ? null
        : { email: "u@x.io", phone: "+919876543210", ...(id === "hindi" ? { locale: "hi" } : {}) },
    secret: SECRET,
    unsubscribeUrl: "https://app.test/unsub",
    retry: { baseSeconds: 0 },
    onEvent: (e, d) => events.push([e, d]),
    ...over,
  })
  return { n, sent, store, kv, events }
}
{
  const { n, sent, events } = setup()
  const res = await n.notify("u1", "order.shipped", { orderId: "A1", url: "https://t/1" })
  await flush()
  ok(
    "notify: queued per channel, whatsapp skipped without opt-in",
    res.find((r) => r.channel === "whatsapp")?.reason === "NO_OPT_IN" &&
      res.filter((r) => r.status === "queued").length === 3,
  )
  const email = sent.find((s) => s.channel === "email")?.rendered as {
    html: string
    text: string
    headers: Record<string, string>
    subject: string
  }
  ok(
    "email: themed layout with token colours",
    email.html.includes(DEFAULT_EMAIL_THEME.primary) &&
      email.html.includes(DEFAULT_EMAIL_THEME.background),
  )
  ok(
    "email: plain-text fallback derived",
    email.text.startsWith("Order A1 is on its way.") && email.text.includes("Track (https://t/1)"),
  )
  ok(
    "email: RFC 8058 headers",
    email.headers["List-Unsubscribe"]?.startsWith("<https://app.test/unsub?token=") === true &&
      email.headers["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click",
  )
  ok(
    "sms: DLT ids rendered",
    (sent.find((s) => s.channel === "sms")?.rendered as { dltTemplateId?: string } | undefined)
      ?.dltTemplateId === "1107",
  )
  const page = await n.inbox.list("u1")
  ok(
    "inApp: written to the inbox",
    page.items[0]?.title === "Shipped" && page.items[0]?.link === "https://t/1",
  )
  ok(
    "onEvent never carries bodies",
    !JSON.stringify(events).includes("on its way") &&
      !JSON.stringify(events).includes("A1 shipped"),
  )
  const hist = (await n.exportUser("u1")).deliveries
  ok(
    "delivery records: masked address, sent",
    hist.find((d) => d.channel === "email")?.to === "u***@x.io" &&
      hist.every((d) => d.status === "sent" || d.status === "delivered"),
  )

  // idempotency
  const again = await n.notify(
    "u1",
    "order.shipped",
    { orderId: "A1", url: "u" },
    { idempotencyKey: "k1" },
  )
  await flush()
  const before = sent.length
  const dup = await n.notify(
    "u1",
    "order.shipped",
    { orderId: "A1", url: "u" },
    { idempotencyKey: "k1" },
  )
  await flush()
  ok(
    "idempotency: same key sends nothing twice",
    again.some((r) => r.status === "queued") &&
      dup.every((r) => r.status === "skipped") &&
      sent.length === before,
  )

  ok(
    "bad data refused",
    await throws(() => n.notify("u1", "order.shipped", { orderId: 1 } as never), "BAD_DATA"),
  )
  ok(
    "unknown event refused",
    await throws(() => n.notify("u1", "nope" as never, {} as never), "UNKNOWN_EVENT"),
  )
  const none = await n.notify(
    "nobody",
    "order.shipped",
    { orderId: "A", url: "u" },
    { channels: ["email"] },
  )
  ok("no address → skipped", none[0]?.reason === "NO_ADDRESS")
}
{
  // locale
  const { n } = setup()
  await n.notify(
    "hindi",
    "order.shipped",
    { orderId: "A1", url: "u" },
    { channels: ["inApp", "email"] },
  )
  await flush()
  ok(
    "locale: hi variant used, en fallback for others",
    (await n.inbox.list("hindi")).items[0]?.title === "भेज दिया",
  )
}
{
  // prefs + required + unsubscribe
  const { n, sent } = setup()
  await n.updatePrefs("u1", { channels: { orders: { email: false } } })
  const r = await n.notify(
    "u1",
    "order.shipped",
    { orderId: "A", url: "u" },
    { channels: ["email", "sms"] },
  )
  ok(
    "prefs: disabled channel skipped, others sent",
    r[0]?.reason === "PREFS" && r[1]?.status === "queued",
  )
  ok(
    "prefs: cannot disable a required category",
    await throws(
      () => n.updatePrefs("u1", { channels: { otp: { sms: false } } }),
      "REQUIRED_CATEGORY",
    ),
  )
  const otpRes = await n.notify("u1", "auth.otp", { code: "999111" })
  await flush()
  ok(
    "required: otp email has no unsubscribe header",
    otpRes.every((x) => x.status === "queued") &&
      !(
        sent.find((s) => (s.rendered as { subject?: string }).subject === "Your code")?.rendered as
          | { headers: Record<string, string> }
          | undefined
      )?.headers["List-Unsubscribe"],
  )

  const tok = await n.unsubscribeToken("u2", "orders")
  const route = unsubscribeRoute(n)
  const g = await route(new Request(`https://app.test/unsub?token=${tok}`))
  ok(
    "unsubscribe: GET only shows a form",
    g.status === 200 && (await n.getPrefs("u2")).channels.orders?.email === undefined,
  )
  const p = await route(
    new Request(`https://app.test/unsub?token=${tok}`, {
      method: "POST",
      body: "List-Unsubscribe=One-Click",
    }),
  )
  ok(
    "unsubscribe: one-click POST turns email off",
    p.status === 200 && (await n.getPrefs("u2")).channels.orders?.email === false,
  )
  ok("unsubscribe: forged token refused", !(await n.unsubscribe(`${tok.split(".")[0]}.AAAA`)))
  ok(
    "unsubscribe: required category refused",
    !(await n.unsubscribe(await n.unsubscribeToken("u2", "security"))),
  )
}
{
  // quiet hours
  const q = { start: "22:00", end: "08:00" }
  ok(
    "quiet: 23:30 IST is inside, 510 min left",
    quietMinutesLeft(q, new Date("2026-01-01T18:00:00Z")) === 510,
  )
  ok("quiet: 12:00 IST is outside", quietMinutesLeft(q, new Date("2026-01-01T06:30:00Z")) === 0)
  ok(
    "quiet: timezone-aware",
    quietMinutesLeft({ ...q, timezone: "UTC" }, new Date("2026-01-01T18:00:00Z")) === 0,
  )
  const at = new Date("2026-01-01T18:00:00Z").getTime() // 23:30 Asia/Kolkata
  const { n, sent } = setup({ quietHours: q, now: () => at })
  const r = await n.notify(
    "u1",
    "order.shipped",
    { orderId: "A", url: "u" },
    { channels: ["email", "inApp"] },
  )
  ok(
    "quiet: email held (skipped without a job queue), inApp still lands",
    r[0]?.reason === "QUIET_HOURS" && r[1]?.status === "queued",
  )
  await n.notify(
    "u1",
    "order.shipped",
    { orderId: "B", url: "u" },
    { channels: ["email"], priority: "urgent" },
  )
  await flush()
  ok("quiet: urgent bypasses", sent.length === 1)
  const delays: Array<number | undefined> = []
  const { n: n2 } = setup({
    quietHours: q,
    now: () => at,
    enqueue: async (_id, d) => void delays.push(d),
  })
  await n2.notify("u1", "order.shipped", { orderId: "A", url: "u" }, { channels: ["email"] })
  await flush()
  ok("quiet: with a job queue the send is delayed to quiet end", delays[0] === 510 * 60)
}
{
  // suppression + opt-in + rate limit
  const { n, sent } = setup()
  await n.recordEvents(
    parseResendEvent({
      type: "email.bounced",
      data: { email_id: "x", to: ["U@x.io"], bounce: { type: "Permanent" } },
    }),
  )
  const r = await n.notify(
    "u1",
    "order.shipped",
    { orderId: "A", url: "u" },
    { channels: ["email"] },
  )
  ok("suppression: hard-bounced address skipped (case-insensitive)", r[0]?.reason === "SUPPRESSED")
  await n.recordEvents(
    parseTwilioEvent(new URLSearchParams({ From: "+919876543210", Body: "STOP" })),
  )
  ok(
    "suppression: STOP blocks sms",
    (await n.notify("u1", "order.shipped", { orderId: "A", url: "u" }, { channels: ["sms"] }))[0]
      ?.reason === "SUPPRESSED",
  )
  await n.setOptIn("u1", "whatsapp", { source: "checkout" })
  await n.notify("u1", "order.shipped", { orderId: "A", url: "u" }, { channels: ["whatsapp"] })
  await flush()
  ok(
    "whatsapp: sends after opt-in recorded",
    sent.some((s) => s.channel === "whatsapp"),
  )

  const { n: n3 } = setup({
    rateLimitStore: memoryStore(),
    rateLimit: { max: 1, windowSeconds: 60 },
  })
  await n3.notify("u1", "order.shipped", { orderId: "A", url: "u" }, { channels: ["email"] })
  const limited = await n3.notify(
    "u1",
    "order.shipped",
    { orderId: "A", url: "u" },
    { channels: ["email"] },
  )
  const otpOk = await n3.notify("u1", "auth.otp", { code: "1" }, { channels: ["email"] })
  ok(
    "rate limit: per user per channel; required categories exempt",
    limited[0]?.reason === "RATE_LIMITED" && otpOk[0]?.status === "queued",
  )
}
{
  // retries: defer path retries a flaky sender; webhooks advance status, never backwards
  const sent: Sent[] = []
  const { n } = setup({ channels: { email: recorder("email", sent, 2) } })
  const [r] = await n.notify(
    "u1",
    "order.shipped",
    { orderId: "A", url: "u" },
    { channels: ["email"] },
  )
  await flush()
  const d1 = (await n.exportUser("u1")).deliveries[0]
  ok(
    "retry: flaky sender retried until sent, once",
    sent.length === 1 && d1?.status === "sent" && d1.attempts === 3,
  )
  await n.recordEvents([{ provider: "fake-email", providerId: "email-3", status: "opened" }])
  await n.recordEvents([{ provider: "fake-email", providerId: "email-3", status: "delivered" }])
  ok(
    "tracking: opened recorded, late delivered ignored",
    (await n.exportUser("u1")).deliveries[0]?.status === "opened",
  )
  ok(
    "deliver twice is a no-op",
    (await n.deliver(r?.deliveryId ?? "")) === "opened" && sent.length === 1,
  )

  const { n: n4 } = setup({ channels: { email: recorder("email", [], 99) } })
  await n4.notify("u1", "order.shipped", { orderId: "A", url: "u" }, { channels: ["email"] })
  await flush()
  ok(
    "retry: gives up after attempts, recorded failed",
    (await n4.exportUser("u1")).deliveries[0]?.status === "failed",
  )

  const { n: n5, kv } = setup({
    channels: {
      sms: twilioSms({
        accountSid: "A",
        username: "A",
        password: "p",
        from: "+1",
        fetch: fakeFetch(() => json({ sid: "S" })).f,
      }),
    },
  })
  await n5.notify("u1", "auth.otp", { code: "424242" }, { channels: ["sms"] })
  await flush()
  const d5 = (await n5.exportUser("u1")).deliveries[0]
  ok(
    "DLT: notify to +91 without ids recorded failed DLT_REQUIRED",
    d5?.status === "failed" && d5.reason === "DLT_REQUIRED",
  )
  ok("payload with code removed after the send", !(await kv.get(`signet-notify:pl:${d5?.id}`)))
}
{
  // jobs integration: retries via the job's backoff, idempotent
  const sent: Sent[] = []
  const { n } = setup({ channels: { email: recorder("email", sent, 1) } })
  const msgs: JobMessage[] = []
  const job = notifyJob(n, z, { retry: { baseSeconds: 0 } })
  const jobs = createJobs({ jobs: [job], queue: { send: async (m) => void msgs.push(m) } })
  await n.notify("u1", "order.shipped", { orderId: "A", url: "u" }, { channels: ["email"] })
  await flush()
  ok("job: notify enqueued one message", msgs.length === 1)
  const first = await jobs.handle(msgs[0] as JobMessage)
  ok("job: flaky first run retries", first.status === "retrying" && msgs.length === 2)
  await jobs.handle(msgs[1] as JobMessage)
  ok("job: second run sends", sent.length === 1)
  await jobs.handle(msgs[1] as JobMessage)
  ok("job: redelivered message does not send again", sent.length === 1)
}
{
  // inbox ops
  const { n } = setup()
  for (let i = 0; i < 5; i++)
    await n.notify("u9", "order.shipped", { orderId: `O${i}`, url: "u" }, { channels: ["inApp"] })
  await flush()
  const p1 = await n.inbox.list("u9", { limit: 2 })
  const p2 = await n.inbox.list("u9", { limit: 2, cursor: p1.nextCursor })
  const p3 = await n.inbox.list("u9", { limit: 2, cursor: p2.nextCursor })
  ok(
    "inbox: cursor pages newest first",
    p1.items[0]?.body === "Order O4" &&
      p2.items[0]?.body === "Order O2" &&
      p3.items.length === 1 &&
      !p3.nextCursor,
  )
  ok("inbox: unread count", (await n.inbox.unreadCount("u9")) === 5)
  await n.inbox.markRead("u9", [p1.items[0]?.id ?? ""])
  ok("inbox: mark read", (await n.inbox.unreadCount("u9")) === 4)
  await n.inbox.archive("u9", p1.items[1]?.id ?? "")
  ok(
    "inbox: archive hides from list and count",
    (await n.inbox.list("u9")).items.length === 4 &&
      (await n.inbox.unreadCount("u9")) === 3 &&
      (await n.inbox.list("u9", { archived: true })).items.length === 1,
  )
  await n.inbox.markAllRead("u9")
  ok("inbox: mark all read", (await n.inbox.unreadCount("u9")) === 0)

  // export / delete
  await n.updatePrefs("u9", { quietHours: { start: "23:00", end: "07:00" } })
  await n.setOptIn("u9", "whatsapp", { source: "form" })
  const ex = await n.exportUser("u9")
  ok(
    "export: prefs, opt-ins, inbox, deliveries",
    ex.prefs?.quietHours?.start === "23:00" &&
      ex.optIns.length === 1 &&
      ex.inbox.length === 5 &&
      ex.deliveries.length === 5,
  )
  await n.deleteUser("u9")
  const gone = await n.exportUser("u9")
  ok(
    "delete: all gone",
    !gone.prefs && !gone.optIns.length && !gone.inbox.length && !gone.deliveries.length,
  )
}

// --- tools -------------------------------------------------------------------
{
  const { n } = setup()
  await n.notify("u1", "order.shipped", { orderId: "A", url: "u" }, { channels: ["inApp"] })
  await flush()
  const tools = notifyTools({ notifier: n, userOf: () => "u1", isStaff: () => false })
  const names = tools.map((t) => t.name)
  ok(
    "tools: four tools when isStaff given",
    ["list_my_notifications", "notification_prefs", "update_prefs", "send_notification"].every(
      (x) => names.includes(x),
    ),
  )
  ok(
    "tools: no send tool without isStaff",
    !notifyTools({ notifier: n }).some((t) => t.name === "send_notification"),
  )
  const call = (name: string, input: unknown) =>
    (tools.find((t) => t.name === name) as any).handler(input, { tool: name })
  const list = await call("list_my_notifications", {})
  ok("tools: list_my_notifications", list.unread === 1 && list.items.length === 1)
  const prefs = await call("notification_prefs", {})
  ok("tools: notification_prefs shows required", prefs.required.includes("otp"))
  const upd = await call("update_prefs", { channels: { otp: { sms: false } } })
  ok(
    "tools: update_prefs refuses required",
    upd.isError === true && JSON.stringify(upd).includes("REQUIRED_CATEGORY"),
  )
  const send = await call("send_notification", {
    userId: "u2",
    event: "order.shipped",
    data: { orderId: "A", url: "u" },
  })
  ok(
    "tools: send_notification is staff only",
    send.isError === true && JSON.stringify(send).includes("FORBIDDEN"),
  )
}

// --- theme matches signet-tokens ---------------------------------------------
{
  const css = readFileSync(
    new URL("../../tokens/src/themes/editorial.css", import.meta.url),
    "utf8",
  )
  ok(
    "email theme: primary matches editorial --primary",
    css.includes(`--primary: ${DEFAULT_EMAIL_THEME.primary};`),
  )
  ok(
    "email theme: mutedFg matches editorial --muted-fg",
    css.includes(`--muted-fg: ${DEFAULT_EMAIL_THEME.mutedFg};`),
  )
  ok("htmlToText decodes entities", htmlToText("<p>a &amp; b</p><script>x</script>") === "a & b")
}

// --- webhook handlers end to end ---------------------------------------------
{
  const { n } = setup({
    channels: {
      email: resendSender({
        apiKey: "k",
        from: "a",
        fetch: fakeFetch(() => json({ id: "re_9" })).f,
      }),
    },
  })
  await n.notify("u1", "order.shipped", { orderId: "A", url: "u" }, { channels: ["email"] })
  await flush()
  const keyBytes = enc.encode("k".repeat(24))
  const body = JSON.stringify({ type: "email.delivered", data: { email_id: "re_9" } })
  const ts = String(Math.floor(Date.now() / 1000))
  const sig = b64(await sign("SHA-256", keyBytes, `m.${ts}.${body}`))
  const h = resendWebhook(n, { secret: `whsec_${b64(keyBytes)}` })
  const r = await h(
    new Request("https://h/r", {
      method: "POST",
      body,
      headers: { "svix-id": "m", "svix-timestamp": ts, "svix-signature": `v1,${sig}` },
    }),
  )
  ok(
    "resend webhook: delivered recorded",
    r.status === 200 && (await n.exportUser("u1")).deliveries[0]?.status === "delivered",
  )
  const bad = await h(
    new Request("https://h/r", {
      method: "POST",
      body,
      headers: { "svix-id": "m", "svix-timestamp": ts, "svix-signature": "v1,AAAA" },
    }),
  )
  ok("resend webhook: bad signature 401", bad.status === 401)

  const url = "https://h/twilio"
  const form = new URLSearchParams({ MessageSid: "SM9", MessageStatus: "delivered" })
  let data = url
  for (const k of [...form.keys()].sort()) data += k + form.get(k)
  const tsig = b64(await sign("SHA-1", enc.encode("tok"), data))
  const th = twilioWebhook(n, { authToken: "tok" })
  ok(
    "twilio webhook: valid 200",
    (
      await th(
        new Request(url, { method: "POST", body: form, headers: { "x-twilio-signature": tsig } }),
      )
    ).status === 200,
  )
  ok(
    "twilio webhook: bad 401",
    (
      await th(
        new Request(url, { method: "POST", body: form, headers: { "x-twilio-signature": "x" } }),
      )
    ).status === 401,
  )
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
