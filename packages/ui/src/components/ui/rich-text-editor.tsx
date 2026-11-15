"use client"

// A small rich text editor on contenteditable, with no editor library: bold,
// italic, inline code, links, headings, bulleted and numbered lists, code
// blocks and @mentions. The value is markdown, written by walking the DOM
// through an allowlist, so nothing outside that list (scripts, handlers,
// styles, unsafe links) can get into it. Mentions are stored as
// `@[Name](user:<id>)`, the token signet-db's collab comments parse, and the
// picker takes the same search callback as `MentionTextarea`.
// `richTextToHtml` turns the markdown back into HTML that is safe by
// construction; on the server, run stored text through signet-server's
// `sanitizeMarkdown` before saving.
// Recipe: controllable-state + roving-focus (toolbar) + combobox (mention picker)
import type * as React from "react"
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react"
import { cn } from "../../lib/utils.js"

// ------------------------------------------------------------------ markdown

// Must match signet-db's MENTION_PATTERN.
const MENTION = /@\[([^\]\n]{1,100})\]\(user:([A-Za-z0-9_.:-]{1,80})\)/y
const SAFE_SCHEMES = new Set(["http", "https", "mailto", "tel"])

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  )

/** Whether a link target is safe to put in `href`: http(s), mailto, tel, or a relative URL. */
export function isSafeUrl(url: string): boolean {
  let bare = url
  try {
    bare = decodeURIComponent(bare)
  } catch {
    // not valid percent-encoding: check it as written
  }
  // Browsers drop whitespace and control characters inside a scheme ("java\tscript:").
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
  bare = bare.replace(/[\u0000-\u0020\u007f-\u009f]/g, "")
  // A colon before any `/`, `?` or `#` is a scheme (signet-server's isSafeLinkTarget, same rule).
  const colon = bare.indexOf(":")
  const cut = bare.search(/[/?#]/)
  if (colon < 0 || (cut >= 0 && cut < colon)) return true
  return SAFE_SCHEMES.has(bare.slice(0, colon).toLowerCase())
}

const PUNCT = /[!-/:-@[-`{-~]/

/** Inline markdown to HTML: escapes, code spans, mentions, links, `**bold**`, `_italic_` / `*italic*`. */
function inlineHtml(src: string): string {
  const out: string[] = []
  const open: { marker: string; at: number }[] = []
  let text = ""
  const flush = () => {
    if (text) out.push(escapeHtml(text))
    text = ""
  }
  let i = 0
  while (i < src.length) {
    const ch = src[i] as string
    if (ch === "\\" && PUNCT.test(src[i + 1] ?? "")) {
      text += src[i + 1]
      i += 2
      continue
    }
    if (ch === "\n") {
      flush()
      out.push("<br>")
      i++
      continue
    }
    if (ch === "`") {
      let n = 1
      while (src[i + n] === "`") n++
      const fence = "`".repeat(n)
      const close = src.indexOf(fence, i + n)
      if (close > 0) {
        flush()
        out.push(`<code>${escapeHtml(src.slice(i + n, close))}</code>`)
        i = close + n
        continue
      }
      text += fence
      i += n
      continue
    }
    if (ch === "@" && src[i + 1] === "[") {
      MENTION.lastIndex = i
      const m = MENTION.exec(src)
      if (m) {
        flush()
        out.push(
          `<span data-mention="" data-user-id="${escapeHtml(m[2] as string)}" contenteditable="false">@${escapeHtml(m[1] as string)}</span>`,
        )
        i += m[0].length
        continue
      }
    }
    if (ch === "[") {
      // [text](url): text may hold escapes and formatting; the url has no spaces or parens.
      let j = i + 1
      while (j < src.length && src[j] !== "]" && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1
      const m = src[j] === "]" ? /^\(([^()\s]*)\)/.exec(src.slice(j + 1)) : null
      if (m) {
        flush()
        const label = inlineHtml(src.slice(i + 1, j))
        const url = m[1] as string
        out.push(
          isSafeUrl(url)
            ? `<a href="${escapeHtml(url)}" rel="noopener noreferrer nofollow">${label}</a>`
            : label,
        )
        i = j + 1 + m[0].length
        continue
      }
    }
    const marker = src.startsWith("**", i) ? "**" : ch === "_" || ch === "*" ? ch : ""
    if (marker) {
      flush()
      const k = open.findIndex((o) => o.marker === marker)
      if (k === open.length - 1 && k >= 0) {
        open.pop()
        out.push(marker === "**" ? "</strong>" : "</em>")
      } else if (k < 0) {
        open.push({ marker, at: out.length })
        out.push(marker === "**" ? "<strong>" : "<em>")
      } else out.push(escapeHtml(marker)) // would misnest: keep it as text
      i += marker.length
      continue
    }
    text += ch
    i++
  }
  flush()
  // An opener that never closed was text after all.
  for (const o of open) out[o.at] = escapeHtml(o.marker)
  return out.join("")
}

const LIST_ITEM = /^( *)([-*+]|\d{1,9}[.)]) +(.*)$/
const FENCE = /^(`{3,})[^`]*$/
const HEADING = /^(#{1,6}) +(.*)$/

/**
 * The editor's markdown as HTML. Safe by construction: every character of
 * text is escaped and the only tags are the ones it writes (`p`, `h1`-`h3`,
 * `ul`, `ol`, `li`, `pre`, `code`, `strong`, `em`, `a`, `br`, a mention
 * `span`). Links keep only http(s), mailto, tel and relative targets.
 */
export function richTextToHtml(markdown: string): string {
  const lines = String(markdown ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
  const out: string[] = []
  let i = 0
  const startsBlock = (l: string) => FENCE.test(l) || HEADING.test(l) || LIST_ITEM.test(l)
  while (i < lines.length) {
    const line = lines[i] as string
    if (!line.trim()) {
      i++
      continue
    }
    const fence = FENCE.exec(line)
    if (fence) {
      const body: string[] = []
      i++
      while (i < lines.length && (lines[i] as string).trim() !== fence[1])
        body.push(lines[i++] as string)
      i++
      out.push(`<pre><code>${escapeHtml(body.join("\n"))}</code></pre>`)
      continue
    }
    const h = HEADING.exec(line)
    if (h) {
      const n = Math.min((h[1] as string).length, 3)
      out.push(`<h${n}>${inlineHtml(h[2] as string)}</h${n}>`)
      i++
      continue
    }
    if (LIST_ITEM.test(line)) {
      const stack: string[] = []
      let html = ""
      while (i < lines.length) {
        const m = LIST_ITEM.exec(lines[i] as string)
        if (!m) break
        const type = /\d/.test(m[2] as string) ? "ol" : "ul"
        const level = Math.min(Math.floor((m[1] as string).length / 2), stack.length)
        while (stack.length > level + 1) html += `</li></${stack.pop()}>`
        if (stack.length === level + 1) {
          if (stack[level] === type) html += "</li><li>"
          else {
            html += `</li></${stack.pop()}><${type}><li>`
            stack.push(type)
          }
        } else {
          html += `<${type}><li>`
          stack.push(type)
        }
        html += inlineHtml(m[3] as string)
        i++
      }
      while (stack.length) html += `</li></${stack.pop()}>`
      out.push(html)
      continue
    }
    const para: string[] = []
    while (
      i < lines.length &&
      (lines[i] as string).trim() &&
      !(para.length && startsBlock(lines[i] as string))
    )
      para.push(lines[i++] as string)
    out.push(`<p>${inlineHtml(para.join("\n"))}</p>`)
  }
  return out.join("")
}

/** Text escaped so the markdown reader shows it as typed. */
const escapeText = (s: string) => s.replace(/[\\`*_[\]<>]/g, "\\$&")

/** A line that would start a block (heading, list, fence) gets its marker escaped. */
const escapeLineStart = (line: string) =>
  line.replace(/^(\s*)([#+-])(?=\s|#|$)/, "$1\\$2").replace(/^(\s*\d{1,9})([.)])(?=\s)/, "$1\\$2")

const DROP = new Set([
  "SCRIPT",
  "STYLE",
  "TEMPLATE",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "SVG",
  "MATH",
  "NOSCRIPT",
  "HEAD",
  "TITLE",
  "META",
  "LINK",
  "BUTTON",
  "INPUT",
  "SELECT",
  "TEXTAREA",
])
const BLOCKS = new Set([
  "P",
  "DIV",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "UL",
  "OL",
  "LI",
  "PRE",
  "BLOCKQUOTE",
  "SECTION",
  "ARTICLE",
  "HEADER",
  "FOOTER",
  "MAIN",
  "TABLE",
  "TR",
  "BODY",
])

/** Wrap `inner` in `mark`, keeping its outer spaces outside so the markers hug the text. */
function wrap(inner: string, mark: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner) as RegExpExecArray
  return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : inner
}

function codeSpan(text: string): string {
  if (!text) return ""
  const runs = text.match(/`+/g) ?? []
  const fence = "`".repeat(Math.max(0, ...runs.map((r) => r.length)) + 1)
  return `${fence}${text}${fence}`
}

function inlineMd(node: Node): string {
  if (node.nodeType === 3) return escapeText((node.nodeValue ?? "").replace(/ /g, " "))
  if (node.nodeType !== 1) return ""
  const el = node as Element
  const tag = el.tagName.toUpperCase()
  if (DROP.has(tag)) return ""
  if (tag === "BR") return "\n"
  if (el.hasAttribute("data-mention")) {
    const id = el.getAttribute("data-user-id") ?? ""
    const name = (el.textContent ?? "")
      .replace(/^@/, "")
      .replace(/[[\]\n]/g, "")
      .slice(0, 100)
    return /^[A-Za-z0-9_.:-]{1,80}$/.test(id) ? `@[${name || id}](user:${id})` : escapeText(name)
  }
  const inner = () => [...el.childNodes].map(inlineMd).join("")
  switch (tag) {
    case "B":
    case "STRONG":
      return wrap(inner(), "**")
    case "I":
    case "EM":
      return wrap(inner(), "_")
    case "CODE":
    case "KBD":
    case "SAMP":
      return codeSpan(el.textContent ?? "")
    case "A": {
      const href = (el.getAttribute("href") ?? "").trim()
      const text = inner()
      if (!href || !isSafeUrl(href) || !text.trim()) return text
      return `[${text}](${href.replace(/[\s()<>]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`)})`
    }
    default:
      return inner()
  }
}

/** Markdown blocks for `el`'s children. */
function blocksMd(el: Element, out: string[]) {
  let para = ""
  const flushPara = () => {
    const text = para.replace(/^\n+|\n+$/g, "")
    if (text.trim())
      out.push(
        text
          .split("\n")
          .map((l) => escapeLineStart(l.trimEnd()))
          .join("\n"),
      )
    para = ""
  }
  for (const child of [...el.childNodes]) {
    const tag = child.nodeType === 1 ? (child as Element).tagName.toUpperCase() : ""
    if (!BLOCKS.has(tag) || DROP.has(tag)) {
      para += inlineMd(child)
      continue
    }
    flushPara()
    const c = child as Element
    if (/^H[1-6]$/.test(tag)) {
      const text = inlineMd(c).replace(/\n+/g, " ").trim()
      if (text) out.push(`${"#".repeat(Math.min(Number(tag[1]), 3))} ${text}`)
    } else if (tag === "UL" || tag === "OL") {
      const lines: string[] = []
      listMd(c, 0, lines)
      if (lines.length) out.push(lines.join("\n"))
    } else if (tag === "PRE") {
      const text = (c.textContent ?? "").replace(/\n$/, "")
      const runs = text.match(/^`{3,}/gm) ?? []
      const fence = "`".repeat(Math.max(2, ...runs.map((r) => r.length)) + 1)
      out.push(`${fence}\n${text}\n${fence}`)
    } else blocksMd(c, out)
  }
  flushPara()
}

