/**
 * Checks a Worker's setup for Signet's Durable Object rate limiter.
 *
 * The setup lives in three places no library can reach — wrangler config (the
 * binding), its migration history (which creates the class), and the Worker
 * entry (which must export the class) — and each mistake fails differently: a
 * refused deploy, a runtime "no such Durable Object", or workerd's "Incorrect
 * type for map entry". This names the gap and prints the snippet that closes it.
 *
 * Pure: takes file contents, returns findings. `cli.ts` does the file system.
 */

export type Finding = {
  level: "error" | "warn" | "ok"
  message: string
  /** What to add, verbatim. */
  fix?: string
}

export type DoctorInput = {
  /** Contents of wrangler.jsonc / wrangler.json, or null when there is none. */
  wranglerConfig: string | null
  /** The Worker entry's source (wrangler's `main`), or null when unreadable. */
  entrySource: string | null
  /** All app source, concatenated — to see whether durableObjectStore is used. */
  appSource: string
}

const CLASS = "RateLimitCounter"
/** hono-rate-limiter's class, the usual thing being replaced. */
const LEGACY_CLASS = "DurableObjectRateLimiter"
const EXPORT_LINE = `export { ${CLASS} } from "@dapplelight/signet-server/middleware/rate-limit-do"`

type Migration = {
  tag?: string
  new_classes?: string[]
  new_sqlite_classes?: string[]
  deleted_classes?: string[]
  renamed_classes?: { from: string; to: string }[]
}
type WranglerConfig = {
  main?: string
  durable_objects?: { bindings?: { name: string; class_name: string }[] }
  migrations?: Migration[]
}

/** JSONC to JSON: drops comments and trailing commas, leaving strings intact. */
export function stripJsonc(text: string): string {
  let out = ""
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const next = text[i + 1]
    if (inString) {
      out += ch
      if (ch === "\\") {
        out += next ?? ""
        i++
      } else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
    } else if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++
      out += "\n"
    } else if (ch === "/" && next === "*") {
      i += 2
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++
      i++
    } else {
      out += ch
    }
  }
  return out.replace(/,(\s*[}\]])/g, "$1")
}

export function parseWranglerConfig(text: string): WranglerConfig {
  return JSON.parse(stripJsonc(text)) as WranglerConfig
}

/** Which class names exist after replaying the migrations in order. */
export function classesAfterMigrations(migrations: Migration[] = []): Set<string> {
  const live = new Set<string>()
  for (const m of migrations) {
    for (const c of [...(m.new_classes ?? []), ...(m.new_sqlite_classes ?? [])]) live.add(c)
    for (const r of m.renamed_classes ?? []) {
      live.delete(r.from)
      live.add(r.to)
    }
    for (const c of m.deleted_classes ?? []) live.delete(c)
  }
  return live
}

function nextTag(migrations: Migration[] = []): string {
  const nums = migrations
    .map((m) => Number(/^v(\d+)$/.exec(m.tag ?? "")?.[1]))
    .filter(Number.isFinite)
  return nums.length ? `v${Math.max(...nums) + 1}` : `v${migrations.length + 1}`
}

/** `export const NAME = "..."` and friends: values workerd rejects as entrypoints. */
function valueExports(entry: string): { name: string; literal: boolean }[] {
  const found: { name: string; literal: boolean }[] = []
  const literal = /^(?:"[^"]*"|'[^']*'|`[^`$]*`|-?\d[\d_.]*|true|false|null)\s*;?\s*$/
  for (const m of entry.matchAll(
    /^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(.*)$/gm,
  )) {
    const value = (m[2] ?? "").trim()
    // A Hono app has a fetch method, so workerd accepts it as an entrypoint.
    if (/^new\s+Hono\b/.test(value)) continue
    found.push({ name: m[1] ?? "?", literal: literal.test(value) })
  }
  return found
}

