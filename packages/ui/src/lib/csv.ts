/**
 * CSV and TSV, RFC 4180: quoted fields, `""` for a quote inside quotes, line
 * breaks inside quotes, CRLF, LF or CR line ends, and a leading BOM. Used by
 * `domain/csv-import` for files and by `components/data-grid` for pasted
 * ranges (TSV, which is what spreadsheets put on the clipboard).
 */

export type CsvOptions = {
  /** The field separator. Default: whichever of `,` `;` and tab is most common in the first line. */
  delimiter?: string
}

/** The separator `text`'s first line uses most, outside quotes. Ties go to the comma. */
export function detectDelimiter(text: string): string {
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 }
  let quoted = false
  for (const ch of text) {
    if (ch === '"') quoted = !quoted
    else if (!quoted && (ch === "\n" || ch === "\r")) break
    else if (!quoted && ch in counts) counts[ch] = (counts[ch] ?? 0) + 1
  }
  let best = ","
  for (const d of [";", "\t"]) if ((counts[d] ?? 0) > (counts[best] ?? 0)) best = d
  return best
}

/**
 * Rows of fields. A line with nothing on it is skipped, and a trailing line
 * break does not make an empty last row. Lenient where the RFC is strict: an
 * unclosed quote runs to the end of the text, and characters after a closing
 * quote are kept.
 */
export function parseCsv(text: string, options: CsvOptions = {}): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const delimiter = options.delimiter ?? detectDelimiter(src)
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false
  let touched = false // the row has a delimiter or a quote, so it is not blank
  const endField = () => {
    row.push(field)
    field = ""
  }
  const endRow = () => {
    endField()
    if (touched || row.length > 1 || row[0] !== "") rows.push(row)
    row = []
    touched = false
  }
  for (let i = 0; i < src.length; i++) {
    const ch = src[i] as string
    if (quoted) {
      if (ch !== '"') field += ch
      else if (src[i + 1] === '"') {
        field += '"'
        i++
      } else quoted = false
    } else if (ch === '"') {
      quoted = true
      touched = true
    } else if (src.startsWith(delimiter, i)) {
      endField()
      touched = true
      i += delimiter.length - 1
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && src[i + 1] === "\n") i++
      endRow()
    } else field += ch
  }
  if (field !== "" || row.length > 0 || touched) endRow()
  return rows
}

/** A field as CSV/TSV: quoted when it holds the delimiter, a quote or a line break. */
export function csvField(value: unknown, delimiter = ","): string {
  const s = value === null || value === undefined ? "" : String(value)
  return s.includes(delimiter) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Rows as CSV/TSV text, CRLF between rows as the RFC says. */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<unknown>>, delimiter = ","): string {
  return rows.map((r) => r.map((v) => csvField(v, delimiter)).join(delimiter)).join("\r\n")
}
