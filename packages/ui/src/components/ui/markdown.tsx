/**
 * Safe Markdown: GitHub-flavoured (tables, task lists, strikethrough), with
 * heading anchors and a table of contents. For text the app did not write —
 * a scraped job description, an LLM answer, a README.
 *
 * Safe by construction, not by sanitizing HTML afterwards:
 *   - raw HTML in the source is dropped, never rendered (`skipHtml`);
 *   - link and image URLs pass react-markdown's allowlist (http, https,
 *     mailto, tel, relative); `javascript:` and `data:` become empty;
 *   - external links open in a new tab with rel="noopener noreferrer nofollow";
 *   - remote images are off by default (a tracking pixel in a scraped page is
 *     a read receipt): they render as their alt text until `images` allows them.
 *
 * Needs `react-markdown`, `remark-gfm`, `remark-parse`, `unified` and
 * `github-slugger` (optional peers).
 */

import GithubSlugger from "github-slugger"
import type { Heading, Nodes, Root } from "mdast"
import type * as React from "react"
import { useMemo } from "react"
import ReactMarkdown, { type Components, defaultUrlTransform } from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkParse from "remark-parse"
import { unified } from "unified"

import { cn } from "../../lib/utils.js"

export type TocEntry = { id: string; text: string; depth: number }

function textOf(node: Nodes): string {
  if ("value" in node && typeof node.value === "string") return node.value
  if ("children" in node) return (node.children as Nodes[]).map(textOf).join("")
  return ""
}

/**
 * Every heading in document order with its id. One slugger per document, so
 * repeated titles get "-1", "-2" — the same ids the rendered headings carry.
 */
function eachHeading(
  tree: Root,
  prefix: string,
  fn: (h: Heading, id: string, text: string) => void,
) {
  const slugger = new GithubSlugger()
  const walk = (node: Nodes) => {
    if (node.type === "heading") {
      const text = textOf(node).trim()
      fn(node, `${prefix}${slugger.slug(text)}`, text)
      return
    }
    if ("children" in node) for (const c of node.children as Nodes[]) walk(c)
  }
  walk(tree)
}

function remarkHeadingIds(options: { prefix: string }) {
  return (tree: Root) => {
    eachHeading(tree, options.prefix, (h, id) => {
      h.data = { ...h.data, hProperties: { ...(h.data?.hProperties ?? {}), id } }
    })
  }
}

const parser = unified().use(remarkParse).use(remarkGfm)

/** The headings of a Markdown document, for a table of contents. */
export function markdownToc(
  markdown: string,
  { maxDepth = 3, idPrefix = "" }: { maxDepth?: number; idPrefix?: string } = {},
): TocEntry[] {
  const entries: TocEntry[] = []
  eachHeading(parser.parse(markdown) as Root, idPrefix, (h, id, text) => {
    if (h.depth <= maxDepth && text) entries.push({ id, text, depth: h.depth })
  })
  return entries
}

const isExternal = (href: string) => /^https?:\/\//i.test(href)

export type MarkdownProps = {
  children: string
  className?: string
  /**
   * Prefix for heading ids, when more than one document is on the page (the
   * same prefix goes to MarkdownToc). Default none.
   */
  idPrefix?: string
  /**
   * Show images. false (default): alt text instead, nothing is fetched.
   * true: any allowed URL. A function: decide per URL, e.g. same-origin only.
   */
  images?: boolean | ((src: string) => boolean)
  /** A "#" link beside each heading, for copying a deep link. Default true. */
  headingAnchors?: boolean
}

const H_CLASS: Record<number, string> = {
  1: "text-title font-semibold tracking-tight mt-6 mb-3",
  2: "text-subhead font-semibold tracking-tight mt-6 mb-2",
  3: "text-callout font-semibold mt-5 mb-2",
  4: "text-body font-semibold mt-4 mb-1",
  5: "text-body font-medium mt-3 mb-1",
  6: "text-caption font-medium uppercase tracking-wider text-text-muted mt-3 mb-1",
}

type HastLike = { type?: string; value?: string; children?: HastLike[] }
const hastText = (n: HastLike | undefined): string =>
  !n ? "" : typeof n.value === "string" ? n.value : (n.children ?? []).map(hastText).join("")

function heading(depth: 1 | 2 | 3 | 4 | 5 | 6, anchors: boolean): Components["h1"] {
  const Tag = `h${depth}` as const
  return function MarkdownHeading({ node, id, children, ...rest }) {
    const h = (
      <Tag id={id} className={cn("scroll-mt-20 text-text-primary", H_CLASS[depth])} {...rest}>
        {children}
      </Tag>
    )
    if (!anchors || !id) return h
    // The # link sits beside the heading, not inside it, so the heading's
    // accessible name stays its text; the link has a name of its own.
    return (
      <div className="group flex items-baseline gap-2">
        {h}
        <a
          href={`#${id}`}
          data-slot="markdown-anchor"
          aria-label={`Link to ${hastText(node as HastLike).trim() || "this section"}`}
          className="text-text-muted no-underline opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        >
          #
        </a>
      </div>
    )
  }
}

