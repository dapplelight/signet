import { describe, expect, test } from "bun:test"
import {
  amountInWords,
  financialYear,
  formatInr,
  gstInvoice,
  gstinCheckChar,
  invoiceNumber,
  isHsnOrSac,
  isValidGstin,
  parseGstin,
  renderGstInvoiceHtml,
} from "../src/gst"
import { isVpa, upiIntent } from "../src/upi"

// Made-up GSTINs: PAN AAAAA0000A, check character computed, not issued to anyone.
const KA = "29AAAAA0000A1ZY"
const MH = "27AAAAA0000A1Z2"
const CH = "04AAAAA0000A1ZA"

describe("UPI intent", () => {
  test("NPCI parameters, encoded, amount in rupees", () => {
    const s = upiIntent({
      pa: "shop@okbank",
      pn: "Corner Shop & Co",
      amount: 12_345,
      note: "Order 42",
      tr: "ORD-42",
    })
    expect(s).toBe(
      "upi://pay?pa=shop%40okbank&pn=Corner%20Shop%20%26%20Co&tr=ORD-42&tn=Order%2042&am=123.45&cu=INR",
    )
    const u = new URL(s)
    expect(u.protocol).toBe("upi:")
    expect(u.searchParams.get("pn")).toBe("Corner Shop & Co")
    expect(upiIntent({ pa: "a.b@ybl", pn: "X", amount: 5 })).toContain("am=0.05")
    expect(upiIntent({ pa: "a.b@ybl", pn: "X" })).toBe("upi://pay?pa=a.b%40ybl&pn=X&cu=INR")
  })
  test("rejects what UPI apps would", () => {
    expect(isVpa("nope")).toBe(false)
    expect(() => upiIntent({ pa: "nope", pn: "X" })).toThrow(/UPI id/)
    expect(() => upiIntent({ pa: "ab@bank", pn: " " })).toThrow(/pn/)
    expect(() => upiIntent({ pa: "ab@bank", pn: "X", amount: 1.5 })).toThrow(/paise/)
    expect(() => upiIntent({ pa: "ab@bank", pn: "X", minAmount: 100 })).toThrow(/needs amount/)
    expect(() => upiIntent({ pa: "ab@bank", pn: "X", amount: 100, minAmount: 200 })).toThrow(
      /more than/,
    )
    expect(() => upiIntent({ pa: "ab@bank", pn: "X", mc: "12" })).toThrow(/mc/)
    expect(() => upiIntent({ pa: "ab@bank", pn: "X", url: "http://x" })).toThrow(/https/)
  })
})

describe("GST helpers", () => {
  test("GSTIN check character", () => {
    expect(gstinCheckChar("29AAAAA0000A1Z")).toBe("Y")
    expect(isValidGstin(KA)).toBe(true)
    expect(isValidGstin(KA.toLowerCase())).toBe(true)
    expect(isValidGstin("29AAAAA0000A1ZX")).toBe(false) // wrong check
    expect(isValidGstin("99AAAAA0000A1Z0")).toBe(false) // not a state
    expect(isValidGstin("29AAAAA0000A1Y0")).toBe(false) // 14th not Z
    expect(parseGstin(` ${MH.toLowerCase()} `)).toEqual({
      gstin: MH,
      stateCode: "27",
      pan: "AAAAA0000A",
    })
    expect(() => parseGstin("x")).toThrow(/not a valid GSTIN/)
  })
  test("HSN/SAC, financial year in IST, numbering", () => {
    expect(["9983", "998314", "84713010"].every(isHsnOrSac)).toBe(true)
    expect(["998", "99831", "abcd"].some(isHsnOrSac)).toBe(false)
    expect(financialYear(new Date("2027-03-31T18:29:59Z"))).toBe("2026-27") // 23:59:59 IST, 31 March
    expect(financialYear(new Date("2027-03-31T18:30:00Z"))).toBe("2027-28") // 00:00 IST, 1 April
    expect(financialYear(new Date("2099-12-01T00:00:00Z"))).toBe("2099-00")
    expect(invoiceNumber({ prefix: "INV", fy: "2026-27", seq: 7 })).toBe("INV/26-27/0007")
    expect(invoiceNumber({ fy: "2026-27", seq: 12345 })).toBe("26-27/12345")
    expect(() => invoiceNumber({ prefix: "TOOLONGPREFIX", fy: "2026-27", seq: 1 })).toThrow(/16/)
    expect(() => invoiceNumber({ fy: "26-27", seq: 1 })).toThrow(/fy/)
  })
  test("amounts in words and Indian grouping", () => {
    expect(amountInWords(0)).toBe("Rupees Zero Only")
    expect(amountInWords(125_050)).toBe(
      "Rupees One Thousand Two Hundred Fifty and Fifty Paise Only",
    )
    expect(amountInWords(1_23_45_678_99)).toBe(
      "Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight and Ninety Nine Paise Only",
    )
    expect(amountInWords(1_000_00_00_000_00)).toBe("Rupees One Thousand Crore Only")
    expect(formatInr(1_23_45_678_99)).toBe("1,23,45,678.99")
    expect(formatInr(99_901)).toBe("999.01")
  })
})

