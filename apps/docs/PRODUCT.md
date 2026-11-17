# Signet

## What it is
An open-source TypeScript kit for web apps and their APIs: React components on Tailwind v4 with a token contract (a theme is one CSS file), a Workers/Hono server kit (auth, error envelope, validation, rate limits, OAuth), payments over 12 providers with a double-entry ledger, paywalls, AI spend caps, crash-safe workflows, a growth kit, ready-made screens, and an MCP server so coding agents build with it. One line (`mountMcp`) turns validated routes into MCP tools. North star: apps write only business logic; Signet ships the rest.

## Stage
Public beta. Every package is 0.x and published on npm under `@dapplelight` (scaffolder: `create-signet-app`). APIs may move.

## Audience
1. Indie developers who ship several small apps and want one shared kit instead of copying code between repos.
2. Developers who build with AI agents (Claude Code, Cursor) and want the agent to use a real system instead of improvising.

## Desired actions (in order)
1. Run the scaffolder: `npx create-signet-app@latest my-app`.
2. Connect Signet's MCP server to their agent.
3. Read the docs.
4. Star the GitHub repo.

## Proof available
- Open-source code and published npm packages.
- Live, working components rendered in the page.
Not available: named customer apps, usage numbers, testimonials. Do not invent them.

## Positioning
Hero copy (owner-approved): "Write the business logic. Signet ships the rest." Subline: "Auth, payments, paywalls, workflows, components and an MCP server, as packages you install and update."
Not unique on its own: components + an MCP registry (shadcn has this). Unique together: payments across 12 providers incl. Razorpay/PhonePe/app stores with a ledger, AI caps, workflows, MCP-by-default, in installable packages.

## Constraints
Public repo: no personal names, private product names or local paths. Docs site is Fumadocs 16 on Next.js 16, static export.

## Landing page brief (owner, 2026-11-17)
- Success: shareable on X (looks unlike other dev-tool pages), instantly clear in 5 seconds, makes visitors try it (scaffolder / MCP), feels premium.
- Keep: only the hero copy above. Everything else may go.
- Feels wrong if: it looks like every dev tool (dark, centered hero, bento, gradient glow), it is gimmicky (decoration such as seals or fake chats that is not the product), it has too much text, or it has a template feel.
- Previous rejected attempts: centered hero + bento cards; left hero + alternating rows; self-playing chat + wax seal + serif display face + theme switcher of near-identical themes.

## Brand commitment (owner, 2026-11-17)
The landing page and docs follow the category standard, played straight: shadcn/ui and Vercel docs style (Geist, white / near-black, neutral greys, hairline borders, live components). Sit alongside ui.shadcn.com and vercel.com; their craft level is the bar. No thematic worlds, metaphors or ornament (seals, chats, display serifs). Within that standard, still avoid gradient glow, a uniform bento of boxes, and long text.
