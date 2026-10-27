import { useState } from "react"
import { cn } from "../../lib/utils.js"
import { Popover, PopoverContent, PopoverTrigger } from "./popover.js"

/** A small, general-purpose set; pass `emojis` for a domain-specific one. */
const DEFAULT_EMOJIS = [
  "🎯",
  "🏠",
  "🚗",
  "✈️",
  "🏖️",
  "🎓",
  "💍",
  "👶",
  "🩺",
  "🛡️",
  "💰",
  "🏦",
  "📈",
  "💼",
  "🎁",
  "🎉",
  "📱",
  "💻",
  "🛋️",
  "🐶",
  "🌱",
  "⛰️",
  "🚲",
  "🎸",
  "📚",
  "🍽️",
  "☕",
  "🛒",
  "💡",
  "🔧",
  "🧳",
  "🪔",
  "🕌",
  "⛪",
  "🛕",
  "❤️",
]

interface EmojiPickerProps {
  value: string | null | undefined
  onChange: (emoji: string) => void
  emojis?: string[]
  /** Accessible name of the trigger, e.g. "Goal icon". */
  label?: string
  className?: string
}

/**
 * Pick one emoji from a grid. No dependency and no emoji database: a curated
 * list, plus the device's own emoji keyboard through the "Other" field.
 */
function EmojiPicker({
  value,
  onChange,
  emojis = DEFAULT_EMOJIS,
  label = "Choose an emoji",
  className,
}: EmojiPickerProps) {
  const [open, setOpen] = useState(false)
  const [other, setOther] = useState("")
  const pick = (e: string) => {
    onChange(e)
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={label}
        className={cn(
          "flex size-11 items-center justify-center rounded-lg border border-border-default bg-bg-surface text-xl transition-colors hover:bg-bg-elevated md:size-9",
          className,
        )}
      >
        {value || <span className="text-text-muted text-sm">＋</span>}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="start">
        <div role="listbox" aria-label={label} className="grid grid-cols-6 gap-1">
          {emojis.map((e) => (
            <button
              key={e}
              type="button"
              role="option"
              aria-selected={e === value}
              onClick={() => pick(e)}
              className={cn(
                "flex size-11 items-center justify-center rounded-md text-xl hover:bg-bg-elevated md:size-9",
                e === value && "bg-primary/15",
              )}
            >
              {e}
            </button>
          ))}
        </div>
        <form
          className="mt-2 flex items-center gap-2"
          onSubmit={(ev) => {
            ev.preventDefault()
            const e = other.trim()
            if (e) pick(e)
          }}
        >
          <input
            aria-label="Other emoji"
            value={other}
            onChange={(ev) => setOther(ev.target.value)}
            placeholder="Other…"
            maxLength={8}
            className="h-9 min-w-0 flex-1 rounded-md border border-border-default bg-bg-surface px-2 text-sm text-text-primary"
          />
        </form>
      </PopoverContent>
    </Popover>
  )
}

export { DEFAULT_EMOJIS, EmojiPicker, type EmojiPickerProps }
