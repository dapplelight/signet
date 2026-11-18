import { useTheme } from "@dapplelight/signet-ui/components/theme-provider"
import { Toaster as Sonner, type ToasterProps } from "sonner"

// sonner draws its own surface. These point it at the theme's popover tokens
// and follow the light/dark choice, so a toast reshapes with the theme like
// every other component. Call `toast()` from "sonner" anywhere.
const TOKENS =
  "[--normal-bg:var(--color-popover)] [--normal-text:var(--color-popover-foreground)] [--normal-border:var(--color-border)] [--border-radius:var(--radius-lg)]"

export function Toaster(props: ToasterProps) {
  const { resolvedTheme } = useTheme()
  return <Sonner theme={resolvedTheme} className={TOKENS} {...props} />
}
