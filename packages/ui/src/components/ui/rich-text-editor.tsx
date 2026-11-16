"use client"

// A rich text editor on Tiptap: bold, italic, inline code, links, headings,
// bulleted and numbered lists, code blocks and @mentions (Tiptap's suggestion
// API with the same search callback as `MentionTextarea`). The value is
// markdown, written by walking the editor's HTML through an allowlist, so
// nothing outside that list (scripts, handlers, styles, unsafe links) can get
// into it. Mentions are stored as `@[Name](user:<id>)`, the token signet-db's
// collab comments parse. `richTextToHtml` turns the markdown back into HTML
// that is safe by construction; on the server, run stored text through
// signet-server's `sanitizeMarkdown` before saving.
// Recipe: controllable-state + roving-focus (toolbar) + combobox (mention picker)
import Link from "@tiptap/extension-link"
import Mention from "@tiptap/extension-mention"
import { EditorContent, useEditor, useEditorState } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import type * as React from "react"
import { useEffect, useId, useMemo, useRef, useState } from "react"
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

/** The mention node, read from and written as the `span[data-mention]` richTextToHtml makes. */
const SignetMention = Mention.extend({
  parseHTML() {
    return [{ tag: "span[data-mention]" }]
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      id: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-user-id"),
        renderHTML: (a: Record<string, unknown>) => (a.id ? { "data-user-id": a.id } : {}),
      },
      label: {
        default: null,
        parseHTML: (el: HTMLElement) => (el.textContent ?? "").replace(/^@/, ""),
        renderHTML: () => ({}),
      },
    }
  },
})

type Suggestion = {
  items: RichTextPerson[]
  command: (person: { id: string; label: string }) => void
}

