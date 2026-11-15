/**
 * UPI payment intents: the `upi://pay?...` string a UPI app opens from a
 * link, or reads from a QR code. Parameters follow NPCI's UPI Linking
 * Specification:
 *
 *   pa   payee VPA (required)          pn   payee name (required)
 *   am   amount, rupees, 2 decimals    mam  minimum amount
 *   cu   currency, always INR          tn   note shown to the payer
 *   tr   transaction reference         tid  transaction id
 *   mc   merchant category code        url  link with order details
 *
 * Amounts are integer paise in, like everywhere in signet-payments.
 * Not supported: signed intents (`sign`, `orgid`), `mode` and `purpose`
 * codes, and mandates (`upi://mandate`). A plain intent is not proof of
 * payment: confirm through your gateway's webhook or status API.
 *
 * No QR encoder ships here. Render `upiIntent(...)` with any QR library.
 */

import { PaymentsError } from "./errors.js"

export type UpiIntent = {
  /** Payee VPA, e.g. "shop@okbank". */
  pa: string
  /** Payee name. */
  pn: string
  /** Amount in paise. Leave out to let the payer type it. */
  amount?: number
  /** Minimum amount in paise; needs `amount`. */
  minAmount?: number
  /** Note shown to the payer (max 80 characters). */
  note?: string
  /** Your order or transaction reference (max 35 characters). */
  tr?: string
  /** Transaction id (max 35 characters). */
  tid?: string
  /** Merchant category code, 4 digits. */
  mc?: string
  /** An https link with details of the order. */
  url?: string
}

const bad = (msg: string) => new PaymentsError("BAD_INPUT", msg)

/** A UPI id: handle, "@", provider. Loose on purpose; the payer's app has the final say. */
export const isVpa = (v: string): boolean =>
  /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/.test(v)

const paise = (n: number, what: string) => {
  if (!Number.isSafeInteger(n) || n <= 0) throw bad(`${what} is a positive whole number of paise.`)
  return `${Math.floor(n / 100)}.${String(n % 100).padStart(2, "0")}`
}
const maxLen = (v: string | undefined, n: number, what: string) => {
  if (v !== undefined && (v.length === 0 || v.length > n))
    throw bad(`${what} is 1 to ${n} characters.`)
  return v
}

/** Build a `upi://pay?...` intent. Throws BAD_INPUT on a field UPI apps would reject. */
export function upiIntent(i: UpiIntent): string {
  if (!isVpa(i.pa)) throw bad(`"${i.pa}" is not a UPI id (name@provider).`)
  if (!i.pn?.trim()) throw bad("pn (payee name) is required.")
  if (i.minAmount !== undefined && i.amount === undefined) throw bad("minAmount needs amount.")
  if (i.mc !== undefined && !/^\d{4}$/.test(i.mc))
    throw bad("mc is a 4-digit merchant category code.")
  if (i.url !== undefined && !/^https:\/\//.test(i.url)) throw bad("url must be https.")
  const params: [string, string | undefined][] = [
    ["pa", i.pa],
    ["pn", maxLen(i.pn.trim(), 99, "pn")],
    ["mc", i.mc],
    ["tid", maxLen(i.tid, 35, "tid")],
    ["tr", maxLen(i.tr, 35, "tr")],
    ["tn", maxLen(i.note, 80, "note")],
    ["am", i.amount === undefined ? undefined : paise(i.amount, "amount")],
    ["mam", i.minAmount === undefined ? undefined : paise(i.minAmount, "minAmount")],
    ["cu", "INR"],
    ["url", i.url],
  ]
  if (i.minAmount !== undefined && i.amount !== undefined && i.minAmount > i.amount)
    throw bad("minAmount cannot be more than amount.")
  return `upi://pay?${params
    .filter((p): p is [string, string] => p[1] !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&")}`
}
