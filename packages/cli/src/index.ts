#!/usr/bin/env bun

/**
 * signet — copy signet-ui components into an app as editable source
 * (`signet add`), and merge upstream changes into those copies later
 * (`signet upgrade`). Level 6 of customisation: own the code.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { runCodemods } from "./codemods.js"
import { conformance } from "./conformance.js"
import {
  add,
  CONFIG,
  DEFAULTS,
  diff,
  list,
  loadConfig,
  SignetCliError,
  saveConfig,
  unifiedDiff,
  upgrade,
} from "./core.js"
import { addCommand, packageManager, type WireResult, wire } from "./modules.js"
import type { Registry } from "./registry.js"
import { theme } from "./theme.js"

const HELP = `
signet <command> [options]

Commands:
  add <name...>        Copy items and their dependencies into the app as source.
                       Backend modules (auth, db, payments, notify, admin) go to
                       src/server/ and are wired into src/app.ts, src/env.ts and
                       .env.example; their npm packages are installed
  add block <name...>  Copy a page-level block (analytics-dashboard, list-detail,
                       settings, auth-page, onboarding, pricing, checkout-summary,
                       empty-page, error-page) and the components it uses
  upgrade [name...]    Merge upstream changes into added items (default: all),
                       then run the codemods your installed Signet versions need
  diff <name>          Show what changed upstream since the item was copied
  list                 Every item, with what is added, edited or out of date
  theme <hex>          A whole theme from one brand colour (signet theme --help)
  conformance <url>    Check a backend against the Signet wire contract

Options:
  --force              add: overwrite files you have edited
  --dry-run            upgrade: report what would change, write nothing
  --no-install         add: print the install command instead of running it
  --dir <path>         add: where to copy (default: ${DEFAULTS.dir}); saved in ${CONFIG}
  --alias <prefix>     add: import prefix for that dir (default: ${DEFAULTS.alias}); "" keeps relative imports
  --cwd <path>         App root (default: current directory)
  --registry <file>    Use this registry.json instead of the bundled one
  --json               Print the result as JSON
  --auth-prefix <path> conformance: where client-login routes are mounted (default: /api/auth)
  --ingest <path>      conformance: the analytics ingest route (default: /api/analytics)
  --sessions <path>    conformance: where session routes are mounted (default: /api/sessions)
  --json-path <path>   conformance: a route that parses a JSON body (needed for invalid-json-400)
  -h, --help

Examples:
  bunx @dapplelight/signet-cli add dialog
  bunx @dapplelight/signet-cli upgrade --dry-run
`

function parseArgs(argv: string[]) {
  const o = {
    command: "",
    names: [] as string[],
    force: false,
    dryRun: false,
    install: true,
    json: false,
    cwd: process.cwd(),
    registry: fileURLToPath(new URL("../dist/registry.json", import.meta.url)),
    dir: undefined as string | undefined,
    alias: undefined as string | undefined,
  }
  const args = argv.slice(2)
  const value = (i: number, flag: string) => {
    const v = args[i]
    if (v === undefined) throw new SignetCliError(`${flag} needs a value.`)
    return v
  }
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string
    if (a === "--force") o.force = true
    else if (a === "--dry-run") o.dryRun = true
    else if (a === "--no-install") o.install = false
    else if (a === "--json") o.json = true
    else if (a === "--cwd") o.cwd = resolve(value(++i, a))
    else if (a === "--registry") o.registry = resolve(value(++i, a))
    else if (a === "--dir") o.dir = value(++i, a)
    else if (a === "--alias") o.alias = value(++i, a)
    else if (a === "-h" || a === "--help") o.command = "help"
    else if (a.startsWith("-")) throw new SignetCliError(`Unknown option "${a}".`)
    else if (!o.command) o.command = a
    else o.names.push(a)
  }
  return o
}

const peersLine = (peers: Record<string, string>) =>
  Object.keys(peers).length
    ? `\n  Install the npm packages these need:\n  bun add ${Object.entries(peers)
        .map(([n, r]) => `"${n}@${r}"`)
        .join(" ")}\n`
    : ""

/** Wire every backend module among `items`; their lines, merged. */
function wireAll(root: string, reg: Registry, items: string[]): WireResult {
  const res: WireResult = { added: [], manual: [] }
  for (const n of items) {
    const w = reg.items[n]?.wire
    if (!w) continue
    const r = wire(root, w)
    res.added.push(...r.added)
    res.manual.push(...r.manual)
  }
  return res
}