export function diagnose(input: DoctorInput): Finding[] {
  const findings: Finding[] = []
  const usesStore = /durableObjectStore\s*\(/.test(input.appSource)
  if (!usesStore) {
    return [{ level: "ok", message: "durableObjectStore is not used; nothing to check." }]
  }
  if (input.wranglerConfig === null) {
    return [
      {
        level: "error",
        message: "durableObjectStore is used, but there is no wrangler.jsonc or wrangler.json.",
      },
    ]
  }

  let config: WranglerConfig
  try {
    config = parseWranglerConfig(input.wranglerConfig)
  } catch (err) {
    return [{ level: "error", message: `wrangler config does not parse: ${String(err)}` }]
  }

  // (a) the binding
  const bindings = config.durable_objects?.bindings ?? []
  const binding = bindings.find((b) => b.class_name === CLASS)
  const usedNames = [
    ...input.appSource.matchAll(/durableObjectStore\s*\(\s*c\.env\.([A-Za-z_$][\w$]*)/g),
  ].map((m) => m[1])
  const wanted = usedNames[0] ?? "RATE_LIMIT"
  if (!binding) {
    findings.push({
      level: "error",
      message: `No durable_objects binding for ${CLASS}.`,
      fix: `"durable_objects": { "bindings": [{ "name": "${wanted}", "class_name": "${CLASS}" }] }`,
    })
  } else {
    findings.push({ level: "ok", message: `Binding ${binding.name} -> ${CLASS}.` })
    for (const name of new Set(usedNames)) {
      if (name && name !== binding.name) {
        findings.push({
          level: "error",
          message: `Code reads c.env.${name}, but ${CLASS} is bound as ${binding.name}.`,
          fix: `Rename one to match: "name": "${name}" in wrangler config, or c.env.${binding.name} in code.`,
        })
      }
    }
  }

  // (b) a migration that creates the class
  const live = classesAfterMigrations(config.migrations)
  if (live.has(CLASS)) {
    findings.push({ level: "ok", message: `A migration creates ${CLASS}.` })
  } else {
    const tag = nextTag(config.migrations)
    const replacing = live.has(LEGACY_CLASS) || bindings.some((b) => b.class_name === LEGACY_CLASS)
    findings.push({
      level: "error",
      message: replacing
        ? `No migration creates ${CLASS}, and ${LEGACY_CLASS} (hono-rate-limiter) is still live. Swap them in the next tag.`
        : `No migration creates ${CLASS}.`,
      fix: replacing
        ? `{ "tag": "${tag}", "new_sqlite_classes": ["${CLASS}"], "deleted_classes": ["${LEGACY_CLASS}"] }   // append to "migrations"; also remove its binding`
        : `{ "tag": "${tag}", "new_sqlite_classes": ["${CLASS}"] }   // append to "migrations"; never edit a deployed tag`,
    })
  }

  // (c) the class exported from the entry, (d) nothing workerd rejects
  if (input.entrySource === null) {
    findings.push({
      level: "error",
      message: `Cannot read the Worker entry (${config.main ?? 'no "main" in wrangler config'}).`,
    })
  } else {
    const exported =
      new RegExp(`export\\s*\\{[^}]*\\b${CLASS}\\b[^}]*\\}`).test(input.entrySource) ||
      new RegExp(`export\\s+class\\s+${CLASS}\\b`).test(input.entrySource) ||
      /export\s*\*\s*from\s*["']@dapplelight\/signet-server\/middleware\/rate-limit-do["']/.test(
        input.entrySource,
      )
    findings.push(
      exported
        ? { level: "ok", message: `The entry exports ${CLASS}.` }
        : {
            level: "error",
            message: `The Worker entry (${config.main}) does not export ${CLASS}; the binding cannot find it.`,
            fix: EXPORT_LINE,
          },
    )
    for (const v of valueExports(input.entrySource)) {
      findings.push({
        level: v.literal ? "error" : "warn",
        message: v.literal
          ? `The entry exports ${v.name}, a plain value. workerd rejects it ("Incorrect type for map entry").`
          : `The entry exports ${v.name}. An entry may export only handlers and classes; check it is one.`,
        fix: `Move ${v.name} to another module and import it from there.`,
      })
    }
  }
  return findings
}
