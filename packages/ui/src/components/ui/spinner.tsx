// A loading indicator. role="status" with a name, so screen readers hear
// "Loading" once; the motion stops under prefers-reduced-motion.
import { LoaderCircleIcon } from "lucide-react"
import type * as React from "react"
import { cn } from "../../lib/utils.js"

function Spinner({
  className,
  "aria-label": label = "Loading",
  ...props
}: React.ComponentProps<"svg">) {
  return (
    <LoaderCircleIcon
      data-slot="spinner"
      role="status"
      aria-label={label}
      className={cn("size-4 animate-spin text-text-muted motion-reduce:animate-none", className)}
      {...props}
    />
  )
}

export { Spinner }
