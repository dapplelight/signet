/**
 * GST tax invoices for India, as HTML (print it, or turn it into a PDF
 * yourself): GSTIN validation with its check character, CGST + SGST (or
 * UTGST) for a supply within one state or union territory and IGST across
 * them, HSN/SAC codes, invoice numbers per financial year and the amount in
 * words. The fields follow rule 46 of the CGST Rules, 2017.
 *
 * ```ts
 * const inv = gstInvoice({ number, date, supplier, recipient, placeOfSupply: "29", lines })
 * inv.totals            // { taxable, cgst, sgst, utgst, igst, total } in paise
 * renderGstInvoiceHtml(inv)
 * ```
 *
 * Where the supply takes place (sections 10 to 13 of the IGST Act) is your
 * call: pass `placeOfSupply` as a state code. A supply to an SEZ unit or
 * developer (`recipient.sez`) is always IGST.
 *
 * Not supported, and refused rather than guessed: reverse charge, exports
 * and other zero-rated supplies, cess, place of supply "97" (other
 * territory), e-invoicing (IRN and its signed QR), the B2C dynamic QR, the
 * HSN digit count your turnover requires (4, 6 and 8 digits are all accepted),
 * credit and debit notes, and digital signatures.
 */

import { PaymentsError } from "./errors.js"

const bad = (msg: string) => new PaymentsError("BAD_INPUT", msg)
const unsupported = (msg: string) => new PaymentsError("UNSUPPORTED", msg)

/** GST state codes. `ut`: a union territory without its own legislature, which levies UTGST instead of SGST. */
export const GST_STATES: Readonly<Record<string, { name: string; ut?: true }>> = {
  "01": { name: "Jammu and Kashmir" },
  "02": { name: "Himachal Pradesh" },
  "03": { name: "Punjab" },
  "04": { name: "Chandigarh", ut: true },
  "05": { name: "Uttarakhand" },
  "06": { name: "Haryana" },
  "07": { name: "Delhi" },
  "08": { name: "Rajasthan" },
  "09": { name: "Uttar Pradesh" },
  "10": { name: "Bihar" },
  "11": { name: "Sikkim" },
  "12": { name: "Arunachal Pradesh" },
  "13": { name: "Nagaland" },
  "14": { name: "Manipur" },
  "15": { name: "Mizoram" },
  "16": { name: "Tripura" },
  "17": { name: "Meghalaya" },
  "18": { name: "Assam" },
  "19": { name: "West Bengal" },
  "20": { name: "Jharkhand" },
  "21": { name: "Odisha" },
  "22": { name: "Chhattisgarh" },
  "23": { name: "Madhya Pradesh" },
  "24": { name: "Gujarat" },
  "26": { name: "Dadra and Nagar Haveli and Daman and Diu", ut: true },
  "27": { name: "Maharashtra" },
  "29": { name: "Karnataka" },
  "30": { name: "Goa" },
  "31": { name: "Lakshadweep", ut: true },
  "32": { name: "Kerala" },
  "33": { name: "Tamil Nadu" },
  "34": { name: "Puducherry" },
  "35": { name: "Andaman and Nicobar Islands", ut: true },
  "36": { name: "Telangana" },
  "37": { name: "Andhra Pradesh" },
  "38": { name: "Ladakh", ut: true },
}

// ------------------------------------------------------------------ GSTIN

const BASE36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"

/** The 15th character of a GSTIN, from its first 14 (weights 1, 2, 1, 2... in base 36). */
export function gstinCheckChar(first14: string): string {
  let sum = 0
  for (let i = 0; i < 14; i++) {
    const v = BASE36.indexOf(first14[i] as string)
    if (v < 0) throw bad(`"${first14}" has a character a GSTIN cannot.`)
    const p = v * (i % 2 === 0 ? 1 : 2)
    sum += Math.floor(p / 36) + (p % 36)
  }
  return BASE36[(36 - (sum % 36)) % 36] as string
}

/**
 * A regular taxpayer's GSTIN: state code, PAN, entity number, "Z", check
 * character. TDS/TCS, non-resident and UN-body formats are not accepted.
 */
