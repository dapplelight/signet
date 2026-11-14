import { createHash, createHmac } from "node:crypto"
import { z } from "zod"
import { type KeyValue, memoryKv } from "../src/adapters/index"
import {
  cloudflareConsumer,
  createJobs,
  cronMatches,
  defineJob,
  defineSchedule,
  inProcessJobs,
  type JobMessage,
  type JobRunEvent,
  jobTools,
  parseCron,
  qstashReceiver,
  retryDelay,
  verifyQstashSignature,
} from "../src/jobs/index"
import type { ToolContext } from "../src/mcp/server"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}
const rejects = async (fn: () => Promise<unknown>, code?: string) => {
  try {
    await fn()
    return false
  } catch (e) {
    return code === undefined || (e as { code?: string }).code === code
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** A queue that records sends; the test decides when to deliver. */
function recordingQueue() {
  const sent: { message: JobMessage; delaySeconds?: number }[] = []
  return {
    sent,
    async send(message: JobMessage, opts?: { delaySeconds?: number }) {
      sent.push({ message, ...(opts?.delaySeconds ? { delaySeconds: opts.delaySeconds } : {}) })
    },
  }
}

console.log("jobs: enqueue and dispatch")
{
  const seen: string[] = []
  const greet = defineJob({
    name: "greet",
    input: z.object({ who: z.string().min(1) }),
    run: async ({ who }, ctx) => {
      seen.push(`${who}:${ctx.attempt}:${ctx.actor.type}`)
    },
  })
  const q = recordingQueue()
  const events: JobRunEvent[] = []
  const jobs = createJobs({ jobs: [greet], queue: q, onJobRun: (e) => void events.push(e) })
  ok("bad input rejected at enqueue", await rejects(() => greet.enqueue({ who: "" }), "BAD_INPUT"))
  ok("nothing sent for bad input", q.sent.length === 0)
  const r = await greet.enqueue({ who: "ada" }, { delaySeconds: 5 })
  ok("enqueued", r.enqueued && q.sent.length === 1 && q.sent[0]?.delaySeconds === 5)
  const res = await jobs.handle(q.sent[0]!.message)
  ok("dispatched by name", res.status === "done" && seen[0] === "ada:1:system", seen)
  ok("onJobRun ok event", events[0]?.ok === true && events[0]?.name === "greet")
  const unknown = await jobs.handle({ id: "x", job: "nope", input: {}, attempt: 1 })
  ok("unknown job dead-lettered", unknown.status === "dead" && unknown.code === "UNKNOWN_JOB")
  ok(
    "unregistered job enqueue explains",
    await rejects(
      () => defineJob({ name: "lonely", input: z.object({}), run() {} }).enqueue({}),
      "JOBS_NOT_CREATED",
    ),
  )
}

console.log("jobs: retry with backoff, then dead-letter, then retryDead")
{
  let runs = 0
  const flaky = defineJob({
    name: "flaky",
    input: z.object({ n: z.number() }),
    retry: { attempts: 3, backoff: "exponential", baseSeconds: 4 },
    run: async () => {
      runs++
      throw Object.assign(new Error("upstream down"), { code: "UPSTREAM" })
    },
  })
  const q = recordingQueue()
  const events: JobRunEvent[] = []
  const jobs = createJobs({ jobs: [flaky], queue: q, onJobRun: (e) => void events.push(e) })
  await flaky.enqueue({ n: 1 })
  const r1 = await jobs.handle(q.sent[0]!.message)
  ok("first failure retries", r1.status === "retrying" && r1.code === "UPSTREAM")
  ok("retry delay 4s, attempt 2", q.sent[1]?.delaySeconds === 4 && q.sent[1]?.message.attempt === 2)
  await jobs.handle(q.sent[1]!.message)
  ok("second retry 8s", q.sent[2]?.delaySeconds === 8 && q.sent[2]?.message.attempt === 3)
  const r3 = await jobs.handle(q.sent[2]!.message)
  ok("last attempt dead", r3.status === "dead" && runs === 3)
  ok("no more sends", q.sent.length === 3)
  const dead = await jobs.listDead()
  ok(
    "dead entry has error and input",
    dead.length === 1 &&
      dead[0]?.error.code === "UPSTREAM" &&
      dead[0]?.error.message === "upstream down" &&
      (dead[0]?.input as { n: number } | undefined)?.n === 1,
    dead,
  )
  ok(
    "onJobRun error code",
    events.every((e) => !e.ok && e.code === "UPSTREAM"),
  )
  ok("retryDead unknown is false", !(await jobs.retryDead("missing")))
  ok("retryDead", await jobs.retryDead(dead[0]!.id))
  ok("re-sent from attempt 1", q.sent[3]?.message.attempt === 1)
  ok("removed from dead list", (await jobs.listDead()).length === 0)
  ok("fixed backoff", retryDelay({ attempts: 5, backoff: "fixed", baseSeconds: 7 }, 4) === 7)
  ok(
    "backoff capped at 12h",
    retryDelay({ attempts: 99, backoff: "exponential", baseSeconds: 60 }, 30) === 43_200,
  )
}

console.log("jobs: idempotent keys")
{
  let runs = 0
  const once = defineJob({ name: "once", input: z.object({}), run: () => void runs++ })
  const q = recordingQueue()
  createJobs({ jobs: [once], queue: q })
  const a = await once.enqueue({}, { key: "order-1" })
  const b = await once.enqueue({}, { key: "order-1" })
  const c = await once.enqueue({}, { key: "order-2" })
  ok("same key enqueued once", a.enqueued && !b.enqueued && c.enqueued && q.sent.length === 2)

  // Without incr (Workers KV), the fallback still dedupes sequential enqueues.
  const base = memoryKv()
  const noIncr: KeyValue = { get: base.get, set: base.set, delete: base.delete }
  const q2 = recordingQueue()
  const j2 = createJobs({ jobs: [once], queue: q2, store: noIncr })
  await j2.enqueue(once, {}, { key: "k" })
  await j2.enqueue(once, {}, { key: "k" })
  ok("dedupe without incr", q2.sent.length === 1)

  // The structural hook (signet-db's withIdempotency) wraps keyed runs.
  const scopes: string[] = []
  const done = new Set<string>()
  const q3 = recordingQueue()
  const j3 = createJobs({
    jobs: [once],
    queue: q3,
    idempotency: async (key, scope, fn) => {
      scopes.push(`${scope}:${key}`)
      if (done.has(key)) return
      done.add(key)
      return fn()
    },
  })
  runs = 0
  await j3.enqueue(once, {}, { key: "pay-9" })
  await j3.handle(q3.sent[0]!.message)
  await j3.handle(q3.sent[0]!.message) // a redelivery
  ok("hook got scope and key", scopes[0] === "once:pay-9")
  ok("redelivery ran once through the hook", runs === 1)
}

console.log("jobs: timeout aborts")
{
  let aborted = false
  const slow = defineJob({
    name: "slow",
    input: z.object({}),
    timeoutSeconds: 0.05,
    retry: { attempts: 1 },
    run: (_i, ctx) =>
      new Promise<void>((resolve) => {
        ctx.signal.addEventListener("abort", () => {
          aborted = true
          resolve()
        })
      }),
  })
  const q = recordingQueue()
  const jobs = createJobs({ jobs: [slow], queue: q })
  await slow.enqueue({})
  const r = await jobs.handle(q.sent[0]!.message)
  ok("timed out", r.status === "dead" && r.code === "TIMEOUT", r)
  ok("signal aborted", aborted)
}

console.log("jobs: pause and resume")
{
  let runs = 0
  const job = defineJob({ name: "p", input: z.object({}), run: () => void runs++ })
  const q = recordingQueue()
  const jobs = createJobs({ jobs: [job], queue: q, pausedDelaySeconds: 30 })
  await jobs.pause("p")
  await job.enqueue({})
  const r = await jobs.handle(q.sent[0]!.message)
  ok("paused job re-queued, not run", r.status === "paused" && runs === 0)
  ok("re-queued with delay", q.sent[1]?.delaySeconds === 30)
  await jobs.resume("p")
  await jobs.handle(q.sent[1]!.message)
  ok("runs after resume", runs === 1 && !(await jobs.isPaused("p")))
  ok("pause unknown job throws", await rejects(() => jobs.pause("ghost"), "UNKNOWN_JOB"))
}

console.log("jobs: outbox plug")
{
  const job = defineJob({ name: "mail", input: z.object({ to: z.string() }), run() {} })
  const q = recordingQueue()
  const jobs = createJobs({ jobs: [job], queue: q })
  const row = jobs.outboxMessage(job, { to: "a@example.com" })
  ok("outbox row", row.topic === "mail" && (row.payload as { to: string }).to === "a@example.com")
  ok("outbox row validates", await rejects(async () => jobs.outboxMessage(job, { to: 1 } as never)))
  await jobs.outboxQueue.send({ id: "row1", ...row })
  await jobs.outboxQueue.send({ id: "row1", ...row }) // drainOutbox resends after a crash
  ok(
    "outbox redelivery deduped on row id",
    q.sent.length === 1 && q.sent[0]?.message.key === "outbox:row1",
  )
}

console.log("cron matcher")
{
  const at = (iso: string) => new Date(`${iso}Z`)
  const table: [string, string, boolean][] = [
    ["* * * * *", "2026-03-04T05:06", true],
    ["6 5 * * *", "2026-03-04T05:06", true],
    ["7 5 * * *", "2026-03-04T05:06", false],
    ["*/15 * * * *", "2026-03-04T05:45", true],
    ["*/15 * * * *", "2026-03-04T05:46", false],
    ["0-10/5 * * * *", "2026-03-04T05:10", true],
    ["0-10/5 * * * *", "2026-03-04T05:15", false],
    ["5/20 * * * *", "2026-03-04T05:45", true],
    ["0 9-17 * * *", "2026-03-04T17:00", true],
    ["0 9-17 * * *", "2026-03-04T18:00", false],
    ["0 0 1,15 * *", "2026-03-15T00:00", true],
    ["0 0 1,15 * *", "2026-03-16T00:00", false],
    ["0 0 * 2 *", "2026-02-10T00:00", true],
    ["0 0 * 2 *", "2026-03-10T00:00", false],
    // 2026-03-04 is a Wednesday (3); 2026-03-08 a Sunday.
    ["0 0 * * 3", "2026-03-04T00:00", true],
    ["0 0 * * 1-5", "2026-03-08T00:00", false],
    ["0 0 * * 0", "2026-03-08T00:00", true],
    ["0 0 * * 7", "2026-03-08T00:00", true],
    // dom and dow both restricted: either matches.
    ["0 0 13 * 5", "2026-03-13T00:00", true],
    ["0 0 13 * 5", "2026-03-06T00:00", true],
    ["0 0 13 * 5", "2026-03-07T00:00", false],
    // dom restricted, dow star: dom must match.
    ["0 0 13 * *", "2026-03-06T00:00", false],
  ]
  for (const [expr, iso, want] of table)
    ok(`${expr} @ ${iso} -> ${want}`, cronMatches(expr, at(iso)) === want)
  for (const bad of [
    "* * * *",
    "60 * * * *",
    "* 24 * * *",
    "* * 0 * *",
    "*/0 * * * *",
    "5-1 * * * *",
    "a * * * *",
  ])
    ok(`rejects "${bad}"`, await rejects(async () => parseCron(bad)))
}

console.log("schedules")
{
  const job = defineJob({ name: "digest", input: z.object({ kind: z.string() }), run() {} })
  const q = recordingQueue()
  const jobs = createJobs({
    jobs: [job],
    queue: q,
    schedules: [
      defineSchedule({ name: "hourly", cron: "0 * * * *", job, input: { kind: "h" } }),
      defineSchedule({ name: "nightly", cron: "30 2 * * *", job, input: () => ({ kind: "n" }) }),
    ],
  })
  const ran = await jobs.runDueSchedules(new Date("2026-03-04T02:30:10Z"))
  ok("only due schedule ran", ran.length === 1 && ran[0] === "nightly")
  ok(
    "input function called",
    (q.sent[0]?.message.input as { kind: string } | undefined)?.kind === "n",
  )
  const again = await jobs.runDueSchedules(new Date("2026-03-04T02:30:50Z"))
  ok("same minute twice runs once", again.length === 0 && q.sent.length === 1)
  ok("top of hour", (await jobs.runDueSchedules(new Date("2026-03-04T03:00:00Z")))[0] === "hourly")
}

console.log("cloudflare consumer")
{
  let runs = 0
  const job = defineJob({ name: "cf", input: z.object({}), run: () => void runs++ })
  const q = recordingQueue()
  const jobs = createJobs({ jobs: [job], queue: q })
  await job.enqueue({})
  const log: string[] = []
  const msg = (body: unknown, id: string) => ({
    body,
    ack: () => void log.push(`ack:${id}`),
    retry: () => void log.push(`retry:${id}`),
  })
  const consume = cloudflareConsumer(jobs)
  await consume({ messages: [msg(q.sent[0]!.message, "a")] })
  ok("ran and acked", runs === 1 && log[0] === "ack:a")
  const broken = cloudflareConsumer({ handle: async () => Promise.reject(new Error("kv down")) })
  await broken({ messages: [msg({}, "b")] })
  ok("plumbing error asks for retry", log[1] === "retry:b")
}

console.log("qstash signature")
{
  // A token minted with node:crypto, independent of the Web Crypto verifier.
  const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url")
  const mint = (key: string, body: string, claims: Record<string, unknown> = {}) => {
    const now = Math.floor(Date.now() / 1000)
    const header = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    const payload = b64u(
      JSON.stringify({
        iss: "Upstash",
        sub: "https://example.com/api/jobs",
        exp: now + 300,
        nbf: now - 10,
        iat: now,
        jti: "msg_1",
        body: createHash("sha256").update(body).digest("base64url"),
        ...claims,
      }),
    )
    const sig = createHmac("sha256", key).update(`${header}.${payload}`).digest("base64url")
    return `${header}.${payload}.${sig}`
  }
  const keys = { currentSigningKey: "sig_current_test", nextSigningKey: "sig_next_test" }
  const body = JSON.stringify({ id: "1", job: "q", input: {}, attempt: 1 })
  const url = "https://example.com/api/jobs"
  const v = (signature: string, b = body, u: string | undefined = url) =>
    verifyQstashSignature({ signature, body: b, keys, url: u })
  ok("current key", await v(mint(keys.currentSigningKey, body)))
  ok("next key (rotation)", await v(mint(keys.nextSigningKey, body)))
  ok("wrong key", !(await v(mint("other", body))))
  ok("tampered body", !(await v(mint(keys.currentSigningKey, body), `${body} `)))
  ok("wrong subject", !(await v(mint(keys.currentSigningKey, body), body, "https://evil.example")))
  ok("expired", !(await v(mint(keys.currentSigningKey, body, { exp: 1 }))))
  ok("wrong issuer", !(await v(mint(keys.currentSigningKey, body, { iss: "Someone" }))))
  ok("garbage", !(await v("a.b")))
  // Fixed vector: key "k", body "{}", far-future exp. Guards the encoding, not just round-trips.
  // Fixed vector: key "k", body "{}", exp 2100-01-01. Pins the encoding, not just a round trip.
  const fixed =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJVcHN0YXNoIiwic3ViIjoiaHR0cHM6Ly9leGFtcGxlLmNvbS9hcGkvam9icyIsImV4cCI6NDEwMjQ0NDgwMCwibmJmIjoxNzAwMDAwMDAwLCJib2R5IjoiUkJOdm8xV3paNG9SUnEwVzktaGtucFQ3VDhJZjUzNkRFTUJnOWh5cV80byJ9.7Rwoyxzc_104_drXcd5PCEE2PwtuZegeRljxgTUg9zM"
  const fixedKeys = { currentSigningKey: "k", nextSigningKey: "" }
  ok(
    "fixed vector",
    await verifyQstashSignature({ signature: fixed, body: "{}", keys: fixedKeys, url }),
  )
  ok(
    "fixed vector, other body",
    !(await verifyQstashSignature({ signature: fixed, body: "[]", keys: fixedKeys, url })),
  )

  let runs = 0
  const job = defineJob({ name: "q", input: z.object({}), run: () => void runs++ })
  const jobs = createJobs({ jobs: [job], queue: recordingQueue() })
  const receive = qstashReceiver(jobs, { keys })
  const req = (sig: string) =>
    new Request(url, { method: "POST", headers: { "upstash-signature": sig }, body })
  ok("receiver 401 on bad signature", (await receive(req("x.y.z"))).status === 401 && runs === 0)
  const good = await receive(req(mint(keys.currentSigningKey, body)))
  ok("receiver runs job", good.status === 200 && runs === 1)
}

console.log("in-process worker")
{
  let got = ""
  const job = defineJob({
    name: "local",
    input: z.object({ v: z.string() }),
    run: ({ v }) => {
      got = v
    },
  })
  inProcessJobs({ jobs: [job] })
  await job.enqueue({ v: "hello" })
  await sleep(20)
  ok("ran in process", got === "hello")
}

console.log("agent tools")
{
  const boom = defineJob({
    name: "boom",
    input: z.object({}),
    retry: { attempts: 1 },
    run() {
      throw new Error("nope")
    },
  })
  const q = recordingQueue()
  const jobs = createJobs({ jobs: [boom], queue: q })
  await boom.enqueue({})
  await jobs.handle(q.sent[0]!.message)
  const deadId = (await jobs.listDead())[0]!.id
  const ctx = {
    tool: "retry_job",
    signal: new AbortController().signal,
    mcp: { mcpReq: { inputResponses: undefined } },
    confirmSupport: { getClientCapabilities: () => undefined },
  } as unknown as ToolContext
  const tools = Object.fromEntries(jobTools(jobs).map((t) => [t.name, t]))
  const call = (name: string, input: unknown) =>
    (tools[name]!.run as (i: unknown, c: ToolContext) => Promise<unknown>)(input, ctx)
  const listed = (await call("list_failed_jobs", {})) as { failed: { id: string }[] }
  ok("list_failed_jobs", listed.failed[0]?.id === deadId)
  const gated = (await call("retry_job", { id: deadId })) as {
    isError?: boolean
    structuredContent?: { code?: string }
  }
  ok(
    "retry_job needs approval without elicitation",
    gated.isError === true && gated.structuredContent?.code === "APPROVAL_REQUIRED",
    gated,
  )
  ok("nothing retried", (await jobs.listDead()).length === 1 && q.sent.length === 1)
  const missing = (await call("retry_job", { id: "nope" })) as {
    structuredContent?: { code?: string }
  }
  ok("retry_job unknown id", missing.structuredContent?.code === "NOT_FOUND")
  const trusted = Object.fromEntries(
    jobTools(jobs, { retryWithoutApproval: true }).map((t) => [t.name, t]),
  )
  await (trusted.retry_job!.run as (i: unknown, c: ToolContext) => Promise<unknown>)(
    { id: deadId },
    ctx,
  )
  ok("retry_job when allowed", (await jobs.listDead()).length === 0 && q.sent.length === 2)
  await call("pause_job", { name: "boom" })
  ok("pause_job", await jobs.isPaused("boom"))
  await call("resume_job", { name: "boom" })
  ok("resume_job", !(await jobs.isPaused("boom")))
  const ghost = (await call("pause_job", { name: "ghost" })) as {
    structuredContent?: { code?: string }
  }
  ok("pause_job unknown", ghost.structuredContent?.code === "NOT_FOUND")
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
