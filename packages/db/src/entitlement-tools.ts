/**
 * Plan, entitlement and flag tools for AI agents, as plain MCP tool objects
 * (`name`, `description`, `inputSchema` as JSON Schema, `annotations`,
 * `run(input, ctx)`), the shape signet-server's `createMcpServer({ tools })`
 * takes, with no dependency on it. Zod is not needed.
 *
 *   get_plan           plan in effect, status, features, limits, overrides
 *   check_entitlement  one feature (allowed?) or one limit (value)
 *   usage              this period's usage against each limit
 *   list_flags         every flag's value for the subject, and why
 *   grant_feature      grant or revoke a feature (optionally until a date)   approval
 *   set_plan           put the subject on a plan                             approval
 *   set_flag           override a flag for the subject (or everyone)         approval
 *
 * Read tools act on `subject`, fixed by the app. Write tools exist only with
 * `allowWrites` and ALWAYS call `approve(ctx, { summary, details, args })`,
 * acting only when it returns undefined; with no `approve` they change
 * nothing and return APPROVAL_REQUIRED. Writes are audited as `actor`.
 * `allSubjects: true` is for an operator agent: every tool then takes a
 * `subject` argument.
 */

import type { Entitlements, Plans, Resolved, Usage } from "./entitlements.js"
import { SignetDbError } from "./errors.js"
import type { FlagStore, Flags, FlagValue } from "./flags.js"
import type { Actor } from "./scoped.js"

export type ApprovalRequest = { summary: string; details: Record<string, unknown>; args: unknown }

export type EntitlementToolsOptions<P extends Plans = Plans, F extends Flags = Flags> = {
  entitlements: Entitlements<P>
  flags?: FlagStore<F>
  /** The user or org the agent acts for. Required unless `allSubjects`. */
  subject?: string
  /** An operator agent that may act on any subject. Default false. */
  allSubjects?: boolean
  /** Add grant_feature, set_plan and set_flag. Default false. */
  allowWrites?: boolean
  /** Recorded in the audit log. Default `{ type: "agent", id: "agent" }`. */
  actor?: Actor
  /** Undefined = approved; anything else is returned as the tool result. e.g. `(ctx, r) => requireApproval(ctx, r)`. */
  approve?: (ctx: unknown, request: ApprovalRequest) => Promise<unknown> | unknown
}

export type EntitlementTool = {
  readonly name: string
  readonly description: string
  readonly annotations: {
    readOnlyHint: boolean
    destructiveHint: boolean
    idempotentHint?: boolean
  }
  readonly inputSchema: Record<string, unknown>
  run(input: Record<string, unknown>, ctx?: unknown): Promise<unknown>
}

const needsApproval = (r: ApprovalRequest) => ({
  isError: true,
  content: [
    {
      type: "text",
      text: `APPROVAL_REQUIRED: Needs a person's approval: ${r.summary}. Nothing was changed.`,
    },
  ],
  structuredContent: {
    success: false,
    code: "APPROVAL_REQUIRED",
    error: `Needs approval: ${r.summary}`,
    approval: { summary: r.summary, details: r.details },
  },
})

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
})

const bad = (msg: string) => new SignetDbError("BAD_INPUT", msg)
const num = (n: number) => (Number.isFinite(n) ? n : "unlimited")

const planView = (r: Resolved<Plans>) => ({
  plan: r.plan,
  storedPlan: r.storedPlan,
  status: r.status,
  graceUntil: r.graceUntil?.toISOString() ?? null,
  features: r.features,
  limits: Object.fromEntries(Object.entries(r.limits).map(([k, v]) => [k, num(v)])),
  overrides: r.overrides.map((o) => ({
    id: o.id,
    kind: o.kind,
    key: o.key,
    value:
      o.kind === "feature"
        ? o.value
          ? "granted"
          : "revoked"
        : num(o.value ?? Number.POSITIVE_INFINITY),
    expiresAt: o.expiresAt?.toISOString() ?? null,
  })),
})

