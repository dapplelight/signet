import { cn } from "../../lib/utils.js"

interface KbdProps {
  className?: string
  children?: React.ReactNode
}

function Kbd({ className, children }: KbdProps) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border border-border-default bg-bg-elevated px-1 font-mono text-[10px] leading-none text-text-muted",
        className,
      )}
    >
      {children}
    </kbd>
  )
}

interface KeySequenceProps {
  keys: string | string[]
  className?: string
}

function KeySequence({ keys, className }: KeySequenceProps) {
  const parts = Array.isArray(keys) ? keys : [keys]
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      {parts.map((key, i) => (
        <Kbd key={i}>{key}</Kbd>
      ))}
    </span>
  )
}

export { Kbd, KeySequence }
