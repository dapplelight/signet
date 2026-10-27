import { Monitor, Moon, Sun } from "lucide-react"
import { cn } from "../../lib/utils.js"
import { type Theme, useTheme } from "./theme-provider.js"

const OPTIONS: Array<{ value: Theme; label: string; Icon: typeof Sun }> = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
]

/**
 * Three-way segmented control. Shows "system" explicitly rather than hiding it.
 * Icon-only by default, for headers; `showLabels` shows "Light"/"Dark"/"System"
 * beside each icon — for a settings page, whose whole job is this choice.
 */
export function ThemeToggle({
  className,
  showLabels = false,
}: {
  className?: string
  showLabels?: boolean
}) {
  const { theme, setTheme } = useTheme()
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn("inline-flex items-center gap-0.5 rounded-lg bg-muted p-0.5", className)}
    >
      {OPTIONS.map(({ value, label, Icon }) => (
        // biome-ignore lint/a11y/useSemanticElements: a segmented control of buttons with role="radio" and aria-checked; native radios cannot be styled this way
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          aria-label={showLabels ? undefined : label}
          onClick={() => setTheme(value)}
          className={cn(
            "inline-flex items-center justify-center rounded-md transition-colors",
            showLabels ? "h-8 gap-1.5 px-3 text-sm" : "size-7",
            "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
            theme === value
              ? "bg-background text-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="size-4" aria-hidden />
          {showLabels && <span>{label}</span>}
        </button>
      ))}
    </div>
  )
}

/** Single button that flips light/dark. For tight headers. */
export function ThemeToggleButton({ className }: { className?: string }) {
  const { resolvedTheme, toggleTheme } = useTheme()
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${resolvedTheme === "dark" ? "light" : "dark"} theme`}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-md text-muted-foreground",
        "transition-colors hover:bg-muted hover:text-foreground",
        "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
        className,
      )}
    >
      {resolvedTheme === "dark" ? <Moon className="size-4" /> : <Sun className="size-4" />}
    </button>
  )
}
