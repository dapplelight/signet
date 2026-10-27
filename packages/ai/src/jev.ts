/**
 * Jev (TypeSafe System One): a classifier that returns a typed decision, never text.
 *
 * Fetch-only on purpose. The HTTP API is one endpoint (`POST /v1/systemone`,
 * Bearer auth, JSON in and out), so wrapping `@typesafe-ai/sdk` would add a
 * dependency whose main behaviours we would then have to switch off: its
 * retries (which stretch an 8 s per-attempt timeout to ~27 s), its env fallback
 * to `TYPESAFE_API_KEY`, and its debug logging of request bodies.
 *
 * Three rules this module makes structural rather than advisory:
 *
 * 1. **Every decision falls back.** Each call takes a `fallback` and always
 *    resolves to `{ value, confident, source, reason? }`. Low confidence, a
 *    timeout, an HTTP or network error, a malformed answer and a missing key
 *    all return the fallback. Nothing here throws for those.
 * 2. **Sensitive text needs an explicit opt-in.** `sensitive` is a required
 *    field on every call. A sensitive call reaches Jev only when the instance
 *    was created with `allowSensitive: true`.
 * 3. **The key never leaves the Authorization header.** Events carry no key,
 *    no state and no question text, and no upstream error message is copied
 *    into a result, since those can echo request headers.
 *
 * Config only: nothing reads the environment, at module scope or anywhere else.
 */

/** Pinned: confidence floors are tuned per model version, and `jev-latest` moves. */
export const JEV_DEFAULT_MODEL = "jev-1.13.0"
/**
 * app-a's first real run let wrong guesses through at 0.85-0.94 and none at
 * 0.95; app-d adopted the same bar. Lower it per call when a wrong answer is cheap.
 */
export const JEV_DEFAULT_MIN_CONFIDENCE = 0.95
export const JEV_DEFAULT_TIMEOUT_MS = 8000
export const JEV_DEFAULT_BASE_URL = "https://api.typesafe.ai"

/** Text, a JSON object or a JSON array: what Jev accepts as state. */
export type JevJson = string | number | boolean | null | JevJson[] | { [key: string]: JevJson }
export type JevState = string | JevJson[] | { [key: string]: JevJson }

/** Why a decision used its fallback. */
export type JevFallbackReason =
  | "no_key"
  | "sensitive_not_allowed"
  | "low_confidence"
  | "timeout"
  | "aborted"
  | "http_error"
  | "network_error"
  | "invalid_response"
  | "invalid_request"

export type JevDecision<T> =
  | { value: T; confident: true; source: "jev"; confidence: number; reason?: undefined }
  | {
      value: T
      confident: false
      source: "fallback"
      reason: JevFallbackReason
      /** Jev's confidence when it answered but below the floor (or out of range). */
      confidence?: number
      /** What Jev picked before it was discarded, for review queues. */
      answer?: T
    }

/** A noul decision also carries the raw yes-probability, for ranking. */
export type JevNoulDecision = JevDecision<boolean> & { probability?: number }

/** Redacted: no key, no state, no question text. */
export interface JevEvent {
  kind: "choice" | "score" | "noul"
  /** Question name inside a batch; "result" for a single call. */
  name: string
  source: "jev" | "fallback"
  reason?: JevFallbackReason
  confidence?: number
  sensitive: boolean
  model: string
  /** HTTP status on `http_error`. */
  status?: number
  durationMs: number
}

export type JevFetch = (url: string, init: RequestInit) => Promise<Response>

export interface JevConfig {
  /** Pass `env.JEV_API_KEY`. Missing or empty: every call returns its fallback. */
  apiKey?: string
  model?: string
  minConfidence?: number
  /** Total budget for one call. No retries: on timeout the fallback is used. */
  timeoutMs?: number
  /**
   * Explicit opt-in to send calls marked `sensitive: true` (private or
   * financial user text). Off by default; set it from an owner's decision,
   * never from a user request.
   */
  allowSensitive?: boolean
  baseUrl?: string
  fetch?: JevFetch
  onEvent?: (event: JevEvent) => void
}

interface CallBase {
  state: JevState
  /**
   * Required on purpose. `true` for anything private or financial the user
   * wrote or owns; it then needs `allowSensitive` on the instance.
   */
  sensitive: boolean
  /** Per-call override of the instance floor. */
  minConfidence?: number
  signal?: AbortSignal
}

export type JevOptions<L extends string> = readonly L[] | { readonly [K in L]: string | null }

export interface ChoiceArgs<L extends string> extends CallBase {
  question: string
  /** Up to 255 labels, as a list or as label -> description. */
  options: JevOptions<L>
  fallback: NoInfer<L>
}

export interface ScoreArgs extends CallBase {
  question: string
  /** 2-10 ordered level descriptions, index = score. */
  levels: readonly string[]
  fallback: number
}

export interface NoulArgs extends CallBase {
  question: string
  fallback: boolean
}