export function isValidGstin(gstin: string): boolean {
  const g = String(gstin ?? "").toUpperCase()
  return (
    /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g) &&
    g.slice(0, 2) in GST_STATES &&
    gstinCheckChar(g.slice(0, 14)) === g[14]
  )
}

/** The state code and PAN inside a valid GSTIN. Throws BAD_INPUT otherwise. */
export function parseGstin(gstin: string): { gstin: string; stateCode: string; pan: string } {
  const g = String(gstin ?? "")
    .trim()
    .toUpperCase()
  if (!isValidGstin(g)) throw bad(`"${gstin}" is not a valid GSTIN.`)
  return { gstin: g, stateCode: g.slice(0, 2), pan: g.slice(2, 12) }
}

/** An HSN (goods) or SAC (services, starting 99) code: 4, 6 or 8 digits. */
export const isHsnOrSac = (code: string): boolean => /^(\d{4}|\d{6}|\d{8})$/.test(code)

// ------------------------------------------------- numbering and dates

/** The Indian financial year (1 April to 31 March, IST) of a date, e.g. "2026-27". */
export function financialYear(date: Date): string {
  const ist = new Date(date.getTime() + 330 * 60_000)
  const y = ist.getUTCFullYear()
  const start = ist.getUTCMonth() >= 3 ? y : y - 1
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`
}

/** Rule 46(b): at most 16 characters of letters, digits, "-" and "/". */
export const isValidInvoiceNumber = (n: string): boolean => /^[A-Za-z0-9/-]{1,16}$/.test(n)

/**
 * `INV/26-27/0001`: a series prefix, the financial year and a sequence that
 * restarts each year. Get `seq` from a counter keyed by series and year
 * (signet-db's `nextSequence(db, table, \`invoice:INV:2026-27\`)`).
 */
export function invoiceNumber(opts: {
  prefix?: string
  fy: string
  seq: number
  pad?: number
}): string {
  if (!/^\d{4}-\d{2}$/.test(opts.fy)) throw bad(`fy is like "2026-27", got "${opts.fy}".`)
  if (!Number.isSafeInteger(opts.seq) || opts.seq < 1) throw bad("seq is a whole number from 1.")
  const n = `${opts.prefix ? `${opts.prefix}/` : ""}${opts.fy.slice(2)}/${String(opts.seq).padStart(opts.pad ?? 4, "0")}`
  if (!isValidInvoiceNumber(n))
    throw bad(
      `"${n}" breaks rule 46(b): at most 16 letters, digits, "-" or "/". Shorten the prefix.`,
    )
  return n
}

// --------------------------------------------------------- amount in words

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
]
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]

