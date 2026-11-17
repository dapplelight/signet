"use client"
import { Button } from "@dapplelight/signet-ui/components/button"
import { PauseIcon, PlayIcon } from "lucide-react"
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { SEAL_OUTLINE } from "./mark"

/* ── Seal ──────────────────────────────────────────────────── */

/**
 * A wax seal: the mark's outline, two rings, the word set round the rim and
 * the four tiles in the middle. `press` plays the press when it mounts.
 */
export function Seal({
  word,
  className,
  press,
}: {
  word: string
  className?: string
  press?: boolean
}) {
  const id = useId()
  return (
    <svg
      viewBox="0 0 200 200"
      role="img"
      aria-label={`Sealed: ${word.toLowerCase()}`}
      className={`seal ${className ?? ""}`}
      data-press={press ? "" : undefined}
    >
      <path d={SEAL_OUTLINE} fill="var(--wax)" />
      <g fill="none" stroke="var(--seal-ink)" opacity="0.85">
        <circle cx="100" cy="100" r="70" strokeWidth="2" />
        <circle cx="100" cy="100" r="46" strokeWidth="1.5" />
      </g>
      <path id={id} d="M100 42a58 58 0 1 1 0 116a58 58 0 1 1 0-116" fill="none" />
      <text
        fill="var(--seal-ink)"
        fontSize="17"
        letterSpacing="2"
        style={{ fontFamily: "var(--font-seal), Georgia, serif" }}
      >
        <textPath href={`#${id}`} textLength="356" lengthAdjust="spacing">
          {`${word} · ${word} · `}
        </textPath>
      </text>
      <g fill="var(--seal-ink)" transform="translate(100 100) scale(0.5) translate(-100 -100)">
        <rect x="60" y="60" width="36" height="36" rx="7" />
        <rect x="104" y="60" width="36" height="36" rx="7" />
        <rect x="60" y="104" width="36" height="36" rx="7" />
        <circle cx="122" cy="122" r="18" />
      </g>
    </svg>
  )
}

/** Mounts its children the first time the box scrolls into view. */
function useSeen<T extends Element>() {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setSeen(true)
          io.disconnect()
        }
      },
      { threshold: 0.6 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return [ref, seen] as const
}

function useReducedMotion() {
  return useSyncExternalStore(
    (cb) => {
      const q = matchMedia("(prefers-reduced-motion: reduce)")
      q.addEventListener("change", cb)
      return () => q.removeEventListener("change", cb)
    },
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => true,
  )
}

/* ── Theme switcher ────────────────────────────────────────── */

const THEMES = [
  {
    id: "editorial",
    label: "Editorial",
    note: "Warm neutrals, green accent, dense data-first geometry.",
  },
  {
    id: "cinematic",
    label: "Cinematic",
    note: "Cool neutrals, violet accent, 2px radii and a larger type scale.",
  },
  {
    id: "finance",
    label: "Finance",
    note: "Editorial plus money slots: credits read green, debits stay ink.",
  },
] as const
type ThemeId = (typeof THEMES)[number]["id"]

const Skin = createContext<[ThemeId, (t: ThemeId) => void]>(["editorial", () => {}])

/** Holds the theme the home page's live surfaces are drawn in. */
export function SkinProvider({ children }: { children: ReactNode }) {
  const state = useState<ThemeId>("editorial")
  return <Skin.Provider value={state}>{children}</Skin.Provider>
}

/** A surface drawn with Signet's tokens in the chosen theme. */
export function Skinned({ className, children }: { className?: string; children: ReactNode }) {
  const [theme] = useContext(Skin)
  return (
    <div data-signet-theme={theme} className={`text-foreground ${className ?? ""}`}>
      {children}
    </div>
  )
}

/** One control: picks which shipped theme file every live surface reads. */
export function SkinPicker() {
  const [theme, setTheme] = useContext(Skin)
  const current = THEMES.find((t) => t.id === theme) ?? THEMES[0]
  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="Theme" className="flex flex-wrap gap-2">
        {THEMES.map((t) => (
          <label
            key={t.id}
            className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-fd-border py-2 pr-4 pl-2.5 text-sm font-medium transition-colors hover:bg-fd-muted has-checked:border-[var(--seal)] has-checked:bg-fd-muted has-focus-visible:outline-2 has-focus-visible:outline-[var(--seal)]"
          >
            <input
              type="radio"
              name="signet-theme"
              value={t.id}
              checked={theme === t.id}
              onChange={() => setTheme(t.id)}
              className="sr-only"
            />
            <span
              data-signet-theme={t.id}
              aria-hidden="true"
              className="flex size-6 items-center justify-center rounded-full border border-border bg-background"
            >
              <span className="size-3 rounded-full bg-primary" />
            </span>
            {t.label}
          </label>
        ))}
      </div>
      <p className="text-sm text-fd-muted-foreground" aria-live="polite">
        <code className="text-fd-foreground">{current.id}.css</code> · {current.note}
      </p>
    </div>
  )
}

/* ── Live MCP moment ───────────────────────────────────────── */

const ME = "priya@acme.dev"
const NOTES = [
  { title: "Q4 pricing review", when: "Tue" },
  { title: "Onboarding checklist v2", when: "Mon" },
  { title: "Interview loop: backend", when: "Oct 28" },
]
/** How long each step holds before the next; step 3 waits for a decision. */
const HOLD = [700, 1300, 1100, 2600, 900, 5200]
const LAST = HOLD.length - 1

/**
 * A chat client calling the notes app's MCP server: the request, the
 * save_note call, the approval, the seal, the note. Plays on a loop with a
 * pause control; reduced motion shows the finished exchange.
 */