const wireLines = (w: WireResult) =>
  `${w.added.map((l) => `    wired ${l}`).join("\n")}${
    w.manual.length
      ? `\n\n  Add these by hand (no anchor found):\n${w.manual.map((l) => `    ${l}`).join("\n")}`
      : ""
  }`

/**
 * Backend modules install their npm packages with the app's package manager.
 * Packages not on npm yet are only named: link them from a Signet checkout.
 */
function install(
  root: string,
  reg: Registry,
  items: string[],
  peers: Record<string, string>,
  run: boolean,
): { command?: string; ran?: boolean; ok?: boolean; unpublished: string[] } {
  const priv = new Set(items.flatMap((n) => reg.items[n]?.private ?? []))
  const unpublished = Object.keys(peers).filter((n) => priv.has(n))
  const specs = Object.entries(peers)
    .filter(([n]) => !priv.has(n))
    .map(([n, r]) => `${n}@${r}`)
  if (!specs.length) return { unpublished }
  const cmd = addCommand(packageManager(root), specs)
  const command = cmd.map((a) => (a.includes(" ") || /[<>]/.test(a) ? `"${a}"` : a)).join(" ")
  if (!run) return { command, ran: false, unpublished }
  const r = Bun.spawnSync(cmd, { cwd: root, stdout: "inherit", stderr: "inherit" })
  return { command, ran: true, ok: r.exitCode === 0, unpublished }
}

const installLines = (i: ReturnType<typeof install>) =>
  `${
    i.command
      ? i.ran
        ? i.ok
          ? `\n  Installed: ${i.command}\n`
          : `\n  Install failed; run it yourself: ${i.command}\n`
        : `\n  Install the npm packages these need:\n  ${i.command}\n`
      : ""
  }${
    i.unpublished.length
      ? `\n  ${i.unpublished.join(", ")}: not on npm yet, link it from a Signet checkout.\n`
      : ""
  }`