export function Markdown({
  children,
  className,
  idPrefix = "",
  images = false,
  headingAnchors = true,
}: MarkdownProps) {
  const remarkPlugins = useMemo(
    () => [remarkGfm, [remarkHeadingIds, { prefix: idPrefix }] as const],
    [idPrefix],
  )
  const components = useMemo<Components>(
    () => ({
      h1: heading(1, headingAnchors),
      h2: heading(2, headingAnchors),
      h3: heading(3, headingAnchors),
      h4: heading(4, headingAnchors),
      h5: heading(5, headingAnchors),
      h6: heading(6, headingAnchors),
      p: ({ node: _n, ...p }) => <p className="my-3 leading-relaxed" {...p} />,
      a: ({ node: _n, href = "", children, ...p }) =>
        href === "" ? (
          <span>{children}</span> // a stripped (unsafe) URL: keep the text, drop the link
        ) : (
          <a
            href={href}
            className="text-primary underline underline-offset-2 hover:opacity-80"
            {...(isExternal(href) ? { target: "_blank", rel: "noopener noreferrer nofollow" } : {})}
            {...p}
          >
            {children}
          </a>
        ),
      img: ({ node: _n, src, alt }) => {
        const url = typeof src === "string" ? src : ""
        const allowed = url !== "" && (typeof images === "function" ? images(url) : images)
        if (!allowed)
          return (
            <span data-slot="markdown-image-blocked" className="text-text-muted">
              {alt ? `[${alt}]` : "[image]"}
            </span>
          )
        return (
          <img src={url} alt={alt ?? ""} loading="lazy" className="my-3 max-w-full rounded-lg" />
        )
      },
      ul: ({ node: _n, className: c, ...p }) => (
        <ul
          className={cn(
            "my-3 list-disc pl-6 [&.contains-task-list]:list-none [&.contains-task-list]:pl-0",
            c,
          )}
          {...p}
        />
      ),
      ol: ({ node: _n, ...p }) => <ol className="my-3 list-decimal pl-6" {...p} />,
      li: ({ node: _n, ...p }) => <li className="my-1" {...p} />,
      blockquote: ({ node: _n, ...p }) => (
        <blockquote
          className="my-3 border-l-2 border-border-default pl-4 text-text-secondary"
          {...p}
        />
      ),
      code: ({ node: _n, className: c, ...p }) => (
        <code
          className={cn("rounded bg-bg-elevated px-1 py-0.5 font-mono text-[0.9em]", c)}
          {...p}
        />
      ),
      pre: ({ node: _n, ...p }) => (
        <pre
          className="my-3 overflow-x-auto rounded-lg bg-bg-elevated p-3 text-[13px] [&_code]:bg-transparent [&_code]:p-0"
          {...p}
        />
      ),
      hr: () => <hr className="my-6 border-border-subtle" />,
      table: ({ node: _n, ...p }) => (
        <div className="my-3 overflow-x-auto">
          <table className="w-full border-collapse text-[13px]" {...p} />
        </div>
      ),
      th: ({ node: _n, ...p }) => (
        <th className="border-b border-border-default px-3 py-1.5 text-left font-medium" {...p} />
      ),
      td: ({ node: _n, ...p }) => (
        <td className="border-b border-border-subtle px-3 py-1.5" {...p} />
      ),
    }),
    [headingAnchors, images],
  )

  return (
    <div data-slot="markdown" className={cn("min-w-0 text-body text-text-primary", className)}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins as never}
        components={components}
        skipHtml
        urlTransform={(url) => defaultUrlTransform(url)}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}

/** A table of contents for the same Markdown: links to the heading ids `Markdown` renders. */
export function MarkdownToc({
  markdown,
  maxDepth = 3,
  idPrefix = "",
  title = "On this page",
  activeId,
  className,
}: {
  markdown: string
  maxDepth?: number
  idPrefix?: string
  title?: string
  /** The section to mark current (aria-current), e.g. from scroll position. */
  activeId?: string
  className?: string
}) {
  const entries = useMemo(
    () => markdownToc(markdown, { maxDepth, idPrefix }),
    [markdown, maxDepth, idPrefix],
  )
  if (entries.length === 0) return null
  const top = Math.min(...entries.map((e) => e.depth))
  return (
    <nav aria-label={title} data-slot="markdown-toc" className={cn("text-[13px]", className)}>
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-text-muted">
        {title}
      </p>
      <ol className="flex flex-col gap-1">
        {entries.map((e) => (
          <li
            key={e.id}
            style={{ paddingLeft: `${(e.depth - top) * 12}px` } as React.CSSProperties}
          >
            <a
              href={`#${e.id}`}
              aria-current={e.id === activeId ? "location" : undefined}
              className="text-text-secondary hover:text-text-primary aria-[current=location]:font-medium aria-[current=location]:text-text-primary"
            >
              {e.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}