function listMd(list: Element, depth: number, lines: string[]) {
  const ordered = list.tagName.toUpperCase() === "OL"
  let n = 0
  for (const li of [...list.children]) {
    if (li.tagName.toUpperCase() !== "LI") {
      if (/^(UL|OL)$/i.test(li.tagName)) listMd(li, depth + 1, lines)
      continue
    }
    n++
    const nested: Element[] = []
    const text = [...li.childNodes]
      .map((c) => {
        if (c.nodeType === 1 && /^(UL|OL)$/i.test((c as Element).tagName)) {
          nested.push(c as Element)
          return ""
        }
        if (c.nodeType === 1 && BLOCKS.has((c as Element).tagName.toUpperCase()))
          return ` ${inlineMd(c)} `
        return inlineMd(c)
      })
      .join("")
      .replace(/\s*\n\s*/g, " ")
      .trim()
    lines.push(`${"  ".repeat(depth)}${ordered ? `${n}.` : "-"} ${text}`)
    for (const l of nested) listMd(l, depth + 1, lines)
  }
}

/** The editor's DOM (or any element) as markdown, keeping only what the editor supports. */
export function elementToRichText(el: Element): string {
  const out: string[] = []
  blocksMd(el, out)
  return out.join("\n\n")
}

/**
 * HTML from anywhere (a paste, an import) as the editor's markdown. Parsed in
 * an inert document, so nothing in it runs or loads.
 */