export function McpChat() {
  const reduced = useReducedMotion()
  const [step, setStep] = useState(LAST)
  const [denied, setDenied] = useState(false)
  const [paused, setPaused] = useState(false)
  const playing = !reduced && !paused

  // Start from the top once the page is interactive.
  useEffect(() => {
    if (!reduced) setStep(0)
  }, [reduced])

  useEffect(() => {
    if (!playing) return
    const t = setTimeout(
      () => {
        if (denied || step === LAST) {
          setDenied(false)
          setStep(0)
        } else setStep(step + 1)
      },
      denied ? 3200 : HOLD[step],
    )
    return () => clearTimeout(t)
  }, [step, denied, playing])

  const shown = reduced ? LAST : step
  const approved = shown >= 4 && !denied
  const decide = (allow: boolean) => {
    if (allow) setStep(4)
    else setDenied(true)
  }

  return (
    <Skinned className="overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <p className="text-sm">
          <span className="font-medium">Claude</span>
          <span className="text-muted-foreground"> · connected to notes</span>
        </p>
        {!reduced && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPaused(!paused)}
            aria-label={paused ? "Play the demo" : "Pause the demo"}
          >
            {paused ? <PlayIcon /> : <PauseIcon />}
            {paused ? "Play" : "Pause"}
          </Button>
        )}
      </div>

      <div className="grid sm:grid-cols-[minmax(0,1fr)_13rem]">
        <ol className="flex min-h-[23rem] flex-col gap-4 p-4 text-sm" aria-live="polite">
          {shown >= 1 && (
            <li className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-muted px-3.5 py-2.5">
              Save a note about the Acme call: they want SSO before the March renewal.
            </li>
          )}
          {shown >= 2 && (
            <li className="flex flex-col gap-3">
              <p>I'll save that to your notes.</p>
              <div className="relative rounded-xl border border-border bg-background">
                <p className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground">
                  <code className="text-sm font-medium text-foreground">save_note</code>
                  {approved ? "approved" : denied ? "denied" : "waiting for approval"}
                </p>
                <pre className="px-3 py-2.5 text-xs leading-relaxed break-words whitespace-pre-wrap">
                  <code>{`{
  "title": "Acme call",
  "body": "Wants SSO before the March renewal."
}`}</code>
                </pre>
                {approved && (
                  <Seal
                    word="APPROVED"
                    press={!reduced}
                    className="absolute -top-5 right-3 size-20 sm:-right-4 sm:size-24"
                  />
                )}
              </div>
            </li>
          )}
          {shown === 3 && !denied && (
            <li className="flex flex-col gap-3 rounded-xl border border-border p-3">
              <p>
                Allow <code className="font-medium">save_note</code>? It writes to your notes as{" "}
                {ME}.
              </p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => decide(true)}>
                  Allow
                </Button>
                <Button size="sm" variant="outline" onClick={() => decide(false)}>
                  Deny
                </Button>
              </div>
            </li>
          )}
          {denied && <li className="text-muted-foreground">Denied. Nothing was saved.</li>}
          {approved && <li className="text-muted-foreground">Allowed by {ME}</li>}
          {shown >= 5 && !denied && <li>Saved “Acme call” to your notes.</li>}
        </ol>

        <div className="border-t border-border bg-muted/40 p-4 sm:border-t-0 sm:border-l">
          <p className="text-xs text-muted-foreground">Notes · {ME}</p>
          <ul className="mt-3 flex flex-col text-sm">
            {shown >= 5 && !denied && (
              <li className="flex items-baseline justify-between gap-2 border-b border-border py-2">
                <span className="font-medium">Acme call</span>
                <span className="text-xs text-muted-foreground">now</span>
              </li>
            )}
            {NOTES.map((n) => (
              <li
                key={n.title}
                className="flex items-baseline justify-between gap-2 border-b border-border py-2 last:border-0"
              >
                <span className="truncate">{n.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{n.when}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Skinned>
  )
}

/* ── Ledger ────────────────────────────────────────────────── */

const LEDGER = [
  { provider: "Stripe", event: "invoice.paid", amount: "$29.00" },
  { provider: "PhonePe", event: "PAYMENT_SUCCESS", amount: "₹499.00" },
  { provider: "Razorpay", event: "payment.captured", amount: "₹2,499.00", sealed: true },
  { provider: "Razorpay", event: "payment.captured", amount: "₹2,499.00", duplicate: true },
]

/** Webhooks as they land; the seal presses onto the booked row once in view. */
export function Ledger() {
  const [ref, seen] = useSeen<HTMLDivElement>()
  const reduced = useReducedMotion()
  return (
    <Skinned className="rounded-2xl border border-border bg-card">
      <div ref={ref} className="flex flex-col">
        {LEDGER.map((l, i) => (
          <div
            key={`${l.provider}-${i}`}
            className="relative grid grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-0.5 border-b border-border px-5 py-3.5 text-sm last:border-0 sm:grid-cols-[6rem_1fr_auto_8rem]"
          >
            <span className="font-medium">{l.provider}</span>
            <code className="col-start-1 row-start-2 text-xs text-muted-foreground sm:col-start-2 sm:row-start-1">
              {l.event}
            </code>
            <span
              className={
                l.duplicate
                  ? "text-right tabular-nums text-muted-foreground line-through"
                  : "text-right tabular-nums text-[color:var(--money-credit,var(--foreground))]"
              }
            >
              {l.amount}
            </span>
            <span className="text-right text-xs text-muted-foreground">
              {l.duplicate ? "duplicate, ignored" : "posted"}
            </span>
            {l.sealed && (seen || reduced) && (
              <Seal
                word="POSTED"
                press={!reduced}
                className="pointer-events-none absolute top-1/2 right-[36%] size-20 -translate-y-1/2 sm:right-[15rem]"
              />
            )}
          </div>
        ))}
      </div>
    </Skinned>
  )
}