const usageView = (u: Usage) => ({ ...u, limit: num(u.limit), remaining: num(u.remaining) })

export function entitlementTools<P extends Plans, F extends Flags>(
  options: EntitlementToolsOptions<P, F>,
): EntitlementTool[] {
  const { allSubjects = false, allowWrites = false } = options
  const flags = options.flags as unknown as FlagStore<Flags> | undefined
  // Typed loosely here: tool input is checked against the declared keys at runtime.
  const ent = options.entitlements as unknown as Entitlements<Plans>
  const actor = options.actor ?? { type: "agent", id: "agent" }
  if (!options.subject && !allSubjects)
    throw bad("entitlementTools needs a subject (or allSubjects: true for an operator agent).")

  const subjectProp = allSubjects
    ? { subject: { type: "string", minLength: 1, description: "The user or org id." } }
    : {}
  const subjectReq = allSubjects ? ["subject"] : []
  const str = (input: Record<string, unknown>, key: string): string => {
    const v = input[key]
    if (typeof v !== "string" || !v) throw bad(`${key} is required (a string).`)
    return v
  }
  const who = (input: Record<string, unknown>) =>
    allSubjects ? str(input, "subject") : (options.subject as string)
  const date = (input: Record<string, unknown>) => {
    if (input.expiresAt === undefined) return undefined
    const d = new Date(String(input.expiresAt))
    if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now())
      throw bad("expiresAt must be a future ISO date-time.")
    return d
  }
  const oneOf = (list: readonly string[], v: string, what: string) => {
    if (!list.includes(v)) throw bad(`Unknown ${what} "${v}". One of: ${list.join(", ")}.`)
    return v
  }
  const gated = async (ctx: unknown, request: ApprovalRequest, act: () => Promise<unknown>) => {
    const gate = options.approve ? await options.approve(ctx, request) : needsApproval(request)
    return gate !== undefined ? gate : act()
  }
  const planKeys = Object.keys(ent.plans)
  const reason = { type: "string", minLength: 1, description: "Why, for the audit trail." }
  const expiresAt = {
    type: "string",
    format: "date-time",
    description: "Optional end of the change.",
  }

  const tools: EntitlementTool[] = [
    {
      name: "get_plan",
      description:
        "The plan in effect now, the stored plan and subscription status (past_due keeps the plan until graceUntil), features, limits and active overrides.",
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: obj(subjectProp, subjectReq),
      run: async (input) => planView(await ent.get(who(input))),
    },
    {
      name: "check_entitlement",
      description: `Whether a feature is allowed, or a limit's value. Pass feature (${ent.features.join(", ") || "none"}) or limit (${ent.limitKeys.join(", ") || "none"}).`,
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: obj(
        {
          ...subjectProp,
          feature: { type: "string", enum: ent.features },
          limit: { type: "string", enum: ent.limitKeys },
        },
        subjectReq,
      ),
      run: async (input) => {
        const s = who(input)
        if (typeof input.feature === "string")
          return {
            feature: input.feature,
            allowed: await ent.can(s, oneOf(ent.features, input.feature, "feature")),
          }
        if (typeof input.limit === "string")
          return {
            limit: input.limit,
            value: num(await ent.limit(s, oneOf(ent.limitKeys, input.limit, "limit"))),
          }
        throw bad("Pass feature or limit.")
      },
    },
    {
      name: "usage",
      description: "Usage this period against each limit (or one key): used, limit, remaining.",
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: obj(
        { ...subjectProp, key: { type: "string", enum: ent.limitKeys } },
        subjectReq,
      ),
      run: async (input) => {
        const key =
          typeof input.key === "string" ? oneOf(ent.limitKeys, input.key, "limit") : undefined
        return { usage: (await ent.usage(who(input), key)).map(usageView) }
      },
    },
  ]
  if (flags)
    tools.push({
      name: "list_flags",
      description:
        "Every feature flag's value for the subject and why (override, rule, rollout or default).",
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: obj(subjectProp, subjectReq),
      run: async (input) => {
        const values = await flags.all({ id: who(input) })
        return {
          flags: Object.entries(values).map(([k, v]) => ({
            flag: k,
            ...(v as object),
            ...(flags.flags[k]?.description ? { description: flags.flags[k].description } : {}),
          })),
        }
      },
    })
  if (!allowWrites) return tools

  tools.push(
    {
      name: "grant_feature",
      description:
        "Grant (or with revoke: true, take away) a feature for the subject, optionally until expiresAt. Always asks the person to approve first.",
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: obj(
        {
          ...subjectProp,
          feature: { type: "string", enum: ent.features },
          revoke: { type: "boolean" },
          expiresAt,
          reason,
        },
        [...subjectReq, "feature", "reason"],
      ),
      run: async (input, ctx) => {
        const s = who(input)
        const feature = oneOf(ent.features, str(input, "feature"), "feature")
        const revoke = input.revoke === true
        const until = date(input)
        const why = str(input, "reason")
        const details = {
          subject: s,
          feature,
          revoke,
          expiresAt: until?.toISOString() ?? null,
          reason: why,
        }
        return gated(
          ctx,
          {
            summary: `${revoke ? "Revoke" : "Grant"} ${feature} for ${s}${until ? ` until ${until.toISOString()}` : ""}`,
            details,
            args: details,
          },
          async () => {
            const o = await (revoke ? ent.revoke : ent.grant)(s, feature, {
              actor,
              expiresAt: until,
            })
            return { done: true, overrideId: o.id, ...details }
          },
        )
      },
    },
    {
      name: "set_plan",
      description: `Put the subject on a plan (${planKeys.join(", ")}). A later billing event replaces it. Always asks the person to approve first.`,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      inputSchema: obj({ ...subjectProp, plan: { type: "string", enum: planKeys }, reason }, [
        ...subjectReq,
        "plan",
        "reason",
      ]),
      run: async (input, ctx) => {
        const s = who(input)
        const plan = oneOf(planKeys, str(input, "plan"), "plan")
        const current = await ent.get(s)
        const details = { subject: s, from: current.plan, to: plan, reason: str(input, "reason") }
        return gated(
          ctx,
          { summary: `Move ${s} from ${current.plan} to ${plan}`, details, args: details },
          async () => planView(await ent.setPlan(s, plan, { actor })),
        )
      },
    },
  )
  if (flags)
    tools.push({
      name: "set_flag",
      description: `Override a feature flag for the subject${allSubjects ? ", or for everyone with everyone: true" : ""}, optionally until expiresAt. Always asks the person to approve first.`,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: obj(
        {
          ...subjectProp,
          flag: { type: "string", enum: Object.keys(flags.flags) },
          value: { type: ["boolean", "number", "string"] },
          ...(allSubjects ? { everyone: { type: "boolean" } } : {}),
          expiresAt,
          reason,
        },
        [...(allSubjects ? [] : subjectReq), "flag", "value", "reason"],
      ),
      run: async (input, ctx) => {
        const flag = oneOf(Object.keys(flags.flags), str(input, "flag"), "flag")
        const everyone = allSubjects && input.everyone === true
        const s = everyone ? "*" : who(input)
        const value = input.value as FlagValue
        const want = typeof flags.flags[flag]?.default
        if (typeof value !== want) throw bad(`Flag ${flag} takes a ${want}.`)
        const until = date(input)
        const details = {
          flag,
          subject: everyone ? "everyone" : s,
          value,
          expiresAt: until?.toISOString() ?? null,
          reason: str(input, "reason"),
        }
        return gated(
          ctx,
          {
            summary: `Set flag ${flag} to ${JSON.stringify(value)} for ${details.subject}`,
            details,
            args: details,
          },
          async () => {
            await flags.set(flag, value as never, { subject: s, actor, expiresAt: until })
            return { done: true, ...details }
          },
        )
      },
    })
  return tools
}