async function main(): Promise<number> {
  if (process.argv[2] === "theme") return theme(process.argv.slice(3))
  if (process.argv[2] === "conformance") return conformance(process.argv.slice(3))
  const o = parseArgs(process.argv)
  if (!o.command || o.command === "help") {
    console.log(HELP)
    return 0
  }
  if (!existsSync(o.registry))
    throw new SignetCliError(`No registry at ${o.registry}. Run bun run build in packages/cli.`)
  const reg = JSON.parse(readFileSync(o.registry, "utf8")) as Registry
  const print = (json: unknown, text: string) => console.log(o.json ? JSON.stringify(json) : text)

  if (o.command === "add") {
    // `add block <name...>`: same copy, but the names must be page-level blocks.
    if (o.names[0] === "block") {
      o.names.shift()
      if (!o.names.length)
        throw new SignetCliError(
          `Usage: signet add block <name...>. Blocks: ${Object.keys(reg.items)
            .filter((n) => reg.items[n]?.block)
            .join(", ")}`,
        )
      for (const n of o.names)
        if (!reg.items[n]?.block)
          throw new SignetCliError(`"${n}" is not a block. Run signet add block for the list.`)
    }
    if (!o.names.length) throw new SignetCliError("Usage: signet add <name...>")
    const config = {
      ...(o.dir !== undefined && { dir: o.dir }),
      ...(o.alias !== undefined && { alias: o.alias }),
    }
    const r = add(o.cwd, reg, o.names, { force: o.force, config })
    if (r.refused.length && !o.force) {
      print(
        r,
        `\n  Not written: you have edited these and signet-ui changed them too.\n${r.refused
          .map((f) => `    ${f}`)
          .join(
            "\n",
          )}\n\n  Merge with: signet upgrade ${o.names.join(" ")}\n  Or overwrite with --force.\n`,
      )
      return 1
    }
    const modules = r.items.filter((n) => reg.items[n]?.root === "app")
    if (!modules.length) {
      print(
        r,
        `\n  Added ${r.items.join(", ")} (signet-ui ${reg.version}).\n${r.written
          .map((f) => `    wrote ${f}`)
          .join("\n")}\n${peersLine(r.missingPeers)}`,
      )
      return 0
    }
    const wired = wireAll(o.cwd, reg, modules)
    const inst = install(o.cwd, reg, r.items, r.missingPeers, o.install)
    print(
      { ...r, wired, install: inst },
      `\n  Added ${r.items.join(", ")} (signet ${reg.version}).\n${r.written
        .map((f) => `    wrote ${f}`)
        .join("\n")}\n${wireLines(wired)}\n${installLines(inst)}`,
    )
    return inst.ran && !inst.ok ? 1 : 0
  }

  if (o.command === "upgrade") {
    const r = upgrade(o.cwd, reg, o.names, { dryRun: o.dryRun })
    const modules = Object.keys(loadConfig(o.cwd).items).filter((n) => reg.items[n]?.root === "app")
    const wired = o.dryRun ? { added: [], manual: [] } : wireAll(o.cwd, reg, modules)
    const c = loadConfig(o.cwd)
    const mods = await runCodemods(o.cwd, c.codemods ?? [])
    if (!o.dryRun) {
      for (const m of mods.results)
        for (const e of m.edits) writeFileSync(resolve(o.cwd, e.path), e.after)
      if (mods.results.length) {
        c.codemods = [...(c.codemods ?? []), ...mods.results.map((m) => m.id)]
        saveConfig(o.cwd, c)
      }
    }
    const modText = mods.results
      .map(
        (m) =>
          `\n\n  Codemod: ${m.title}${m.edits
            .map((e) =>
              o.dryRun ? `\n${unifiedDiff(e.before, e.after, e.path)}` : `\n    rewrote ${e.path}`,
            )
            .join("")}${m.notes.map((n) => `\n    ${n}`).join("")}${
            !m.edits.length && !m.notes.length ? "\n    nothing to change" : ""
          }`,
      )
      .join("")
    const skipText = mods.skipped
      ? `\n\n  Codemods not run (${mods.skipped.ids.join(", ")}): ${mods.skipped.reason}.`
      : ""
    const changed = r.files.filter((f) => f.status !== "current")
    const lines = changed.map(
      (f) =>
        `    ${f.status.padEnd(11)} ${f.path}${f.conflicts ? ` (${f.conflicts} conflicts)` : ""}`,
    )
    const bad = changed.filter((f) => f.status === "conflict" || f.status === "needs-merge")
    print(
      { ...r, wired, codemods: mods },
      `\n  ${o.dryRun ? "Would upgrade" : "Upgraded"} to signet-ui ${reg.version}.${
        changed.length ? `\n${lines.join("\n")}` : " Everything is current."
      }${r.added.length ? `\n  New dependencies: ${r.added.join(", ")}` : ""}${
        bad.some((f) => f.status === "conflict")
          ? "\n\n  Resolve the <<<<<<< app / >>>>>>> signet-ui markers, then run your checks."
          : ""
      }${
        bad.some((f) => f.status === "needs-merge")
          ? `\n\n  needs-merge: ${r.git ? "no recorded base" : "git is not installed"}; merge by hand (signet diff shows upstream changes).`
          : ""
      }${wired.added.length || wired.manual.length ? `\n${wireLines(wired)}` : ""}${modText}${skipText}\n${peersLine(r.missingPeers)}`,
    )
    return bad.length ? 1 : 0
  }

  if (o.command === "diff") {
    const [name] = o.names
    if (!name) throw new SignetCliError("Usage: signet diff <name>")
    const d = diff(o.cwd, reg, name)
    print({ diff: d }, d || `  ${name}: no upstream changes since it was copied.`)
    return 0
  }

  if (o.command === "list") {
    const l = list(o.cwd, reg)
    print(
      l,
      l
        .map(
          (e) =>
            `  ${e.name.padEnd(20)}${
              e.added
                ? `added ${e.added}${e.edited ? ", edited" : ""}${e.update ? ", update available" : ""}`
                : ""
            }`,
        )
        .join("\n"),
    )
    return 0
  }

  throw new SignetCliError(`Unknown command "${o.command}".${HELP}`)
}

try {
  process.exit(await main())
} catch (err) {
  if (!(err instanceof SignetCliError)) throw err
  console.error(`\n  ${err.message}\n`)
  process.exit(1)
}
