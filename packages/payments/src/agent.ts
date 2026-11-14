/**
 * Payment tools for AI agents as plain MCP tool objects (`name`, `description`,
 * `inputSchema` as JSON Schema, `annotations`, `run(input, ctx)`), the shape
 * signet-server's `createMcpServer({ tools })` takes, with no dependency on it:
 *
 *   find_payment      one payment by gateway + id
 *   list_payments     newest first, scoped to `userId`, at most `maxRows`
 *   payment_timeline  every stored event for a payment, including who asked for refunds
 *   refund_payment    ALWAYS gated on approval
 *
 * `refund_payment` calls `approve(ctx, { summary, details, args })` and refunds
 * only when it returns undefined. Pass signet-server's `requireApproval`; with
 * no `approve`, the tool never refunds and returns APPROVAL_REQUIRED with the
 * summary for a person to act on. The refund is recorded with `actor`.
 */

import { PaymentsError } from "./errors.js"
import { toMajor } from "./http.js"
import type { Payments } from "./payments.js"
import type { Actor, PaymentRecord } from "./store.js"

export type ApprovalRequest = { summary: string; details: Record<string, unknown>; args: unknown }

export type PaymentToolsOptions = {
  /** The user whose payments the agent may see. Required unless `allUsers`. */
  userId?: string
  /** An operator agent that may see every user's payments. Default false. */
  allUsers?: boolean
  /** Most rows list_payments returns. Default 50. */
  maxRows?: number
  /** Recorded on refunds. Default `{ type: "agent", id: "agent" }`. */
  actor?: Actor
  /** Undefined = approved. Anything else is returned as the tool result. e.g. `(ctx, o) => requireApproval(ctx, o)`. */
  approve?: (ctx: unknown, request: ApprovalRequest) => Promise<unknown> | unknown
}

export type PaymentTool = {
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

const view = (p: PaymentRecord) => ({
  gateway: p.gateway,
  id: p.gatewayId,
  status: p.status,
  amount: p.amount,
  currency: p.currency,
  display: `${toMajor(p.amount, p.currency)} ${p.currency}`,
  amountRefunded: p.amountRefunded,
  ...(p.reference ? { reference: p.reference } : {}),
  ...(p.customerId ? { customerId: p.customerId } : {}),
  createdAt: p.createdAt.toISOString(),
})

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
})

