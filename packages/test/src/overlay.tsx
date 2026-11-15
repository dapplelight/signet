/**
 * A dev-only panel in the corner of the app: who is signed in, their plan,
 * entitlements and flags, a theme and light/dark switcher, and the fake
 * providers' outbox (from demo mode's `/__signet/dev`, or `state` you pass).
 *
 *   <DevOverlay themes={THEMES} theme={theme} onThemeChange={applyTheme} />
 *
 * Production builds drop it. The package's `exports` map sends the
 * `production` condition (Vite, webpack, Bun and esbuild with
 * `--conditions=production` all resolve it in a production build) to a
 * module whose `DevOverlay` is `() => null`, so the panel's code is not in
 * the bundle at all. Anywhere else it renders unless `enabled` is false, which
 * it defaults to when `process.env.NODE_ENV` is "production". The check is
 * guarded, so the module also loads unbundled in a browser, where there is no
 * `process`.
 *
 * Styled with the theme's own CSS variables (inline, so the app's Tailwind
 * build does not need to scan this package). Light/dark goes through
 * signet-ui's ThemeProvider when there is one, and the `.dark` class either way.
 */
import { useTheme } from "@dapplelight/signet-ui/components/theme-provider"
import { type CSSProperties, type ReactNode, useCallback, useEffect, useState } from "react"
import type { DevState } from "./demo.js"

// Declared here so the build needs no Node types.
declare const process: { env: { NODE_ENV?: string } }

/**
 * Plain `process.env.NODE_ENV`, so bundler define/replace plugins substitute
 * it and drop the panel; a browser with no `process` lands in the catch.
 */
let PRODUCTION = false
try {
  PRODUCTION = process.env.NODE_ENV === "production"
} catch {}

export type { DevState }

export type DevOverlayProps = {
  /** Shown as is. Without it, the panel fetches `src` when opened. */
  state?: DevState
  /** Demo mode's state route. Default "/__signet/dev". */
  src?: string
  /** Brand themes to offer. Hidden without `onThemeChange`. */
  themes?: readonly string[]
  theme?: string
  /** Switch the app's theme (each Signet theme is its own stylesheet, so the app does it). */
  onThemeChange?: (theme: string) => void
  /** Render at all. Default: not when `process.env.NODE_ENV` is "production". Tie it to your own dev flag if you like. */
  enabled?: boolean
  /** Start open. Default false. */
  defaultOpen?: boolean
  position?: "bottom-right" | "bottom-left"
}

const panel: CSSProperties = {
  position: "fixed",
  bottom: 12,
  zIndex: 2147483000,
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  fontSize: 12,
  color: "var(--card-fg, #111)",
  background: "var(--card, #fff)",
  border: "1px solid var(--border, #ddd)",
  borderRadius: "var(--radius-lg, 10px)",
  boxShadow: "var(--shadow-lg, 0 8px 24px rgb(0 0 0 / 0.15))",
}
const button = (active = false): CSSProperties => ({
  font: "inherit",
  cursor: "pointer",
  padding: "2px 8px",
  border: "1px solid var(--border, #ddd)",
  borderRadius: "var(--radius-md, 6px)",
  background: active ? "var(--primary, #111)" : "transparent",
  color: active ? "var(--primary-fg, #fff)" : "inherit",
})
const muted: CSSProperties = { color: "var(--muted-fg, #666)" }

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ padding: "8px 12px", borderTop: "1px solid var(--border, #ddd)" }}>
      <div style={{ ...muted, fontWeight: 600, marginBottom: 4 }}>{title}</div>
      {children}
    </section>
  )
}

function summary(m: NonNullable<DevState["outbox"]>[number]): string {
  const r = m.rendered as Record<string, unknown>
  const t = r.subject ?? r.title ?? r.text ?? (r.template as { name?: string })?.name ?? ""
  return String(t)
}

