---
name: Signet docs
description: The docs site and landing page for Signet, in the shadcn/ui and Vercel docs register.
colors:
  page: "#ffffff"
  page-dark: "#0a0a0a"
  ink: "#0a0a0a"
  ink-dark: "#fafafa"
  muted-ink: "#737373"
  muted-ink-dark: "#a3a3a3"
  hairline: "#e5e5e5"
  hairline-dark: "#262626"
  wash: "#f5f5f5"
  wash-dark: "#171717"
typography:
  display:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.5rem, 6.2vw, 4.5rem)"
    fontWeight: 600
    lineHeight: 1.02
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    letterSpacing: "-0.025em"
  lead:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 400
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    lineHeight: 1.75
  label:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
  code:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "0.875rem"
rounded:
  control: "8px"
  panel: "12px"
spacing:
  gutter: "20px"
  gutter-md: "24px"
  section: "80px"
  section-md: "96px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.page}"
    rounded: "{rounded.control}"
    height: "36px"
    padding: "0 16px"
  button-outline:
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "36px"
    padding: "0 16px"
  command-panel:
    backgroundColor: "{colors.page}"
    rounded: "{rounded.panel}"
    typography: "{typography.code}"
  code-title-bar:
    backgroundColor: "{colors.wash}"
    typography: "{typography.code}"
---

# Design System: Signet docs

## Overview

The category standard, played straight: the docs and landing page sit beside ui.shadcn.com and Vercel's docs and are held to their craft. Pure white (near-black in dark), neutral greys, 1px hairlines, Geist. The page shows the product itself: live `signet-ui` components, real commands, real code. No thematic worlds, metaphors or ornament; no gradient glow; no uniform bento of boxes; short text.

Two token sets coexist: the site chrome reads Fumadocs' `--color-fd-*` variables (set in `app/global.css`), and live previews read Signet's own editorial theme tokens, so a preview looks like a real Signet app inside the neutral site.

## Colors

Restrained and neutral. Colour on the page comes only from the live components (Signet's editorial theme); the chrome itself is greyscale.

- **Page / Page dark** (`#ffffff` / `#0a0a0a`): the one surface. Cards, sidebar and top bar share it.
- **Ink / Ink dark** (`#0a0a0a` / `#fafafa`): headings, body, the primary button fill.
- **Muted ink** (`#737373` / `#a3a3a3`): sublines, descriptions, secondary links.
- **Hairline** (`#e5e5e5` / `#262626`): every border and section rule.
- **Wash** (`#f5f5f5` / `#171717`): code title bars and hover fills.

Live previews keep Signet's editorial theme, so their card fill is a warm grey (olive in dark) against the cool-neutral chrome. That contrast is deliberate: the previews are a real Signet app, not restyled to match the site.

**The One Surface Rule.** Containers separate by a 1px hairline, never by a different background or a shadow.

## Typography

Geist sans for everything, Geist Mono for commands and code (never as decoration). Display is semibold with tight tracking (-0.035em), section headings -0.025em; body 16px at 1.75 in prose. Headings use `text-balance`, paragraphs `text-pretty`.

**The Statement Rule.** Section headings are plain sentences that state a fact ("One line turns your routes into MCP tools."), with no label above them.

## Layout

Content sits in a `max-w-6xl` container with 20px (24px from md) gutters. The landing page is left-aligned throughout. Sections are separated by a full-width hairline with 64px above the heading and 80-96px between sections. Lists that carry many facts use hairline-ruled rows in two columns (one on phones), not cards. The live component showcase is a CSS multi-column masonry (1 / 2 / 3 columns), so tiles keep their natural heights.

## Elevation & Depth

Flat. No shadows in the chrome; depth comes from hairlines only. Live Signet components keep whatever elevation their own theme gives them.

## Shapes

8px radius on controls (buttons, tab hits), 12px on panels (command panel, code block). Pills only for small badges inside live components.

## Components

- **Primary button**: ink fill, page-coloured text, 36px tall, 8px radius, trailing arrow icon; hover drops opacity to 90%.
- **Outline button**: hairline border, ink text, wash fill on hover. The GitHub button carries the GitHub mark and a small star icon.
- **Command panel**: hairline panel, 12px radius; a tab row (New app / MCP server) with a 2px ink underline on the selected tab, then a mono command line with a muted `$` prompt and an icon-only copy button that swaps to a check for two seconds.
- **Code block**: hairline panel with a wash title bar carrying the filename in mono; surrounding lines muted, the line being taught in full ink.
- **Fact row**: name (medium), one-line fact (muted, 14px), arrow that nudges 2px right on hover; the whole row is the link.

## Do's and Don'ts

- Do render real Signet components and real commands instead of describing them.
- Do keep the action order: scaffolder, MCP server, docs, GitHub star.
- Do use only claims from PRODUCT.md and the guides.
- Don't add a kicker or eyebrow above a heading.
- Don't use gradient glow, glass, decorative serifs, seals, fake chats or other props that are not the product.
- Don't lay the page out as a grid of equal icon-heading-text cards.
- Don't let monospace appear outside commands and code.