const upTo99 = (n: number) =>
  n < 20 ? (ONES[n] as string) : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`

/** A whole number in words with the Indian system (thousand, lakh, crore). */
export function numberInWords(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) throw bad("numberInWords takes a whole number from 0.")
  if (n === 0) return "Zero"
  const parts: string[] = []
  const crore = Math.floor(n / 10_000_000)
  if (crore) parts.push(`${numberInWords(crore)} Crore`)
  const lakh = Math.floor((n % 10_000_000) / 100_000)
  if (lakh) parts.push(`${upTo99(lakh)} Lakh`)
  const thousand = Math.floor((n % 100_000) / 1000)
  if (thousand) parts.push(`${upTo99(thousand)} Thousand`)
  const hundred = Math.floor((n % 1000) / 100)
  if (hundred) parts.push(`${ONES[hundred]} Hundred`)
  if (n % 100) parts.push(upTo99(n % 100))
  return parts.join(" ")
}

/** Paise in words: `amountInWords(125050)` is "Rupees One Thousand Two Hundred Fifty and Fifty Paise Only". */
export function amountInWords(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise < 0)
    throw bad("amountInWords takes whole paise from 0.")
  const r = Math.floor(paise / 100)
  const p = paise % 100
  return `Rupees ${numberInWords(r)}${p ? ` and ${numberInWords(p)} Paise` : ""} Only`
}

// ------------------------------------------------------------- invoice

export type GstParty = {
  name: string
  address?: string
  /** Required for the supplier; for a registered recipient. */
  gstin?: string
  /** The party's state code; taken from the GSTIN when there is one. */
  stateCode?: string
  /** Recipient only: an SEZ unit or developer. Makes the supply IGST. */
  sez?: boolean
}

export type GstLine = {
  description: string
  /** HSN for goods, SAC for services. */
  hsn: string
  quantity: number
  /** Unit quantity code, e.g. "NOS", "KGS", "OTH". */
  unit: string
  /** Paise per unit, before tax. */
  unitPrice: number
  /** Paise off this line, before tax. */
  discount?: number
  /** GST rate in percent, e.g. 18. Split in half for CGST and SGST/UTGST. */
  rate: number
}

export type GstInvoiceInput = {
  /** From `invoiceNumber`, unique within the financial year. */
  number: string
  date: Date
  supplier: GstParty
  recipient: GstParty
  /** State code of the place of supply. */
  placeOfSupply: string
  lines: GstLine[]
  /** Delivery address, when not the place of supply (rule 46(n)). */
  shipTo?: string
  /** Must be false or absent: reverse-charge invoices are not supported. */
  reverseCharge?: boolean
  notes?: string
}

export type GstTaxType = "intra" | "inter"

export type GstInvoiceLine = GstLine & {
  taxable: number
  cgst: number
  sgst: number
  utgst: number
  igst: number
  total: number
}

export type GstInvoice = Omit<GstInvoiceInput, "lines"> & {
  supplier: GstParty & { gstin: string; stateCode: string }
  recipient: GstParty & { stateCode?: string }
  /** intra: CGST + SGST (or UTGST); inter: IGST. */
  taxType: GstTaxType
  /** The second half of an intra-state split: "SGST", or "UTGST" in a union territory without a legislature. */
  stateTax: "SGST" | "UTGST"
  financialYear: string
  lines: GstInvoiceLine[]
  totals: {
    taxable: number
    cgst: number
    sgst: number
    utgst: number
    igst: number
    total: number
  }
  totalInWords: string
}

/** Rule 46(e): an unregistered recipient's address and state are required from this taxable value. */
export const UNREGISTERED_ADDRESS_FROM = 50_000_00

/** round(value × rate%) to the paisa, half up, exactly: rate in millionths of a unit. */
const taxOn = (value: number, ratePpm: number) =>
  Number((BigInt(value) * BigInt(ratePpm) * 2n + 1_000_000n) / 2_000_000n)

const ppm = (rate: number) => {
  const r = Math.round(rate * 10_000)
  if (!(rate >= 0 && rate <= 100) || Math.abs(r - rate * 10_000) > 1e-6 || r % 2)
    throw bad(`GST rate ${rate} is not a percent with up to 3 decimals that splits in half.`)
  return r
}

/** Check an invoice against rule 46 and work out every tax amount. Throws BAD_INPUT or UNSUPPORTED. */
export function gstInvoice(input: GstInvoiceInput): GstInvoice {
  if (input.reverseCharge) throw unsupported("Reverse-charge invoices are not supported.")
  if (!isValidInvoiceNumber(input.number))
    throw bad(
      `Invoice number "${input.number}" breaks rule 46(b): at most 16 letters, digits, "-" or "/".`,
    )
  if (!(input.date instanceof Date) || Number.isNaN(input.date.getTime()))
    throw bad("date is a Date.")
  const s = input.supplier
  if (!s?.name?.trim() || !s.address?.trim())
    throw bad("The supplier's name and address are required.")
  if (!s.gstin) throw bad("The supplier's GSTIN is required.")
  const sup = parseGstin(s.gstin)
  const r = input.recipient
  if (!r?.name?.trim()) throw bad("The recipient's name is required.")
  const rec = r.gstin ? parseGstin(r.gstin) : undefined
  if (rec && !r.address?.trim()) throw bad("A registered recipient's address is required.")
  const recState = rec?.stateCode ?? r.stateCode
  if (recState !== undefined && !(recState in GST_STATES))
    throw bad(`Unknown state code "${recState}".`)

  const pos = input.placeOfSupply
  if (pos === "97") throw unsupported('Place of supply "97" (other territory) is not supported.')
  if (!(pos in GST_STATES)) throw bad(`Unknown place of supply "${pos}"; pass a GST state code.`)
  const taxType: GstTaxType = r.sez || pos !== sup.stateCode ? "inter" : "intra"
  const stateTax = GST_STATES[pos]?.ut ? "UTGST" : "SGST"
  if (!input.lines?.length) throw bad("An invoice needs at least one line.")

  const lines = input.lines.map((l, i): GstInvoiceLine => {
    const at = `Line ${i + 1}`
    if (!l.description?.trim()) throw bad(`${at}: description is required.`)
    if (!isHsnOrSac(l.hsn)) throw bad(`${at}: HSN/SAC "${l.hsn}" is not 4, 6 or 8 digits.`)
    if (!(l.quantity > 0) || !Number.isFinite(l.quantity))
      throw bad(`${at}: quantity must be positive.`)
    if (!l.unit?.trim()) throw bad(`${at}: unit is required (e.g. NOS).`)
    if (!Number.isSafeInteger(l.unitPrice) || l.unitPrice < 0)
      throw bad(`${at}: unitPrice is whole paise.`)
    const discount = l.discount ?? 0
    if (!Number.isSafeInteger(discount) || discount < 0)
      throw bad(`${at}: discount is whole paise.`)
    const taxable = Math.round(l.quantity * l.unitPrice) - discount
    if (taxable < 0) throw bad(`${at}: the discount is more than the line.`)
    const rate = ppm(l.rate)
    const half = taxOn(taxable, rate / 2)
    const tax =
      taxType === "inter"
        ? { cgst: 0, sgst: 0, utgst: 0, igst: taxOn(taxable, rate) }
        : {
            cgst: half,
            sgst: stateTax === "SGST" ? half : 0,
            utgst: stateTax === "UTGST" ? half : 0,
            igst: 0,
          }
    return {
      ...l,
      discount,
      taxable,
      ...tax,
      total: taxable + tax.cgst + tax.sgst + tax.utgst + tax.igst,
    }
  })
  const sum = (
    k: keyof Pick<GstInvoiceLine, "taxable" | "cgst" | "sgst" | "utgst" | "igst" | "total">,
  ) => lines.reduce((a, l) => a + l[k], 0)
  const totals = {
    taxable: sum("taxable"),
    cgst: sum("cgst"),
    sgst: sum("sgst"),
    utgst: sum("utgst"),
    igst: sum("igst"),
    total: sum("total"),
  }
  if (!rec && totals.taxable >= UNREGISTERED_ADDRESS_FROM && (!r.address?.trim() || !recState))
    throw bad(
      "Rule 46(e): from Rs 50,000 an unregistered recipient's address and state code are required.",
    )

  return {
    ...input,
    supplier: { ...s, gstin: sup.gstin, stateCode: sup.stateCode },
    recipient: { ...r, ...(rec ? { gstin: rec.gstin } : {}), stateCode: recState },
    taxType,
    stateTax,
    financialYear: financialYear(input.date),
    lines,
    totals,
    totalInWords: amountInWords(totals.total),
  }
}

// ------------------------------------------------------------------ HTML

const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  )

/** Paise as "1,23,456.78" (Indian digit grouping). */
export function formatInr(paise: number): string {
  const neg = paise < 0
  const a = Math.abs(paise)
  const r = String(Math.floor(a / 100))
  const grouped =
    r.length > 3 ? `${r.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${r.slice(-3)}` : r
  return `${neg ? "-" : ""}${grouped}.${String(a % 100).padStart(2, "0")}`
}

const pct = (rate: number) => `${+rate.toFixed(4)}%`
const state = (code?: string) => (code ? `${esc(GST_STATES[code]?.name)} (${esc(code)})` : "")
const fmtDate = (d: Date) => {
  const ist = new Date(d.getTime() + 330 * 60_000)
  return `${String(ist.getUTCDate()).padStart(2, "0")}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}-${ist.getUTCFullYear()}`
}

/** A complete, self-contained HTML page for a `gstInvoice(...)` result. Every value is escaped. */
export function renderGstInvoiceHtml(inv: GstInvoice): string {
  const intra = inv.taxType === "intra"
  const st = inv.stateTax
  const taxHead = intra
    ? `<th>CGST rate</th><th>CGST</th><th>${st} rate</th><th>${st}</th>`
    : "<th>IGST rate</th><th>IGST</th>"
  const rows = inv.lines
    .map((l, i) => {
      const tax = intra
        ? `<td>${pct(l.rate / 2)}</td><td>${formatInr(l.cgst)}</td><td>${pct(l.rate / 2)}</td><td>${formatInr(l.sgst + l.utgst)}</td>`
        : `<td>${pct(l.rate)}</td><td>${formatInr(l.igst)}</td>`
      return `<tr><td>${i + 1}</td><td class="l">${esc(l.description)}</td><td>${esc(l.hsn)}</td><td>${esc(l.quantity)}</td><td>${esc(l.unit)}</td><td>${formatInr(l.unitPrice)}</td><td>${formatInr(l.discount ?? 0)}</td><td>${formatInr(l.taxable)}</td>${tax}<td>${formatInr(l.total)}</td></tr>`
    })
    .join("\n")
  const t = inv.totals
  const taxFoot = intra
    ? `<td></td><td>${formatInr(t.cgst)}</td><td></td><td>${formatInr(t.sgst + t.utgst)}</td>`
    : `<td></td><td>${formatInr(t.igst)}</td>`
  const party = (p: GstParty & { stateCode?: string }) =>
    `<strong>${esc(p.name)}</strong><br>${esc(p.address).replace(/\n/g, "<br>")}${p.gstin ? `<br>GSTIN: ${esc(p.gstin)}` : ""}${p.stateCode ? `<br>State: ${state(p.stateCode)}` : ""}${p.sez ? "<br>SEZ unit/developer" : ""}`
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Tax Invoice ${esc(inv.number)}</title>
<style>
body{font:13px/1.4 system-ui,sans-serif;color:#111;margin:24px}
h1{font-size:20px;margin:0 0 12px}
table{border-collapse:collapse;width:100%;margin:12px 0}
th,td{border:1px solid #999;padding:4px 6px;text-align:right;vertical-align:top}
th{background:#f2f2f2}.l{text-align:left}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.sign{margin-top:48px;text-align:right}
</style></head><body>
<h1>Tax Invoice</h1>
<div class="grid">
<div><div>Supplier</div>${party(inv.supplier)}</div>
<div>Invoice no: <strong>${esc(inv.number)}</strong><br>Date: ${fmtDate(inv.date)}<br>Place of supply: ${state(inv.placeOfSupply)}<br>Tax payable on reverse charge: No</div>
<div><div>Recipient</div>${party(inv.recipient)}</div>
${inv.shipTo ? `<div><div>Delivery address</div>${esc(inv.shipTo).replace(/\n/g, "<br>")}</div>` : ""}
</div>
<table>
<thead><tr><th>#</th><th class="l">Description</th><th>HSN/SAC</th><th>Qty</th><th>Unit</th><th>Rate</th><th>Discount</th><th>Taxable value</th>${taxHead}<th>Total</th></tr></thead>
<tbody>
${rows}
</tbody>
<tfoot><tr><th colspan="7" class="l">Total</th><td>${formatInr(t.taxable)}</td>${taxFoot}<td><strong>${formatInr(t.total)}</strong></td></tr></tfoot>
</table>
<p>Invoice total (in words): <strong>${esc(inv.totalInWords)}</strong></p>
${inv.notes ? `<p>${esc(inv.notes)}</p>` : ""}
<div class="sign">For ${esc(inv.supplier.name)}<br><br><br>Authorised Signatory</div>
</body></html>
`
}