/** One question inside a batch. */
export type JevBatchQuestion =
  | { type: "choice"; question: string; options: JevOptions<string>; fallback: string }
  | { type: "score"; question: string; levels: readonly string[]; fallback: number }
  | { type: "noul"; question: string; fallback: boolean }

type LabelsOf<O> = O extends readonly (infer L)[] ? L : keyof O & string

export type JevBatchResult<Q extends Record<string, JevBatchQuestion>> = {
  [K in keyof Q]: Q[K] extends { type: "noul" }
    ? JevNoulDecision
    : Q[K] extends { type: "score" }
      ? JevDecision<number>
      : Q[K] extends { options: infer O }
        ? JevDecision<LabelsOf<O>>
        : never
}

export interface BatchArgs<Q extends Record<string, JevBatchQuestion>> extends CallBase {
  /** Several questions about the same state, in one request (cheaper and faster). */
  questions: Q
}

export interface Jev {
  /** True when a key is configured. Lets an app skip preparing work it will not send. */
  readonly enabled: boolean
  choice<const L extends string>(args: ChoiceArgs<L>): Promise<JevDecision<L>>
  score(args: ScoreArgs): Promise<JevDecision<number>>
  noul(args: NoulArgs): Promise<JevNoulDecision>
  batch<const Q extends Record<string, JevBatchQuestion>>(
    args: BatchArgs<Q>,
  ): Promise<JevBatchResult<Q>>
}

type AnyDecision = JevDecision<unknown> & { probability?: number }

function fallbackOf(
  q: JevBatchQuestion,
  reason: JevFallbackReason,
  extra: { confidence?: number; answer?: unknown; probability?: number } = {},
): AnyDecision {
  const d: AnyDecision = { value: q.fallback, confident: false, source: "fallback", reason }
  if (extra.confidence !== undefined) d.confidence = extra.confidence
  if (extra.answer !== undefined) d.answer = extra.answer
  if (extra.probability !== undefined) d.probability = extra.probability
  return d
}

function labelsOf(options: JevOptions<string>): string[] {
  return Array.isArray(options) ? [...options] : Object.keys(options)
}

function isUnit(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1
}

function validQuestion(q: JevBatchQuestion): boolean {
  if (!q || typeof q.question !== "string") return false
  if (q.type === "choice") {
    const labels = labelsOf(q.options)
    return labels.length >= 1 && labels.length <= 255 && labels.includes(q.fallback)
  }
  if (q.type === "score") {
    return Array.isArray(q.levels) && q.levels.length >= 2 && q.levels.length <= 10
  }
  return q.type === "noul"
}

function toWire(q: JevBatchQuestion): Record<string, unknown> {
  if (q.type === "choice") {
    const criteria = Array.isArray(q.options)
      ? Object.fromEntries(q.options.map((l) => [l, null]))
      : q.options
    return { type: "choice", instructions: q.question, criteria }
  }
  if (q.type === "score") return { type: "score", instructions: q.question, criteria: q.levels }
  return { type: "noul", instructions: q.question }
}

/** Judge one answer against its question and the floor. Pure. */
function judge(q: JevBatchQuestion, raw: unknown, min: number): AnyDecision {
  const a = raw as Record<string, unknown> | null | undefined
  if (!a || typeof a !== "object") return fallbackOf(q, "invalid_response")

  if (q.type === "noul") {
    const p = a.noul
    if (!isUnit(p)) return fallbackOf(q, "invalid_response")
    // Jev reports no separate confidence for noul; the stronger side is it.
    const confidence = Math.max(p, 1 - p)
    const answer = p >= 0.5
    if (confidence < min) {
      return fallbackOf(q, "low_confidence", { confidence, answer, probability: p })
    }
    return { value: answer, confident: true, source: "jev", confidence, probability: p }
  }

  const confidence = a.confidence
  if (!isUnit(confidence)) return fallbackOf(q, "invalid_response")

  let answer: unknown
  if (q.type === "choice") {
    // A label outside the offered set is never acted on.
    if (typeof a.choice !== "string" || !labelsOf(q.options).includes(a.choice)) {
      return fallbackOf(q, "invalid_response", { confidence })
    }
    answer = a.choice
  } else {
    const s = a.score
    if (typeof s !== "number" || !Number.isFinite(s) || s < 0 || s > q.levels.length - 1) {
      return fallbackOf(q, "invalid_response", { confidence })
    }
    answer = s
  }
  if (confidence < min) return fallbackOf(q, "low_confidence", { confidence, answer })
  return { value: answer, confident: true, source: "jev", confidence }
}

class Timeout {}

