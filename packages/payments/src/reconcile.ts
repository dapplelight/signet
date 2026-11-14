/**
 * Reconciliation: the gateway's settlement report for a day against the
 * ledger. Each payment or refund line must match a ledger posting for the same
 * payment with the same amount (and fee, where both sides have one).
 *
 *   missing         settled by the gateway, not in the ledger (a webhook never arrived)
 *   amount_differs  both have it, amounts or fees differ
 *   extra           in the ledger inside the report's time span, not settled
 *
 * `reconcileJob` is the same thing shaped for a scheduler: yesterday (UTC) by
 * default, mismatches handed to `onMismatch`.
 */

import { PaymentsError } from "./errors.js"
import type { LedgerEntry, PaymentsStore } from "./store.js"
import type { PaymentGateway, SettlementLine } from "./types.js"

export type Mismatch = {
  kind: "missing" | "amount_differs" | "extra"
  line: "payment" | "refund"
  /** The payment (gatewayId). */
  paymentId: string
  /** The refund id, for refund lines. */
  gatewayId?: string
  currency: string
  gatewayAmount?: number
  ledgerAmount?: number
  gatewayFee?: number
  ledgerFee?: number
}

export type ReconcileResult = {
  gateway: string
  date: string
  checked: number
  mismatches: Mismatch[]
}

const sumBy = (entries: LedgerEntry[], kind: string, account: string) =>
  entries.filter((e) => e.kind === kind && e.account === account).reduce((s, e) => s + e.amount, 0)

export async function reconcile(
  db: PaymentsStore,
  gateway: PaymentGateway,
  options: { date: string },
): Promise<ReconcileResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date))
    throw new PaymentsError("BAD_INPUT", `date is YYYY-MM-DD; got "${options.date}".`)
  const settlements = await gateway.listSettlements({ date: options.date })
  const lines = settlements
    .flatMap((s) => s.lines)
    .filter(
      (l): l is SettlementLine & { kind: "payment" | "refund" } =>
        l.kind === "payment" || l.kind === "refund",
    )
  const mismatches: Mismatch[] = []
  const seen = new Set<string>()

  // Payment lines: compare the capture (and fee) posted for that payment.
  for (const l of lines.filter((l) => l.kind === "payment")) {
    const pid = l.paymentId ?? l.gatewayId
    seen.add(`payment:${pid}`)
    const entries = await db.entries({ ref: pid, gateway: gateway.name })
    const captured = sumBy(entries, "capture", "revenue") * -1
    const fee = sumBy(entries, "fee", "fees")
    const base = {
      line: "payment" as const,
      paymentId: pid,
      currency: l.currency,
      gatewayAmount: l.amount,
    }
    if (!captured) mismatches.push({ kind: "missing", ...base })
    else if (captured !== l.amount || (l.fee !== undefined && fee && fee !== l.fee))
      mismatches.push({
        kind: "amount_differs",
        ...base,
        ledgerAmount: captured,
        ...(l.fee !== undefined ? { gatewayFee: l.fee } : {}),
        ...(fee ? { ledgerFee: fee } : {}),
      })
  }

  // Refund lines: compare the refund posting keyed by the refund id.
  for (const l of lines.filter((l) => l.kind === "refund")) {
    const pid = l.paymentId ?? ""
    seen.add(`refund:${l.gatewayId}`)
    const entries = pid ? await db.entries({ ref: pid, gateway: gateway.name }) : []
    const posted = entries
      .filter(
        (e) =>
          e.kind === "refund" &&
          e.account === "refunds" &&
          e.txId === `${gateway.name}:${l.gatewayId}:refund`,
      )
      .reduce((s, e) => s + e.amount, 0)
    const base = {
      line: "refund" as const,
      paymentId: pid,
      gatewayId: l.gatewayId,
      currency: l.currency,
      gatewayAmount: l.amount,
    }
    if (!posted) mismatches.push({ kind: "missing", ...base })
    else if (posted !== l.amount)
      mismatches.push({ kind: "amount_differs", ...base, ledgerAmount: posted })
  }

  // Extra: ledger captures and refunds inside the span of transaction times the report covers.
  // ponytail: span = min..max line createdAt; a report with lines from a long tail widens it. Pass explicit windows if that bites.
  if (lines.length) {
    const times = lines.map((l) => l.createdAt.getTime())
    const from = new Date(Math.min(...times))
    const to = new Date(Math.max(...times) + 1)
    for (const e of await db.entries({ gateway: gateway.name, from, to })) {
      if (e.kind === "capture" && e.account === "revenue" && e.ref && !seen.has(`payment:${e.ref}`))
        mismatches.push({
          kind: "extra",
          line: "payment",
          paymentId: e.ref,
          currency: e.currency,
          ledgerAmount: -e.amount,
        })
      if (e.kind === "refund" && e.account === "refunds" && e.ref) {
        const refundId = e.txId.slice(gateway.name.length + 1, -":refund".length)
        if (!seen.has(`refund:${refundId}`))
          mismatches.push({
            kind: "extra",
            line: "refund",
            paymentId: e.ref,
            gatewayId: refundId,
            currency: e.currency,
            ledgerAmount: e.amount,
          })
      }
    }
  }
  return { gateway: gateway.name, date: options.date, checked: lines.length, mismatches }
}

/** A scheduler-ready reconcile: `date` defaults to yesterday in UTC. */
export function reconcileJob(
  db: PaymentsStore,
  gateway: PaymentGateway,
  options: { onMismatch?: (r: ReconcileResult) => void | Promise<void> } = {},
) {
  return async (
    date = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
  ): Promise<ReconcileResult> => {
    const r = await reconcile(db, gateway, { date })
    if (r.mismatches.length) await options.onMismatch?.(r)
    return r
  }
}
