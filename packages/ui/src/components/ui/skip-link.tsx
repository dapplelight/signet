import { useLabels } from "../../lib/labels.js"
import { cn } from "../../lib/utils.js"

interface SkipLinkProps extends React.ComponentProps<"a"> {
  /** id of the main content, without `#`. Give that element `tabIndex={-1}` so focus lands on it. */
  target?: string
}

/** "Skip to content" link: hidden until focused with Tab, jumps past the header and nav. Render it first in the layout. */
function SkipLink({ target = "main", className, children, ...props }: SkipLinkProps) {
  const l = useLabels()
  return (
    <a
      data-slot="skip-link"
      href={`#${target}`}
      className={cn(
        "sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-bg-elevated focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-md focus:outline-none focus:ring-3 focus:ring-ring",
        className,
      )}
      {...props}
    >
      {children ?? l.skipToContent}
    </a>
  )
}

export { SkipLink }