export function createJev(config: JevConfig): Jev {
  const apiKey = typeof config.apiKey === "string" ? config.apiKey.trim() : ""
  const model = config.model ?? JEV_DEFAULT_MODEL
  const floor = config.minConfidence ?? JEV_DEFAULT_MIN_CONFIDENCE
  const timeoutMs = config.timeoutMs ?? JEV_DEFAULT_TIMEOUT_MS
  const allowSensitive = config.allowSensitive === true
  const url = `${(config.baseUrl ?? JEV_DEFAULT_BASE_URL).replace(/\/+$/, "")}/v1/systemone`

  function emit(event: JevEvent) {
    if (!config.onEvent) return
    try {
      config.onEvent(event)
    } catch {
      // An observer must never turn a decision into a throw.
    }
  }

  /** Every path lands here, so every decision emits exactly one event. */
  function finish(
    questions: Record<string, JevBatchQuestion>,
    decisions: Record<string, AnyDecision>,
    meta: { sensitive: boolean; started: number; status?: number },
  ) {
    const durationMs = Date.now() - meta.started
    for (const [name, d] of Object.entries(decisions)) {
      const event: JevEvent = {
        kind: questions[name].type,
        name,
        source: d.source,
        sensitive: meta.sensitive,
        model,
        durationMs,
      }
      if (d.reason) event.reason = d.reason
      if (d.confidence !== undefined) event.confidence = d.confidence
      if (meta.status !== undefined && d.reason === "http_error") event.status = meta.status
      emit(event)
    }
    return decisions
  }

  async function run(
    questions: Record<string, JevBatchQuestion>,
    base: CallBase,
  ): Promise<Record<string, AnyDecision>> {
    const started = Date.now()
    const sensitive = base.sensitive === true
    const all = (reason: JevFallbackReason, status?: number) =>
      finish(
        questions,
        Object.fromEntries(Object.entries(questions).map(([n, q]) => [n, fallbackOf(q, reason)])),
        { sensitive, started, status },
      )

    // Order matters: the privacy gate runs before anything else can reach the network.
    // A missing `sensitive` (plain JS callers) is treated as sensitive.
    if (base.sensitive !== false && !allowSensitive) return all("sensitive_not_allowed")
    if (!apiKey) return all("no_key")

    const min = base.minConfidence ?? floor
    const names = Object.keys(questions)
    if (!isUnit(min) || names.length === 0 || !names.every((n) => validQuestion(questions[n]))) {
      return all("invalid_request")
    }
    if (base.signal?.aborted) return all("aborted")

    const controller = new AbortController()
    const onAbort = () => controller.abort()
    base.signal?.addEventListener("abort", onAbort, { once: true })
    let timer: ReturnType<typeof setTimeout> | undefined
    // Raced as well as wired to the signal, so a fetch that ignores `signal` still times out.
    const timeout = new Promise<Timeout>((resolve) => {
      timer = setTimeout(() => {
        controller.abort()
        resolve(new Timeout())
      }, timeoutMs)
    })

    const doFetch = config.fetch ?? ((u: string, i: RequestInit) => globalThis.fetch(u, i))
    let status: number | undefined
    try {
      const request = (async () => {
        const res = await doFetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            state: base.state,
            questions: Object.fromEntries(names.map((n) => [n, toWire(questions[n])])),
          }),
          signal: controller.signal,
        })
        status = res.status
        if (!res.ok) return { ok: false as const }
        return { ok: true as const, body: (await res.json()) as unknown }
      })()
      const out = await Promise.race([request, timeout])
      if (out instanceof Timeout) {
        request.catch(() => {})
        return all("timeout")
      }
      if (!out.ok) return all("http_error", status)
      const answers = (out.body as { answers?: Record<string, unknown> } | null)?.answers
      if (!answers || typeof answers !== "object") return all("invalid_response")
      return finish(
        questions,
        Object.fromEntries(names.map((n) => [n, judge(questions[n], answers[n], min)])),
        { sensitive, started },
      )
    } catch (err) {
      // Never surface the upstream error: a fetch implementation may echo headers.
      if (base.signal?.aborted) return all("aborted")
      if (status !== undefined) return all("invalid_response")
      return all((err as { name?: string })?.name === "TimeoutError" ? "timeout" : "network_error")
    } finally {
      clearTimeout(timer)
      base.signal?.removeEventListener("abort", onAbort)
    }
  }

  function baseOf(args: CallBase): CallBase {
    return {
      state: args.state,
      sensitive: args.sensitive,
      minConfidence: args.minConfidence,
      signal: args.signal,
    }
  }

  return {
    enabled: apiKey.length > 0,
    async choice(args) {
      const q: JevBatchQuestion = {
        type: "choice",
        question: args.question,
        options: args.options,
        fallback: args.fallback,
      }
      const { result } = await run({ result: q }, baseOf(args))
      return result as never
    },
    async score(args) {
      const q: JevBatchQuestion = {
        type: "score",
        question: args.question,
        levels: args.levels,
        fallback: args.fallback,
      }
      const { result } = await run({ result: q }, baseOf(args))
      return result as never
    },
    async noul(args) {
      const q: JevBatchQuestion = { type: "noul", question: args.question, fallback: args.fallback }
      const { result } = await run({ result: q }, baseOf(args))
      return result as never
    },
    async batch(args) {
      return (await run(args.questions, baseOf(args))) as never
    },
  }
}
