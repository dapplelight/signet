#!/usr/bin/env bun

/**
 * signet — copy signet-ui components into an app as editable source
 * (`signet add`), and merge upstream changes into those copies later
 * (`signet upgrade`). Level 6 of customisation: own the code.
 */

import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { add, CONFIG, DEFAULTS, diff, list, SignetCliError, upgrade } from "./core.js"
import type { Registry } from "./registry.js"
import { theme } from "./theme.js"

const HELP = `
signet <command> [options]

Commands:
  add <name...>        Copy items and their dependencies into the app as source
  upgrade [name...]    Merge upstream changes into added items (default: all)
  diff <name>          Show what changed upstream since the item was copied
  list                 Every item, with what is added, edited or out of date
  theme <hex>          A whole theme from one brand colour (signet theme --help)

Options:
  --force              add: overwrite files you have edited
  --dry-run            upgrade: report what would change, write nothing
  --dir <path>         add: where to copy (default: ${DEFAULTS.dir}); saved in ${CONFIG}
  --alias <prefix>     add: import prefix for that dir (default: ${DEFAULTS.alias}); "" keeps relative imports
  --cwd <path>         App root (default: current directory)
  --registry <file>    Use this registry.json instead of the bundled one
  --json               Print the result as JSON
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

function main(): number {
  if (process.argv[2] === "theme") return theme(process.argv.slice(3))
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
    print(
      r,
      `\n  Added ${r.items.join(", ")} (signet-ui ${reg.version}).\n${r.written
        .map((f) => `    wrote ${f}`)
        .join("\n")}\n${peersLine(r.missingPeers)}`,
    )
    return 0
  }

  if (o.command === "upgrade") {
    const r = upgrade(o.cwd, reg, o.names, { dryRun: o.dryRun })
    const changed = r.files.filter((f) => f.status !== "current")
    const lines = changed.map(
      (f) =>
        `    ${f.status.padEnd(11)} ${f.path}${f.conflicts ? ` (${f.conflicts} conflicts)` : ""}`,
    )
    const bad = changed.filter((f) => f.status === "conflict" || f.status === "needs-merge")
    print(
      r,
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
      }\n${peersLine(r.missingPeers)}`,
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
  process.exit(main())
} catch (err) {
  if (!(err instanceof SignetCliError)) throw err
  console.error(`\n  ${err.message}\n`)
  process.exit(1)
}