function Overlay({
  state: given,
  src = "/__signet/dev",
  themes,
  theme,
  onThemeChange,
  defaultOpen = false,
  position = "bottom-right",
}: DevOverlayProps) {
  const [open, setOpen] = useState(defaultOpen)
  const [fetched, setFetched] = useState<DevState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { setTheme } = useTheme()
  const [dark, setDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  )

  const refresh = useCallback(async () => {
    if (given) return
    try {
      const r = await fetch(src)
      if (!r.ok) throw new Error(`${r.status}`)
      setFetched((await r.json()) as DevState)
      setError(null)
    } catch (e) {
      setError(`${src}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [given, src])

  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  const toggleDark = () => {
    const next = !dark
    setTheme(next ? "dark" : "light")
    document.documentElement.classList.toggle("dark", next)
    setDark(next)
  }

  const side = position === "bottom-left" ? { left: 12 } : { right: 12 }
  if (!open)
    return (
      <button
        type="button"
        data-signet-dev-overlay=""
        aria-label="Open Signet dev overlay"
        onClick={() => setOpen(true)}
        style={{ ...panel, ...side, ...button(), padding: "4px 10px" }}
      >
        Signet dev
      </button>
    )

  const s = given ?? fetched ?? {}
  const flags = Object.entries(s.flags ?? {})
  const outbox = [...(s.outbox ?? [])].reverse().slice(0, 10)
  return (
    <aside
      data-signet-dev-overlay=""
      aria-label="Signet dev overlay"
      style={{ ...panel, ...side, width: 300, maxHeight: "70vh", overflow: "auto" }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 12px",
          fontWeight: 600,
        }}
      >
        <span style={{ flex: 1 }}>Signet dev{s.demo ? " · demo" : ""}</span>
        {!given && (
          <button type="button" style={button()} onClick={() => void refresh()}>
            Refresh
          </button>
        )}
        <button type="button" aria-label="Close" style={button()} onClick={() => setOpen(false)}>
          ×
        </button>
      </header>
      {error && (
        <div style={{ padding: "0 12px 8px", color: "var(--destructive, #c00)" }}>{error}</div>
      )}

      <Section title="User">
        {s.user ? (
          <div>
            {s.user.name ?? s.user.email ?? s.user.id} <span style={muted}>{s.user.id}</span>
          </div>
        ) : (
          <div style={muted}>Signed out</div>
        )}
      </Section>

      <Section title="Plan">
        <div>{s.plan ?? <span style={muted}>none</span>}</div>
        {!!s.entitlements?.length && <div style={muted}>{s.entitlements.join(", ")}</div>}
      </Section>

      <Section title="Flags">
        {flags.length ? (
          flags.map(([k, v]) => (
            <div key={k}>
              {k}: <b>{String(v)}</b>
            </div>
          ))
        ) : (
          <div style={muted}>none</div>
        )}
      </Section>

      <Section title="Theme">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {onThemeChange &&
            (themes ?? []).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={t === theme}
                style={button(t === theme)}
                onClick={() => onThemeChange(t)}
              >
                {t}
              </button>
            ))}
          <button type="button" aria-pressed={dark} style={button(dark)} onClick={toggleDark}>
            {dark ? "Dark" : "Light"}
          </button>
        </div>
      </Section>

      <Section title={`Outbox (${s.outbox?.length ?? 0})`}>
        {outbox.length ? (
          outbox.map((m) => (
            <div key={m.id} style={{ marginBottom: 4 }}>
              <b>{m.channel}</b> <span style={muted}>to {m.to}</span>
              <div>{summary(m)}</div>
            </div>
          ))
        ) : (
          <div style={muted}>Nothing sent</div>
        )}
      </Section>
    </aside>
  )
}

/** The dev overlay; renders nothing in a production build. */
/** The dev overlay. A production build resolves `./overlay` to a stub that renders nothing. */
export function DevOverlay({ enabled = !PRODUCTION, ...props }: DevOverlayProps): ReactNode {
  return enabled ? <Overlay {...props} /> : null
}
