/**
 * Growth tools for an operator agent (support, founder), as plain MCP tool
 * objects (see `tool-kit.ts`):
 *
 *   waitlist_stats     total, pending and invited counts
 *   list_waitlist      oldest first, optionally only people still waiting
 *   list_feedback      newest first, by status or kind
 *   referral_stats     a subject's code and referral counts
 *   list_invites       by sender or scope, with status
 *   create_invite      a new invite; returns the token once         approval
 *   revoke_invite      revoke a pending invite                      approval
 *   set_feedback_status  new | seen | done                         approval
 *
 * Write tools exist only with `allowWrites` and ALWAYS call
 * `approve(ctx, { summary, details, args })`, acting only when it returns
 * undefined; with no `approve` they change nothing and return
 * APPROVAL_REQUIRED.
 */

import type { FeedbackStatus, Growth } from "./growth.js"
import { type Approve, bad, gated, obj, type PlainTool, str } from "./tool-kit.js"

export type GrowthToolsOptions = {
  growth: Growth
  /** Add create_invite, revoke_invite and set_feedback_status. Default false. */
  allowWrites?: boolean
  /** Who create_invite records as the sender. Default "agent". */
  invitedBy?: string
  /** Undefined = approved; anything else is returned as the tool result. */
  approve?: Approve
}

const page = {
  limit: { type: "integer", minimum: 1, maximum: 500 },
  offset: { type: "integer", minimum: 0 },
}
const num = (v: unknown) => (typeof v === "number" ? v : undefined)
const opt = (v: unknown) => (typeof v === "string" && v ? v : undefined)
const READ = { readOnlyHint: true, destructiveHint: false }

export function growthTools(options: GrowthToolsOptions): PlainTool[] {
  const g = options.growth
  const gate = (
    ctx: unknown,
    summary: string,
    details: Record<string, unknown>,
    act: () => Promise<unknown>,
  ) => gated(options.approve, ctx, { summary, details, args: details }, act)

  const tools: PlainTool[] = [
    {
      name: "waitlist_stats",
      description: "Waitlist size: total, still pending, already invited.",
      annotations: READ,
      inputSchema: obj({}),
      run: async () => g.waitlistStats(),
    },
    {
      name: "list_waitlist",
      description:
        "Waitlist entries, oldest first. pending: true leaves out people already invited.",
      annotations: READ,
      inputSchema: obj({ pending: { type: "boolean" }, ...page }),
      run: async (i) => ({
        entries: await g.listWaitlist({
          pending: i.pending === true,
          limit: num(i.limit),
          offset: num(i.offset),
        }),
      }),
    },
    {
      name: "list_feedback",
      description: `Feedback, newest first, optionally by status (new, seen, done) or kind (${g.feedbackKinds.join(", ")}).`,
      annotations: READ,
      inputSchema: obj({
        status: { type: "string", enum: ["new", "seen", "done"] },
        kind: { type: "string", enum: [...g.feedbackKinds] },
        ...page,
      }),
      run: async (i) => ({
        feedback: await g.listFeedback({
          status: opt(i.status) as FeedbackStatus | undefined,
          kind: opt(i.kind),
          limit: num(i.limit),
          offset: num(i.offset),
        }),
      }),
    },
    {
      name: "referral_stats",
      description:
        "A user's referral code and how many people they referred, converted and were rewarded for.",
      annotations: READ,
      inputSchema: obj({ subject: { type: "string", minLength: 1 } }, ["subject"]),
      run: async (i) => g.referralStats(str(i, "subject")),
    },
    {
      name: "list_invites",
      description:
        "Invites, newest first, by sender (invitedBy) or what they are to (scope), with status pending, accepted, revoked or expired.",
      annotations: READ,
      inputSchema: obj({ invitedBy: { type: "string" }, scope: { type: "string" }, ...page }),
      run: async (i) => ({
        invites: await g.listInvites({
          invitedBy: opt(i.invitedBy),
          scope: opt(i.scope),
          limit: num(i.limit),
          offset: num(i.offset),
        }),
      }),
    },
  ]
  if (!options.allowWrites) return tools

  tools.push(
    {
      name: "create_invite",
      description:
        "Create an invite (optionally only for one email, to a scope with a role). Returns the token once; it cannot be shown again. Always asks the person to approve first.",
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: obj({
        email: { type: "string", format: "email" },
        scope: { type: "string" },
        role: { type: "string" },
        days: { type: "integer", minimum: 1, maximum: 90, description: "Valid for. Default 7." },
      }),
      run: async (i, ctx) => {
        const days = num(i.days)
        if (days !== undefined && !(Number.isInteger(days) && days >= 1 && days <= 90))
          throw bad("days is 1 to 90.")
        const details = {
          email: opt(i.email) ?? null,
          scope: opt(i.scope) ?? null,
          role: opt(i.role) ?? null,
          days: days ?? null,
        }
        return gate(
          ctx,
          `Invite ${details.email ?? "anyone with the link"}${details.scope ? ` to ${details.scope}` : ""}${details.role ? ` as ${details.role}` : ""}`,
          details,
          async () =>
            g.createInvite({
              invitedBy: options.invitedBy ?? "agent",
              email: details.email ?? undefined,
              scope: details.scope ?? undefined,
              role: details.role ?? undefined,
              ttlMs: days ? days * 86_400_000 : undefined,
            }),
        )
      },
    },
    {
      name: "revoke_invite",
      description: "Revoke a pending invite by id. Always asks the person to approve first.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      inputSchema: obj({ id: { type: "string", minLength: 1 } }, ["id"]),
      run: async (i, ctx) => {
        const id = str(i, "id")
        return gate(ctx, `Revoke invite ${id}`, { id }, async () => ({
          revoked: await g.revokeInvite(id),
        }))
      },
    },
    {
      name: "set_feedback_status",
      description: "Mark feedback new, seen or done. Always asks the person to approve first.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: obj(
        {
          id: { type: "string", minLength: 1 },
          status: { type: "string", enum: ["new", "seen", "done"] },
        },
        ["id", "status"],
      ),
      run: async (i, ctx) => {
        const id = str(i, "id")
        const status = str(i, "status") as FeedbackStatus
        return gate(ctx, `Mark feedback ${id} ${status}`, { id, status }, async () => ({
          updated: await g.setFeedbackStatus(id, status),
        }))
      },
    },
  )
  return tools
}