export function paymentTools(payments: Payments, options: PaymentToolsOptions): PaymentTool[] {
  const { userId, allUsers = false, maxRows = 50 } = options
  const actor = options.actor ?? { type: "agent", id: "agent" }
  const db = payments.db
  if (!db) throw new PaymentsError("BAD_INPUT", "paymentTools needs createPayments({ db }).")
  if (!userId && !allUsers)
    throw new PaymentsError(
      "BAD_INPUT",
      "paymentTools needs a userId (or allUsers: true for an operator agent).",
    )
  const store = db

  const str = (input: Record<string, unknown>, key: string): string => {
    const v = input[key]
    if (typeof v !== "string" || !v)
      throw new PaymentsError("BAD_INPUT", `${key} is required (a string).`)
    return v
  }
  const mine = async (input: Record<string, unknown>) => {
    const p = await store.getPayment(str(input, "gateway"), str(input, "id"))
    // Another user's payment reads exactly like a missing one.
    if (!p || (!allUsers && p.userId !== userId))
      throw new PaymentsError(
        "NOT_FOUND",
        "No such payment for this user. Use list_payments to find it.",
      )
    return p
  }
  const ref = {
    gateway: { type: "string", description: "Gateway name, e.g. razorpay" },
    id: { type: "string", description: "The gateway's payment id" },
  }

  return [
    {
      name: "find_payment",
      description:
        "Get one payment by gateway and payment id: status, amount (minor units and display), refunded so far.",
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: obj(ref, ["gateway", "id"]),
      run: async (input) => view(await mine(input)),
    },
    {
      name: "list_payments",
      description: `List payments newest first. At most ${maxRows} per call; page with offset. Filter by status or gateway.`,
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: obj({
        status: {
          type: "string",
          enum: [
            "created",
            "pending",
            "authorized",
            "captured",
            "partially_refunded",
            "refunded",
            "failed",
            "cancelled",
          ],
        },
        gateway: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: maxRows },
        offset: { type: "integer", minimum: 0 },
      }),
      run: async (input) => {
        const limit = Math.min(Number(input.limit ?? maxRows) || maxRows, maxRows)
        const rows = await store.listPayments({
          limit,
          offset: Number(input.offset ?? 0) || 0,
          ...(allUsers ? {} : { userId }),
          ...(typeof input.status === "string"
            ? { status: input.status as PaymentRecord["status"] }
            : {}),
          ...(typeof input.gateway === "string" ? { gateway: input.gateway } : {}),
        })
        return { payments: rows.map(view), limit }
      },
    },
    {
      name: "payment_timeline",
      description:
        "Every event stored for a payment, oldest first: authorised, captured, refunds requested (and by whom), processed, disputes.",
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: obj(ref, ["gateway", "id"]),
      run: async (input) => {
        const p = await mine(input)
        const events = await store.eventsFor(p.gateway, p.gatewayId)
        return {
          payment: view(p),
          events: events.map((e) => ({
            type: e.type,
            gatewayType: e.gatewayType,
            at: e.occurredAt.toISOString(),
            ...(e.amount !== undefined ? { amount: e.amount, currency: e.currency } : {}),
            ...(e.refundId ? { refundId: e.refundId } : {}),
            ...(e.actor ? { actor: e.actor } : {}),
            status: e.status,
          })),
        }
      },
    },
    {
      name: "refund_payment",
      description:
        "Refund a payment, fully or partly. Always asks the person to approve first; nothing is refunded without approval. amount is minor units (paise, cents); omit for a full refund.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      inputSchema: obj(
        {
          ...ref,
          amount: { type: "integer", minimum: 1 },
          reason: { type: "string", minLength: 1 },
        },
        ["gateway", "id", "reason"],
      ),
      run: async (input, ctx) => {
        const p = await mine(input)
        const reason = str(input, "reason")
        const amount = input.amount === undefined ? undefined : Number(input.amount)
        if (amount !== undefined && (!Number.isSafeInteger(amount) || amount <= 0))
          throw new PaymentsError("BAD_INPUT", "amount is a positive integer in minor units.")
        const left = p.amount - p.amountRefunded
        if ((amount ?? left) > left || left <= 0)
          throw new PaymentsError(
            "BAD_INPUT",
            `Only ${toMajor(left, p.currency)} ${p.currency} is left to refund.`,
          )
        const value = amount ?? left
        const request: ApprovalRequest = {
          summary: `Refund ${toMajor(value, p.currency)} ${p.currency} on ${p.gateway} payment ${p.gatewayId}`,
          details: {
            gateway: p.gateway,
            payment: p.gatewayId,
            amount: value,
            currency: p.currency,
            full: amount === undefined,
            reason,
          },
          args: { gateway: p.gateway, id: p.gatewayId, amount: value, reason },
        }
        const gate = options.approve ? await options.approve(ctx, request) : needsApproval(request)
        if (gate !== undefined) return gate
        const r = await payments.refund({
          gateway: p.gateway,
          paymentId: p.gatewayId,
          ...(amount !== undefined ? { amount } : {}),
          reason,
          // Same payment + amount = same key, so a retried call never refunds twice.
          idempotencyKey: `agent-refund-${p.gateway}-${p.gatewayId}-${amount ?? "full"}`,
          actor,
        })
        return {
          refunded: true,
          refundId: r.gatewayId,
          status: r.status,
          amount: r.amount,
          currency: r.currency,
        }
      },
    },
  ]
}