/** A Tiptap editor whose value is markdown. Parts carry `data-slot="rich-text-*"`. */
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
  const sent = useRef<string>(value ?? defaultValue)
  const [empty, setEmpty] = useState(!sent.current.trim())
  const [focusIndex, setFocusIndex] = useState(0)
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null)
  const [highlight, setHighlight] = useState(0)

  // The editor is built once; callbacks it calls read the latest props through refs.
  const live = useRef({ onValueChange, onMentionSearch, suggestion, highlight, formats })
  live.current = { onValueChange, onMentionSearch, suggestion, highlight, formats }
  const applyRef = useRef<(f: RichTextFormat) => void>(() => undefined)
  // Classes we added to the ProseMirror element, so a change removes only ours
  // and keeps the ProseMirror / tiptap / focus classes it manages itself.
  const appliedClasses = useRef<string[]>([])

  const editor = useEditor({
    editable: !disabled,
    content: richTextToHtml(sent.current),
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        blockquote: false,
        horizontalRule: false,
        strike: false,
        underline: false,
        link: false,
      }),
      Link.configure({
        openOnClick: false,
        autolink: false,
        protocols: ["mailto", "tel"],
        isAllowedUri: (url) => isSafeUrl(url),
        HTMLAttributes: { rel: "noopener noreferrer nofollow", target: null },
      }),
      SignetMention.configure({
        HTMLAttributes: { "data-mention": "", contenteditable: "false" },
        renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
        renderHTML: ({ options, node }) => [
          "span",
          options.HTMLAttributes,
          `@${node.attrs.label ?? node.attrs.id}`,
        ],
        suggestion: {
          char: "@",
          items: async ({ query }) => {
            const search = live.current.onMentionSearch
            if (!search) return []
            try {
              return await search(query)
            } catch {
              return []
            }
          },
          allow: () => !!live.current.onMentionSearch,
          render: () => ({
            onStart: (p) => {
              setSuggestion({ items: p.items as RichTextPerson[], command: p.command })
              setHighlight(0)
            },
            onUpdate: (p) => {
              setSuggestion({ items: p.items as RichTextPerson[], command: p.command })
              setHighlight(0)
            },
            onKeyDown: ({ event }) => {
              const s = live.current.suggestion
              if (!s) return false
              if (event.key === "Escape") {
                setSuggestion(null)
                return true
              }
              if (!s.items.length) return false
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                const step = event.key === "ArrowDown" ? 1 : -1
                setHighlight((i) => (i + step + s.items.length) % s.items.length)
                return true
              }
              if (event.key === "Enter" || event.key === "Tab") {
                const p = s.items[live.current.highlight] ?? s.items[0]
                if (p) s.command({ id: p.id, label: p.name.replace(/[[\]\n]/g, "") })
                return true
              }
              return false
            },
            onExit: () => setSuggestion(null),
          }),
        },
      }),
    ],
    editorProps: {
      attributes: {
        id: editorId,
        role: "textbox",
        "aria-multiline": "true",
        "data-slot": "rich-text-content",
      },
      // Pasted HTML goes through the same allowlist as the value.
      transformPastedHTML: (html) => richTextToHtml(htmlToRichText(html)),
      handleKeyDown: (_view, event) => {
        const f =
          (event.metaKey || event.ctrlKey) && !event.altKey
            ? SHORTCUTS[event.key.toLowerCase()]
            : undefined
        if (f !== "link" || !live.current.formats.includes("link")) return false
        event.preventDefault()
        applyRef.current("link")
        return true
      },
    },
    onUpdate: ({ editor: ed }) => {
      const md = htmlToRichText(ed.getHTML())
      setEmpty(ed.isEmpty)
      if (md === sent.current) return
      sent.current = md
      live.current.onValueChange?.(md)
    },
  })

  // The app changed the value: rewrite the document.
  useEffect(() => {
    if (!editor || value === undefined || value === sent.current) return
    sent.current = value
    editor.commands.setContent(richTextToHtml(value), { emitUpdate: false })
    setEmpty(editor.isEmpty)
  }, [editor, value])

  useEffect(() => {
    editor?.setEditable(!disabled)
  }, [editor, disabled])

  const active =
    useEditorState({
      editor,
      selector: ({ editor: ed }) => {
        const set = new Set<RichTextFormat>()
        if (!ed) return set
        if (ed.isActive("bold")) set.add("bold")
        if (ed.isActive("italic")) set.add("italic")
        if (ed.isActive("code")) set.add("code")
        if (ed.isActive("link")) set.add("link")
        if (ed.isActive("heading", { level: 1 }) || ed.isActive("heading", { level: 2 }))
          set.add("h2")
        if (ed.isActive("heading", { level: 3 })) set.add("h3")
        if (ed.isActive("bulletList")) set.add("ul")
        if (ed.isActive("orderedList")) set.add("ol")
        return set
      },
      equalityFn: (a, b) => !!a && !!b && a.size === b.size && [...a].every((f) => b.has(f)),
    }) ?? new Set<RichTextFormat>()

  const apply = async (f: RichTextFormat) => {
    if (!editor || disabled) return
    const chain = editor.chain().focus()
    if (f === "bold") chain.toggleBold().run()
    else if (f === "italic") chain.toggleItalic().run()
    else if (f === "code") chain.toggleCode().run()
    else if (f === "h2") chain.toggleHeading({ level: 2 }).run()
    else if (f === "h3") chain.toggleHeading({ level: 3 }).run()
    else if (f === "ul") chain.toggleBulletList().run()
    else if (f === "ol") chain.toggleOrderedList().run()
    else if (f === "link") {
      const current = (editor.getAttributes("link").href as string | undefined) ?? ""
      const ask = onRequestLink ?? ((cur: string) => window.prompt(labels.linkPrompt, cur))
      const url = (await ask(current))?.trim()
      if (url === undefined) return
      if (url === "") editor.chain().focus().extendMarkRange("link").unsetLink().run()
      else if (isSafeUrl(url)) {
        if (editor.state.selection.empty && !editor.isActive("link"))
          editor
            .chain()
            .focus()
            .insertContent({
              type: "text",
              text: url,
              marks: [{ type: "link", attrs: { href: url } }],
            })
            .run()
        else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run()
      }
    }
  }
  applyRef.current = (f) => void apply(f)

  // Attributes that follow React state, on the element Tiptap owns.
  const open = !!suggestion && !!onMentionSearch
  useEffect(() => {
    const dom = editor?.view.dom
    if (!dom) return
    const set = (k: string, v: string | undefined) =>
      v === undefined ? dom.removeAttribute(k) : dom.setAttribute(k, v)
    set("aria-label", aria["aria-label"])
    set("aria-labelledby", aria["aria-labelledby"])
    set("aria-describedby", aria["aria-describedby"])
    set("aria-placeholder", placeholder)
    set("aria-disabled", disabled ? "true" : undefined)
    set("aria-autocomplete", onMentionSearch ? "list" : undefined)
    set("aria-controls", open ? listId : undefined)
    set(
      "aria-activedescendant",
      open && suggestion?.items[highlight] ? `${listId}-${highlight}` : undefined,
    )
    set("data-placeholder", placeholder)
    set("data-empty", empty ? "true" : undefined)
    const next = cn(
      RICH_TEXT_CLASSES,
      "relative min-h-24 px-3 py-2 outline-none",
      "data-empty:before:pointer-events-none data-empty:before:absolute data-empty:before:text-text-muted data-empty:before:content-[attr(data-placeholder)]",
      classNames.content,
    )
      .split(/\s+/)
      .filter(Boolean)
    const stale = appliedClasses.current.filter((c) => !next.includes(c))
    if (stale.length) dom.classList.remove(...stale)
    dom.classList.add(...next)
    appliedClasses.current = next
  })

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
      <EditorContent editor={editor} className="relative" />
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
          {suggestion.items.length === 0 ? (
            <div className="px-2 py-1.5 text-sm text-text-muted">{labels.noMatches}</div>
          ) : (
            suggestion.items.map((p, i) => (
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
                  suggestion.command({ id: p.id, label: p.name.replace(/[[\]\n]/g, "") })
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