const base = {
  number: "INV/26-27/0001",
  date: new Date("2026-11-15T06:00:00Z"),
  supplier: { name: "Example Traders", address: "1 MG Road, Bengaluru", gstin: KA },
  lines: [
    { description: "Widget", hsn: "847130", quantity: 3, unit: "NOS", unitPrice: 33_333, rate: 18 },
    {
      description: "Setup",
      hsn: "998314",
      quantity: 1,
      unit: "OTH",
      unitPrice: 10_000,
      discount: 1_000,
      rate: 5,
    },
  ],
}

describe("GST invoice", () => {
  test("same state: CGST + SGST, split in half, rounded per line", () => {
    const inv = gstInvoice({
      ...base,
      recipient: {
        name: "Buyer Pvt Ltd",
        address: "Mysuru",
        gstin: `${KA.slice(0, 12)}2Z${gstinCheckChar(`${KA.slice(0, 12)}2Z`)}`,
      },
      placeOfSupply: "29",
    })
    expect(inv.taxType).toBe("intra")
    expect(inv.stateTax).toBe("SGST")
    expect(inv.financialYear).toBe("2026-27")
    // 99,999 paise × 9% = 8,999.91 → 9,000; 9,000 × 2.5% = 225
    expect(inv.lines.map((l) => [l.taxable, l.cgst, l.sgst, l.igst])).toEqual([
      [99_999, 9_000, 9_000, 0],
      [9_000, 225, 225, 0],
    ])
    expect(inv.totals).toEqual({
      taxable: 108_999,
      cgst: 9_225,
      sgst: 9_225,
      utgst: 0,
      igst: 0,
      total: 127_449,
    })
    expect(inv.totalInWords).toBe(
      "Rupees One Thousand Two Hundred Seventy Four and Forty Nine Paise Only",
    )
  })

  test("other state, and SEZ in the same state: IGST", () => {
    const inter = gstInvoice({
      ...base,
      recipient: { name: "B", address: "Pune", gstin: MH },
      placeOfSupply: "27",
    })
    expect(inter.taxType).toBe("inter")
    expect(inter.lines.map((l) => l.igst)).toEqual([18_000, 450])
    const sez = gstInvoice({
      ...base,
      recipient: { name: "S", address: "Bengaluru", sez: true, stateCode: "29" },
      placeOfSupply: "29",
    })
    expect(sez.taxType).toBe("inter")
  })

  test("union territory without a legislature: CGST + UTGST", () => {
    const inv = gstInvoice({
      ...base,
      supplier: { ...base.supplier, gstin: CH },
      recipient: { name: "C" },
      placeOfSupply: "04",
    })
    expect(inv.stateTax).toBe("UTGST")
    expect(inv.totals.utgst).toBe(9_225)
    expect(inv.totals.sgst).toBe(0)
  })

  test("refuses what rule 46 needs and what is unsupported", () => {
    const r = { name: "B" }
    expect(() =>
      gstInvoice({ ...base, recipient: r, placeOfSupply: "29", reverseCharge: true }),
    ).toThrow(/Reverse/)
    expect(() => gstInvoice({ ...base, recipient: r, placeOfSupply: "97" })).toThrow(
      /other territory/,
    )
    expect(() => gstInvoice({ ...base, recipient: r, placeOfSupply: "88" })).toThrow(
      /Unknown place/,
    )
    expect(() =>
      gstInvoice({ ...base, number: "INV/2026-27/00001", recipient: r, placeOfSupply: "29" }),
    ).toThrow(/46\(b\)/)
    expect(() =>
      gstInvoice({
        ...base,
        supplier: { ...base.supplier, gstin: "29AAAAA0000A1ZX" },
        recipient: r,
        placeOfSupply: "29",
      }),
    ).toThrow(/GSTIN/)
    expect(() =>
      gstInvoice({ ...base, recipient: { name: "B", gstin: MH }, placeOfSupply: "27" }),
    ).toThrow(/address/)
    expect(() =>
      gstInvoice({
        ...base,
        lines: [{ ...base.lines[0]!, hsn: "12" }],
        recipient: r,
        placeOfSupply: "29",
      }),
    ).toThrow(/HSN/)
    expect(() =>
      gstInvoice({
        ...base,
        lines: [{ ...base.lines[0]!, rate: 18.00001 }],
        recipient: r,
        placeOfSupply: "29",
      }),
    ).toThrow(/rate/)
    const big = [{ ...base.lines[0]!, quantity: 1, unitPrice: 50_000_00 }]
    expect(() => gstInvoice({ ...base, lines: big, recipient: r, placeOfSupply: "29" })).toThrow(
      /46\(e\)/,
    )
    expect(
      gstInvoice({
        ...base,
        lines: big,
        recipient: { name: "B", address: "X", stateCode: "29" },
        placeOfSupply: "29",
      }).totals.taxable,
    ).toBe(50_000_00)
  })

  test("HTML has the rule 46 fields and escapes input", () => {
    const html = renderGstInvoiceHtml(
      gstInvoice({
        ...base,
        recipient: { name: "<script>x</script>", address: "Pune", gstin: MH },
        placeOfSupply: "27",
        shipTo: "Warehouse 2, Nashik",
      }),
    )
    for (const s of [
      "Tax Invoice",
      KA,
      MH,
      "INV/26-27/0001",
      "15-11-2026",
      "Maharashtra (27)",
      "847130",
      "IGST",
      "reverse charge: No",
      "Authorised Signatory",
      "Warehouse 2",
      "Rupees",
    ])
      expect(html).toContain(s)
    expect(html).not.toContain("<script>x")
    expect(html).not.toContain("CGST")
  })
})
