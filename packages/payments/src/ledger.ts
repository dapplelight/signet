/**
 * A small double-entry ledger. A transaction is a list of legs whose signed
 * amounts (debit positive, credit negative) sum to zero per currency; that is
 * checked before anything is written, and all legs go in one atomic insert
 * keyed by `txId`, so posting the same transaction twice is a no-op. Balances
 * are integer sums in minor units, never floats.
 *
 * Accounts used by the payment postings (yours can be anything):
 *   receivable:<gateway>  money the gateway holds for you
 *   revenue               captured sales
 *   refunds               money returned (a contra-revenue account)
 *   fees                  gateway fees
 *   bank                  paid out to your bank
 */

import { PaymentsError } from "./errors.js"
import type { LedgerEntry, PaymentsStore } from "./store.js"

export type Leg = { account: string; amount: number; currency: string }

export type Transaction = {
  txId: string
  kind: string
  legs: Leg[]
  gateway?: string
  ref?: string
  at?: Date
}

export const receivable = (gateway: string) => `receivable:${gateway}`

/** Entries for a transaction, or UNBALANCED / BAD_INPUT if it is not a valid one. */
export function toEntries(tx: Transaction): LedgerEntry[] {
  if (tx.legs.length < 2)
    throw new PaymentsError("UNBALANCED", `Transaction ${tx.txId} needs at least two legs.`)
  const sums = new Map<string, number>()
  for (const l of tx.legs) {
    if (!Number.isSafeInteger(l.amount) || l.amount === 0)
      throw new PaymentsError(
        "BAD_INPUT",
        `Ledger amounts are non-zero integer minor units; got ${l.amount} on ${l.account}.`,
      )
    sums.set(l.currency, (sums.get(l.currency) ?? 0) + l.amount)
  }
  for (const [cur, s] of sums)
    if (s !== 0)
      throw new PaymentsError(
        "UNBALANCED",
        `Transaction ${tx.txId} is off by ${s} ${cur}: debits must equal credits.`,
      )
  const at = tx.at ?? new Date()
  return tx.legs.map((l, seq) => ({
    txId: tx.txId,
    seq,
    account: l.account,
    amount: l.amount,
    currency: l.currency,
    kind: tx.kind,
    ...(tx.gateway ? { gateway: tx.gateway } : {}),
    ...(tx.ref ? { ref: tx.ref } : {}),
    at,
  }))
}

/** Post a balanced transaction. Returns false if `txId` was already posted. */
export function post(store: PaymentsStore, tx: Transaction): Promise<boolean> {
  return store.post(toEntries(tx))
}

/** Debit `debit`, credit `credit`, `amount` minor units. */
export const transfer = (
  debit: string,
  credit: string,
  amount: number,
  currency: string,
): Leg[] => [
  { account: debit, amount, currency },
  { account: credit, amount: -amount, currency },
]

type Ctx = { gateway: string; currency: string; at?: Date }

/** The postings `createPayments` makes. Each txId is derived from the object, so replays never double-post. */
export const postings = {
  capture: (c: Ctx & { paymentId: string; amount: number }): Transaction => ({
    txId: `${c.gateway}:${c.paymentId}:capture`,
    kind: "capture",
    gateway: c.gateway,
    ref: c.paymentId,
    at: c.at,
    legs: transfer(receivable(c.gateway), "revenue", c.amount, c.currency),
  }),
  fee: (c: Ctx & { paymentId: string; amount: number }): Transaction => ({
    txId: `${c.gateway}:${c.paymentId}:fee`,
    kind: "fee",
    gateway: c.gateway,
    ref: c.paymentId,
    at: c.at,
    legs: transfer("fees", receivable(c.gateway), c.amount, c.currency),
  }),
  refund: (c: Ctx & { paymentId: string; refundId: string; amount: number }): Transaction => ({
    txId: `${c.gateway}:${c.refundId}:refund`,
    kind: "refund",
    gateway: c.gateway,
    ref: c.paymentId,
    at: c.at,
    legs: transfer("refunds", receivable(c.gateway), c.amount, c.currency),
  }),
  payout: (c: Ctx & { payoutId: string; amount: number }): Transaction => ({
    txId: `${c.gateway}:${c.payoutId}:payout`,
    kind: "payout",
    gateway: c.gateway,
    ref: c.payoutId,
    at: c.at,
    legs: transfer("bank", receivable(c.gateway), c.amount, c.currency),
  }),
  payoutReversal: (c: Ctx & { payoutId: string; amount: number }): Transaction => ({
    txId: `${c.gateway}:${c.payoutId}:payout-reversal`,
    kind: "payout-reversal",
    gateway: c.gateway,
    ref: c.payoutId,
    at: c.at,
    legs: transfer(receivable(c.gateway), "bank", c.amount, c.currency),
  }),
}

export function balance(store: PaymentsStore, account: string, currency: string): Promise<number> {
  return store.balance(account, currency)
}
