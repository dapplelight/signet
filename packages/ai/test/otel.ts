import { onUsageAll, otelUsage, spendUsage } from "../src/otel"
import type { UsageReport } from "../src/usage"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}

const base: UsageReport = {
  operation: "extract",
  provider: "primary",
  model: "model-a",
  usage: { inputTokens: 120, outputTokens: 30 },
  costUsd: 0.0005,
  key: "user_1",
  durationMs: 10,
}

/** A fake OpenTelemetry API whose active span records attributes. */
function fakeOtel(withSpan = true) {
  const attrs: Record<string, unknown> = {}
  const api = {
    trace: {
      getActiveSpan: () =>
        withSpan
          ? {
              setAttribute: (k: string, v: unknown) => {
                attrs[k] = v
              },
            }
          : undefined,
    },
  }
  return { attrs, load: async () => api }
}

/** Reports to a hook and waits for its async work to settle. */
const run = async (hook: (r: UsageReport) => void, r: UsageReport) => {
  hook(r)
  await new Promise((res) => setTimeout(res, 5))
}

{
  const { attrs, load } = fakeOtel()
  await run(otelUsage({}, load), base)
  ok(
    "sets gen_ai attributes",
    attrs["gen_ai.system"] === "primary" && attrs["gen_ai.request.model"] === "model-a",
  )
  ok(
    "sets token counts",
    attrs["gen_ai.usage.input_tokens"] === 120 && attrs["gen_ai.usage.output_tokens"] === 30,
  )
  ok(
    "sets cost and cache_hit false",
    attrs["signet.cost_usd"] === 0.0005 && attrs["signet.cache_hit"] === false,
  )
  ok("no saved_usd on a miss", !("signet.saved_usd" in attrs))
  ok(
    "never the key by default",
    !Object.values(attrs).includes("user_1") && !("signet.key" in attrs),
  )
}
{
  const { attrs, load } = fakeOtel()
  await run(otelUsage({ includeKey: true }, load), base)
  ok("includeKey adds the key", attrs["signet.key"] === "user_1")
}
{
  const { attrs, load } = fakeOtel()
  await run(otelUsage({}, load), {
    ...base,
    usage: undefined,
    costUsd: 0,
    cacheHit: true,
    savedUsd: 0.02,
  })
  ok(
    "cache hit: cache_hit, saved_usd, cost 0",
    attrs["signet.cache_hit"] === true &&
      attrs["signet.saved_usd"] === 0.02 &&
      attrs["signet.cost_usd"] === 0,
  )
  ok(
    "missing usage leaves tokens out",
    !("gen_ai.usage.input_tokens" in attrs) && !("gen_ai.usage.output_tokens" in attrs),
  )
}
{
  const { attrs, load } = fakeOtel()
  await run(otelUsage({}, load), { ...base, costUsd: 0 })
  ok("unpriced: cost_usd 0", attrs["signet.cost_usd"] === 0)
}
{
  const { attrs, load } = fakeOtel()
  await run(otelUsage({ attributes: (r) => ({ "app.operation": r.operation }) }, load), base)
  ok("custom attributes added", attrs["app.operation"] === "extract")
}
{
  const { load } = fakeOtel(false)
  let threw = false
  try {
    await run(otelUsage({}, load), base)
  } catch {
    threw = true
  }
  ok("no active span: nothing, no error", !threw)
  let threw2 = false
  try {
    await run(
      otelUsage({}, async () => null),
      base,
    )
  } catch {
    threw2 = true
  }
  ok("api not installed: nothing, no error", !threw2)
  await run(
    otelUsage(
      {
        attributes: () => {
          throw new Error("boom")
        },
      },
      fakeOtel().load,
    ),
    base,
  )
  ok("throwing attributes() does not escape", true)
}
{
  const seen: string[] = []
  const hook = onUsageAll(
    () => seen.push("a"),
    () => {
      throw new Error("boom")
    },
    () => seen.push("c"),
  )
  let threw = false
  try {
    hook(base)
  } catch {
    threw = true
  }
  ok(
    "onUsageAll: throwing hook does not stop the others or throw",
    !threw && seen.join() === "a,c",
    seen,
  )
}
{
  const calls: Array<[unknown, number]> = []
  const spend = { record: (s: unknown, u: number) => void calls.push([s, u]) }
  const hook = spendUsage({ spend, subject: (r) => ({ userId: r.key, orgId: "org_1" }) })
  hook(base)
  hook({ ...base, costUsd: 0 })
  hook({ ...base, costUsd: 0, cacheHit: true, savedUsd: 0.02, usage: undefined })
  ok(
    "spendUsage records units per subject",
    calls[0]?.[1] === 500 &&
      JSON.stringify(calls[0]?.[0]) === JSON.stringify({ userId: "user_1", orgId: "org_1" }),
    calls,
  )
  ok("unpriced and cache hit record 0 units", calls[1]?.[1] === 0 && calls[2]?.[1] === 0, calls)
  const bad = spendUsage({
    spend: {
      record: async () => {
        throw new Error("db down")
      },
    },
    subject: () => ({}),
  })
  let threw = false
  try {
    bad(base)
    await new Promise((res) => setTimeout(res, 5))
  } catch {
    threw = true
  }
  ok("a failing record does not escape", !threw)
  const sync = spendUsage({
    spend,
    subject: () => {
      throw new Error("boom")
    },
  })
  let threw2 = false
  try {
    onUsageAll(sync)(base)
  } catch {
    threw2 = true
  }
  ok("a throwing subject() is isolated by onUsageAll", !threw2)
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
