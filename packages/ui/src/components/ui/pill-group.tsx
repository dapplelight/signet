import { cn } from "../../lib/utils.js"

interface PillOption {
  value: string
  label: string
  activeClassName?: string
}

interface PillGroupProps {
  options: PillOption[]
  value: string
  onChange: (value: string) => void
  className?: string
}

function PillGroup({ options, value, onChange, className }: PillGroupProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {options.map((option) => (
        <button
          key={option.value || "__all__"}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-full border px-3 py-1 text-[11px] font-medium transition-colors",
            value === option.value
              ? // Ink on the tint: primary text on its own 15% tint fell to ~4.3:1 (axe, app-a light theme).
                (option.activeClassName ?? "border-primary/40 bg-primary/15 text-text-primary")
              : "border-transparent text-text-muted hover:bg-bg-elevated",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export { PillGroup, type PillOption }