export function htmlToRichText(html: string): string {
  const doc = new DOMParser().parseFromString(String(html ?? ""), "text/html")
  return elementToRichText(doc.body)
}

// ------------------------------------------------------------------ styles

/** Classes for rendered rich text, shared by the editor and `RichTextContent`. */
export const RICH_TEXT_CLASSES = cn(
  "text-sm text-text-primary break-words",
  "[&_p]:my-2 [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-semibold",
  "[&_h2]:mt-3 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-base [&_h3]:font-semibold",
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_code]:rounded [&_code]:bg-bg-elevated [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.9em]",
  "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-bg-elevated [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
  "[&_[data-mention]]:rounded [&_[data-mention]]:bg-accent-blue-subtle [&_[data-mention]]:px-1 [&_[data-mention]]:font-medium [&_[data-mention]]:text-accent-blue",
)

/** Stored rich text (the editor's markdown), rendered. */
export function RichTextContent({
  value,
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "children" | "dangerouslySetInnerHTML"> & { value: string }) {
  const html = useMemo(() => richTextToHtml(value), [value])
  return (
    <div
      data-slot="rich-text-content"
      className={cn(RICH_TEXT_CLASSES, className)}
      dangerouslySetInnerHTML={{ __html: html }}
      {...props}
    />
  )
}

// ------------------------------------------------------------------ editor

/** Who can be mentioned; signet-db's `Person` and the collab screens' `CollabPerson` fit. */
export type RichTextPerson = { id: string; name: string; email?: string | null }

export type RichTextFormat = "bold" | "italic" | "code" | "link" | "h2" | "h3" | "ul" | "ol"

export const DEFAULT_RICH_TEXT_LABELS = {
  toolbar: "Formatting",
  bold: "Bold",
  italic: "Italic",
  code: "Code",
  link: "Link",
  h2: "Heading",
  h3: "Subheading",
  ul: "Bulleted list",
  ol: "Numbered list",
  linkPrompt: "Link address",
  mentionList: "People to mention",
  noMatches: "No one matches",
}
export type RichTextLabels = typeof DEFAULT_RICH_TEXT_LABELS

type Part = "root" | "toolbar" | "button" | "content" | "mentions" | "option"

export type RichTextEditorProps = {
  /** Markdown. Controlled with `onValueChange`; the editor rewrites itself only when this differs from what it last sent. */
  value?: string
  defaultValue?: string
  onValueChange?: (markdown: string) => void
  /** Org members matching `query` (`GET /mentions?q=`). Leave out to turn mentions off. */
  onMentionSearch?: (query: string) => Promise<RichTextPerson[]> | RichTextPerson[]
  /** Ask for a link address. Default: `window.prompt`. Unsafe addresses are ignored. */
  onRequestLink?: (current: string) => Promise<string | null> | string | null
  /** Toolbar buttons, in order. Default: all. */
  formats?: readonly RichTextFormat[]
  placeholder?: string
  disabled?: boolean
  "aria-label"?: string
  "aria-labelledby"?: string
  "aria-describedby"?: string
  labels?: Partial<RichTextLabels>
  /** Replace a toolbar button's content (an icon, say); the label stays its accessible name. */
  icons?: Partial<Record<RichTextFormat, React.ReactNode>>
  className?: string
  classNames?: Partial<Record<Part, string>>
  id?: string
}

const ALL_FORMATS: RichTextFormat[] = ["bold", "italic", "code", "link", "h2", "h3", "ul", "ol"]
const DEFAULT_ICONS: Record<RichTextFormat, React.ReactNode> = {
  bold: <b>B</b>,
  italic: <i>I</i>,
  code: <code className="font-mono">{"</>"}</code>,
  link: <span className="underline">Link</span>,
  h2: "H2",
  h3: "H3",
  ul: "• List",
  ol: "1. List",
}
const SHORTCUTS: Record<string, RichTextFormat> = { b: "bold", i: "italic", e: "code", k: "link" }

/** Which formats the selection is inside, from the DOM up to the editor root. */
function activeFormats(root: HTMLElement): Set<RichTextFormat> {
  const set = new Set<RichTextFormat>()
  let n: Node | null = document.getSelection()?.anchorNode ?? null
  if (!n || !root.contains(n)) return set
  for (; n && n !== root; n = n.parentNode) {
    const tag = n.nodeType === 1 ? (n as Element).tagName : ""
    if (tag === "B" || tag === "STRONG") set.add("bold")
    else if (tag === "I" || tag === "EM") set.add("italic")
    else if (tag === "CODE") set.add("code")
    else if (tag === "A") set.add("link")
    else if (tag === "H1" || tag === "H2") set.add("h2")
    else if (tag === "H3") set.add("h3")
    else if (tag === "UL") set.add("ul")
    else if (tag === "OL") set.add("ol")
  }
  return set
}

const exec = (command: string, arg?: string) =>
  typeof document.execCommand === "function" && document.execCommand(command, false, arg)

/** Insert safe HTML at the selection: execCommand where the browser has it, a Range otherwise. */
function insertHtml(root: HTMLElement, html: string) {
  if (exec("insertHTML", html)) return
  const sel = document.getSelection()
  const range =
    sel?.rangeCount && root.contains(sel.getRangeAt(0).startContainer) ? sel.getRangeAt(0) : null
  const t = document.createElement("template")
  t.innerHTML = html
  const frag = t.content
  const last = frag.lastChild
  if (!range) {
    root.append(frag)
    return
  }
  range.deleteContents()
  range.insertNode(frag)
  if (last) {
    range.setStartAfter(last)
    range.collapse(true)
    sel?.removeAllRanges()
    sel?.addRange(range)
  }
}

/** A contenteditable editor whose value is markdown. Parts carry `data-slot="rich-text-*"`. */
export function RichTextEditor({
  value,
  defaultValue = "",
  onValueChange,
  onMentionSearch,
  onRequestLink,
  formats = ALL_FORMATS,
  placeholder,
  disabled = false,
  labels: labelsProp,
  icons = {},
  className,
  classNames = {},
  id,
  ...aria
}: RichTextEditorProps) {
  const labels = useMemo(() => ({ ...DEFAULT_RICH_TEXT_LABELS, ...labelsProp }), [labelsProp])
  const uid = useId()
  const editorId = id ?? `${uid}-editor`
  const listId = `${uid}-mentions`
  const ref = useRef<HTMLDivElement>(null)
  const sent = useRef<string | null>(null)
  const [empty, setEmpty] = useState(!(value ?? defaultValue))
  const [active, setActive] = useState<Set<RichTextFormat>>(new Set())
  const [query, setQuery] = useState<{ node: Text; start: number; text: string } | null>(null)
  const [options, setOptions] = useState<RichTextPerson[]>([])
  const [highlight, setHighlight] = useState(0)
  const [focusIndex, setFocusIndex] = useState(0)

  // Write the DOM from the value on mount and whenever the app changes it.
  const current = value ?? (sent.current === null ? defaultValue : null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || current === null || current === sent.current) return
    el.innerHTML = richTextToHtml(current)
    sent.current = current
    setEmpty(!current.trim())
  }, [current])

  const emit = useCallback(() => {
    const el = ref.current
    if (!el) return
    const md = elementToRichText(el)
    setEmpty(!md.trim() && !el.querySelector("li,pre"))
    if (md === sent.current) return
    sent.current = md
    onValueChange?.(md)
  }, [onValueChange])

  useEffect(() => {
    const update = () => ref.current && setActive(activeFormats(ref.current))
    document.addEventListener("selectionchange", update)
    return () => document.removeEventListener("selectionchange", update)
  }, [])

  useEffect(() => {
    if (!query || !onMentionSearch) return
    let live = true
    Promise.resolve(onMentionSearch(query.text)).then(
      (people) => {
        if (!live) return
        setOptions(people)
        setHighlight(0)
      },
      () => live && setOptions([]),
    )
    return () => {
      live = false
    }
  }, [query, onMentionSearch])

  /** Look for `@query` right before the caret. */
  const findQuery = () => {
    if (!onMentionSearch) return
    const sel = document.getSelection()
    const node = sel?.anchorNode
    if (!sel?.isCollapsed || !node || node.nodeType !== 3 || !ref.current?.contains(node)) {
      setQuery(null)
      return
    }
    const before = (node.nodeValue ?? "").slice(0, sel.anchorOffset)
    const m = /(^|\s)@([^\s@]{0,30})$/.exec(before)
    setQuery(
      m
        ? {
            node: node as Text,
            start: sel.anchorOffset - (m[2]?.length ?? 0) - 1,
            text: m[2] ?? "",
          }
        : null,
    )
  }

  const choose = (p: RichTextPerson) => {
    const el = ref.current
    if (!query || !el) return
    const sel = document.getSelection()
    const range = document.createRange()
    const end =
      sel?.anchorNode === query.node ? sel.anchorOffset : query.start + query.text.length + 1
    range.setStart(query.node, query.start)
    range.setEnd(query.node, Math.min(end, query.node.length))
    sel?.removeAllRanges()
    sel?.addRange(range)
    const name = p.name.replace(/[[\]\n]/g, "")
    insertHtml(
      el,
      `<span data-mention="" data-user-id="${escapeHtml(p.id)}" contenteditable="false">@${escapeHtml(name)}</span>&nbsp;`,
    )
    setQuery(null)
    emit()
  }

  const toggleCode = () => {
    const el = ref.current
    const sel = document.getSelection()
    if (!el || !sel?.rangeCount) return
    const range = sel.getRangeAt(0)
    if (!el.contains(range.commonAncestorContainer)) return
    let n: Node | null = range.commonAncestorContainer
    for (; n && n !== el; n = n.parentNode) {
      if (n.nodeType === 1 && (n as Element).tagName === "CODE") {
        const code = n as Element
        code.replaceWith(...code.childNodes)
        return
      }
    }
    if (range.collapsed) return
    const code = document.createElement("code")
    code.textContent = range.toString()
    range.deleteContents()
    range.insertNode(code)
  }

  const apply = async (f: RichTextFormat) => {
    const el = ref.current
    if (!el || disabled) return
    el.focus()
    if (f === "bold" || f === "italic") exec(f)
    else if (f === "ul") exec("insertUnorderedList")
    else if (f === "ol") exec("insertOrderedList")
    else if (f === "h2" || f === "h3")
      exec("formatBlock", activeFormats(el).has(f) ? "<p>" : `<${f}>`)
    else if (f === "code") toggleCode()
    else if (f === "link") {
      const sel = document.getSelection()
      const saved = sel?.rangeCount ? sel.getRangeAt(0).cloneRange() : null
      const ask = onRequestLink ?? ((cur: string) => window.prompt(labels.linkPrompt, cur))
      const url = (await ask(""))?.trim()
      if (saved) {
        sel?.removeAllRanges()
        sel?.addRange(saved)
      }
      if (!url) {
        if (url === "" && activeFormats(el).has("link")) exec("unlink")
      } else if (isSafeUrl(url)) {
        if (saved && !saved.collapsed) exec("createLink", url)
        else insertHtml(el, `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`)
      }
    }
    emit()
    setActive(activeFormats(el))
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const open = !!query && !!onMentionSearch
    if (open && options.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault()
        const step = e.key === "ArrowDown" ? 1 : -1
        setHighlight((i) => (i + step + options.length) % options.length)
        return
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault()
        choose(options[highlight] as RichTextPerson)
        return
      }
    }
    if (open && e.key === "Escape") {
      e.preventDefault()
      setQuery(null)
      return
    }
    const f = (e.metaKey || e.ctrlKey) && !e.altKey ? SHORTCUTS[e.key.toLowerCase()] : undefined
    if (f && formats.includes(f)) {
      e.preventDefault()
      void apply(f)
    }
  }

  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const el = ref.current
    if (!el) return
    e.preventDefault()
    const html = e.clipboardData?.getData("text/html")
    const text = e.clipboardData?.getData("text/plain") ?? ""
    if (html) insertHtml(el, richTextToHtml(htmlToRichText(html)))
    else if (!exec("insertText", text)) insertHtml(el, escapeHtml(text).replace(/\r?\n/g, "<br>"))
    emit()
  }

  // Toolbar: one tab stop, arrows move between buttons (WAI-ARIA toolbar).
  const onToolbarKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step =
      e.key === "ArrowRight"
        ? 1
        : e.key === "ArrowLeft"
          ? -1
          : e.key === "Home"
            ? -999
            : e.key === "End"
              ? 999
              : 0
    if (!step) return
    e.preventDefault()
    const next = Math.max(0, Math.min(formats.length - 1, focusIndex + step))
    setFocusIndex(next)
    e.currentTarget.querySelectorAll<HTMLButtonElement>("button")[next]?.focus()
  }

  const open = !!query && !!onMentionSearch
  return (
    <div
      data-slot="rich-text-editor"
      data-disabled={disabled || undefined}
      className={cn(
        "relative flex flex-col rounded-lg border border-border-default bg-bg-surface focus-within:border-ring data-disabled:opacity-60",
        classNames.root,
        className,
      )}
    >
      <div
        role="toolbar"
        aria-label={labels.toolbar}
        aria-controls={editorId}
        data-slot="rich-text-toolbar"
        onKeyDown={onToolbarKeyDown}
        className={cn(
          "flex flex-wrap gap-0.5 border-b border-border-default p-1",
          classNames.toolbar,
        )}
      >
        {formats.map((f, i) => {
          const pressed = active.has(f)
          return (
            <button
              key={f}
              type="button"
              aria-label={labels[f]}
              aria-pressed={f === "link" ? undefined : pressed}
              title={labels[f]}
              tabIndex={i === focusIndex ? 0 : -1}
              disabled={disabled}
              data-slot="rich-text-button"
              data-format={f}
              data-active={pressed || undefined}
              onMouseDown={(e) => e.preventDefault()} // keep the editor's selection
              onClick={() => {
                setFocusIndex(i)
                void apply(f)
              }}
              className={cn(
                "inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-xs text-text-secondary outline-none",
                "hover:bg-bg-elevated hover:text-text-primary focus-visible:ring-2 focus-visible:ring-ring",
                "data-active:bg-bg-elevated data-active:text-text-primary",
                classNames.button,
              )}
            >
              {icons[f] ?? DEFAULT_ICONS[f]}
            </button>
          )
        })}
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: a rich text field is a contenteditable textbox; textarea cannot hold formatting */}
      <div
        ref={ref}
        id={editorId}
        role="textbox"
        tabIndex={disabled ? -1 : 0}
        aria-multiline="true"
        aria-disabled={disabled || undefined}
        aria-autocomplete={onMentionSearch ? "list" : undefined}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && options[highlight] ? `${listId}-${highlight}` : undefined}
        aria-placeholder={placeholder}
        {...aria}
        contentEditable={!disabled}
        suppressContentEditableWarning
        data-slot="rich-text-content"
        data-placeholder={placeholder}
        data-empty={empty || undefined}
        onInput={() => {
          emit()
          findQuery()
        }}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => {
          if (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End") findQuery()
        }}
        onFocus={() => exec("defaultParagraphSeparator", "p")}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
        onPaste={onPaste}
        className={cn(
          RICH_TEXT_CLASSES,
          "relative min-h-24 px-3 py-2 outline-none",
          "data-empty:before:pointer-events-none data-empty:before:absolute data-empty:before:text-text-muted data-empty:before:content-[attr(data-placeholder)]",
          classNames.content,
        )}
      />
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label={labels.mentionList}
          data-slot="rich-text-mentions"
          className={cn(
            "absolute top-full left-2 z-50 mt-1 max-h-56 w-64 overflow-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-border-default",
            classNames.mentions,
          )}
        >
          {options.length === 0 ? (
            <div className="px-2 py-1.5 text-sm text-text-muted">{labels.noMatches}</div>
          ) : (
            options.map((p, i) => (
              // biome-ignore lint/a11y/useFocusableInteractive: combobox pattern, focus stays in the editor and aria-activedescendant points here
              <div
                key={p.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === highlight}
                data-slot="rich-text-option"
                data-highlighted={i === highlight ? "" : undefined}
                onMouseDown={(e) => {
                  e.preventDefault()
                  choose(p)
                }}
                className={cn(
                  "flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm data-highlighted:bg-bg-elevated",
                  classNames.option,
                )}
              >
                <span className="truncate">{p.name}</span>
                {p.email && <span className="truncate text-xs text-text-muted">{p.email}</span>}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
