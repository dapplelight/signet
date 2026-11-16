/**
 * Server-side cleaning for rich text stored as markdown (signet-ui's
 * `RichTextEditor` value, comment bodies, notes). Run it on the request body
 * before saving: the editor's own output is already clean, but anything can
 * POST to your route, and stored markdown may later go through a renderer
 * that passes raw HTML through (many do).
 *
 * `sanitizeMarkdown`:
 * - escapes raw HTML (`<script>`, `<img onerror>`, `<a href>`, comments,
 *   `<javascript:...>` autolinks) outside code, so it shows as text;
 * - rewrites link and image targets that are not http(s), mailto, tel or
 *   relative to `#`, after decoding entities and dropping the whitespace and
 *   control characters browsers ignore (`jav&#x61;script:`, `java\tscript:`);
 * - keeps signet-db mention tokens (`@[Name](user:<id>)`);
 * - removes control characters and bidirectional overrides;
 * - leaves code spans and fenced code blocks as written.
 */

const SAFE_SCHEMES = new Set(["http", "https", "mailto", "tel"])
// Must match signet-db's MENTION_PATTERN.
const MENTION = /^@\[[^\]\n]{1,100}\]\(user:[A-Za-z0-9_.:-]{1,80}\)/
const NAMED: Record<string, string> = {
  colon: ":",
  tab: "\t",
  newline: "\n",
  lpar: "(",
  rpar: ")",
  sol: "/",
  period: ".",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1))
      return Number.isFinite(n) && n <= 0x10ffff ? String.fromCodePoint(n) : ""
    }
    return NAMED[e.toLowerCase()] ?? m
  })
}

/**
 * Whether a link target is safe: no scheme (relative, `#`, `/path`), or
 * http(s), mailto or tel. A colon before any `/`, `?` or `#` is a scheme.
 */
export function isSafeLinkTarget(url: string): boolean {
  let bare = decodeEntities(url)
  try {
    bare = decodeURIComponent(bare)
  } catch {
    // not valid percent-encoding: check it as written
  }
  // Browsers drop whitespace and control characters inside a scheme.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
  bare = bare.replace(/[\u0000- \u007f-\u009f]/g, "")
  const colon = bare.indexOf(":")
  if (colon < 0) return true
  const cut = bare.search(/[/?#]/)
  if (cut >= 0 && cut < colon) return true
  return SAFE_SCHEMES.has(bare.slice(0, colon).toLowerCase())
}

/** Escape raw HTML and fix link targets in a run of markdown that is not code. */
function cleanText(s: string): string {
  let out = ""
  let i = 0
  while (i < s.length) {
    const ch = s[i] as string
    if (ch === "\\") {
      out += s.slice(i, i + 2)
      i += 2
      continue
    }
    if (ch === "<") {
      out += "\\<"
      i++
      continue
    }
    if (ch === "@") {
      const m = MENTION.exec(s.slice(i))
      if (m) {
        out += m[0]
        i += m[0].length
        continue
      }
    }
    if (ch === "]" && s[i + 1] === "(") {
      // Inline link or image target: up to whitespace or the unbalanced `)`.
      let j = i + 2
      while (s[j] === " " || s[j] === "\t" || s[j] === "\n") j++
      const start = j
      let depth = 0
      for (; j < s.length; j++) {
        const c = s[j] as string
        if (c === "\\") j++
        else if (c === "(") depth++
        else if (c === ")") {
          if (depth === 0) break
          depth--
        } else if (/\s/.test(c)) break
      }
      // A lenient renderer may join the parts split by whitespace ("java\tscript:"),
      // so the target is judged up to the title or the closing paren.
      let k = j
      for (let d = depth; k < s.length && s[k] !== '"' && s[k] !== "'"; k++) {
        if (s[k] === "(") d++
        else if (s[k] === ")" && d-- === 0) break
      }
      if (!isSafeLinkTarget(s.slice(start, k).replace(/^\\?</, ""))) {
        out += `${s.slice(i, start)}#${s.slice(j, k).match(/\s*$/)?.[0] ?? ""}`
        i = k
        continue
      }
      const target = s.slice(start, j)
      out += `${s.slice(i, start)}${target.replace(/\\[\s\S]|</g, (m) => (m === "<" ? "\\<" : m))}`
      i = j
      continue
    }
    out += ch
    i++
  }
  // Reference definitions: `[label]: target`.
  return out.replace(/^( {0,3}\[[^\]\n]+\]:[ \t]*)(\S+)/gm, (m, head: string, target: string) =>
    isSafeLinkTarget(target.replace(/^\\?<|>$/g, "")) ? m : `${head}#`,
  )
}

/** Text outside fenced code: code spans stay as written, the rest is cleaned. */
function cleanProse(text: string): string {
  let rest = text
  let cleaned = ""
  for (;;) {
    const open = /(?<!\\)(`+)/.exec(rest)
    if (!open) break
    const fence = open[1] as string
    const close = rest.indexOf(fence, open.index + fence.length)
    if (close < 0) break
    cleaned += cleanText(rest.slice(0, open.index)) + rest.slice(open.index, close + fence.length)
    rest = rest.slice(close + fence.length)
  }
  return cleaned + cleanText(rest)
}

/** Clean markdown for storage. Idempotent: running it twice changes nothing more. */
export function sanitizeMarkdown(markdown: string): string {
  const text = String(markdown ?? "")
    .replace(/\r\n?/g, "\n")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: removing control characters is the point
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g, "")
  const out: string[] = []
  let prose: string[] = []
  const flush = () => {
    if (prose.length) out.push(cleanProse(prose.join("\n")))
    prose = []
  }
  let fence: string | null = null
  for (const line of text.split("\n")) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (fence) {
      out.push(line)
      const mark = f?.[1]
      if (
        mark &&
        mark[0] === fence[0] &&
        mark.length >= fence.length &&
        !line.slice(f[0].length).trim()
      )
        fence = null
    } else if (f) {
      flush()
      fence = f[1] as string
      out.push(line)
    } else prose.push(line)
  }
  flush()
  return out.join("\n")
}
