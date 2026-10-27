"use client"

/**
 * Keyboard shortcuts on TanStack Hotkeys (`@tanstack/react-hotkeys`, an
 * optional peer). Apps register keys with its own hooks and describe them in
 * `meta`; Signet adds the `?` overlay that lists them, and j/k list focus.
 *
 *   useHotkey("Mod+K", openSearch, { meta: { name: "Search", group: "General" } })
 *   useHotkeySequence(["G", "I"], goInbox, { meta: { name: "Go to inbox" } })
 *
 * TanStack's defaults are the right ones here: single keys are ignored while
 * typing in a field, Mod+ and Escape are not, and `Mod` is ⌘ on macOS, Ctrl
 * elsewhere. The overlay lists every registration with a `meta.name` (or
 * `meta.description`), grouped by `meta.group`.
 */

import { formatForDisplay, useHotkey, useHotkeyRegistrations } from "@tanstack/react-hotkeys"
import { useState } from "react"

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./dialog.js"
import { Kbd } from "./kbd.js"

type Entry = { id: string; label: string; detail?: string; group: string; steps: string[][] }

const keysOf = (hotkey: Parameters<typeof formatForDisplay>[0]) =>
  formatForDisplay(hotkey, { parts: true })

/** The registrations the overlay lists, grouped. Exported for custom overlays. */
export function useShortcutList(): Array<[group: string, entries: Entry[]]> {
  const { hotkeys, sequences } = useHotkeyRegistrations()
  const entries: Entry[] = []
  const seen = new Set<string>()
  const add = (
    id: string,
    meta: { name?: string; description?: string; group?: string } | undefined,
    steps: string[][],
  ) => {
    const label = meta?.name ?? meta?.description
    if (!label) return
    const key = `${label}\u0000${steps.map((s) => s.join("+")).join(" ")}`
    if (seen.has(key)) return // the same key mounted twice (two lists on screen)
    seen.add(key)
    entries.push({
      id,
      label,
      ...(meta?.name && meta.description ? { detail: meta.description } : {}),
      group: meta?.group ?? "General",
      steps,
    })
  }
  for (const h of hotkeys) add(h.id, h.options.meta, [keysOf(h.hotkey)])
  for (const s of sequences)
    add(
      s.id,
      s.options.meta,
      s.sequence.map((step) => keysOf(step)),
    )
  const groups = new Map<string, Entry[]>()
  for (const e of entries) groups.set(e.group, [...(groups.get(e.group) ?? []), e])
  return [...groups]
}

/**
 * The shortcuts overlay. Mount once near the root: it binds `helpKey`
 * (default "?"; false to open it yourself with `open`/`onOpenChange`) and
 * lists every described shortcut mounted at the time.
 */
export function ShortcutsHelp({
  helpKey = "?",
  open: controlled,
  onOpenChange,
  title = "Keyboard shortcuts",
}: {
  helpKey?: string | false
  open?: boolean
  onOpenChange?: (open: boolean) => void
  title?: string
}) {
  const [own, setOwn] = useState(false)
  const open = controlled ?? own
  const setOpen = (o: boolean) => {
    if (controlled === undefined) setOwn(o)
    onOpenChange?.(o)
  }
  // "?" is Shift+/ on most layouts; the raw-key form matches the typed character.
  useHotkey(helpKey ? { key: helpKey } : { key: "?" }, () => setOpen(true), {
    enabled: helpKey !== false,
    meta: { name: "Show keyboard shortcuts", group: "General" },
  })
  const groups = useShortcutList()

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[80dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {helpKey && (
            <DialogDescription>
              Press <Kbd>{helpKey}</Kbd> any time to see this list.
            </DialogDescription>
          )}
        </DialogHeader>
        {groups.map(([group, entries]) => (
          <section key={group} aria-label={group} className="flex flex-col gap-1">
            <h3 className="text-[11px] font-medium uppercase tracking-wider text-text-muted">
              {group}
            </h3>
            <dl className="flex flex-col">
              {entries.map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-4 py-1">
                  <dt className="text-[13px] text-text-primary">
                    {e.label}
                    {e.detail && (
                      <span className="block text-[11px] text-text-muted">{e.detail}</span>
                    )}
                  </dt>
                  <dd className="flex shrink-0 items-center gap-1">
                    {/* Read as "G then I"; the key caps below are for the eye. */}
                    <span className="sr-only">
                      {e.steps.map((s) => s.join(" ")).join(" then ")}
                    </span>
                    {e.steps.map((step, i) => (
                      <span key={i} aria-hidden className="inline-flex items-center gap-0.5">
                        {i > 0 && <span className="mr-1 text-[10px] text-text-muted">then</span>}
                        {step.map((k) => (
                          <Kbd key={k}>{k}</Kbd>
                        ))}
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </DialogContent>
    </Dialog>
  )
}

/** A focused control that handles Enter itself: a button, link, field or ARIA widget. */
function isInteractive(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.closest !== "function") return false
  return !!el.closest(
    'a[href], button, input, select, textarea, summary, [contenteditable="true"], [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="checkbox"], [role="switch"], [role="tab"]',
  )
}

/**
 * j/k move through `ids` (↓/↑ too with `arrows`); Enter opens the active one. Pair with
 * DataTable's `activeRowId`, or any list that marks its active item. The
 * active id is the app's when `activeId` is passed, else kept here.
 */
export function useListNavigation({
  ids,
  activeId: controlled,
  onActiveChange,
  onOpen,
  enabled = true,
  arrows = false,
  group = "Navigation",
}: {
  ids: readonly string[]
  /**
   * Also bind ↓/↑. Off by default: bound page-wide they would stop the page
   * from scrolling with the arrow keys.
   */
  arrows?: boolean
  activeId?: string
  onActiveChange?: (id: string) => void
  onOpen?: (id: string) => void
  enabled?: boolean
  group?: string
}) {
  const [own, setOwn] = useState<string | undefined>(undefined)
  const activeId = controlled ?? own
  const setActive = (id: string) => {
    if (controlled === undefined) setOwn(id)
    onActiveChange?.(id)
  }
  const move = (delta: number) => {
    if (ids.length === 0) return
    const i = activeId === undefined ? -1 : ids.indexOf(activeId)
    const next =
      i < 0 ? (delta > 0 ? 0 : ids.length - 1) : Math.min(ids.length - 1, Math.max(0, i + delta))
    setActive(ids[next] as string)
  }
  const on = { enabled }
  useHotkey("J", () => move(1), { ...on, meta: { name: "Next item", group } })
  useHotkey("K", () => move(-1), { ...on, meta: { name: "Previous item", group } })
  useHotkey("ArrowDown", () => move(1), { enabled: enabled && arrows })
  useHotkey("ArrowUp", () => move(-1), { enabled: enabled && arrows })
  const canOpen = !!onOpen && activeId !== undefined && ids.includes(activeId)
  // Enter belongs to whatever is focused (a button, a link, a row with
  // role=button): open the active item only when focus is on nothing that
  // handles Enter itself, and only then take the key.
  useHotkey(
    "Enter",
    (e) => {
      if (activeId === undefined || isInteractive(e.target)) return
      e.preventDefault()
      onOpen?.(activeId)
    },
    {
      enabled: enabled && canOpen,
      preventDefault: false,
      ...(onOpen ? { meta: { name: "Open item", group } } : {}),
    },
  )
  return { activeId, setActiveId: setActive }
}
