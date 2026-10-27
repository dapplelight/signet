import { type ClassValue, clsx } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * The semantic type ramp from `@dapplelight/signet-tokens` CONTRACT.md
 * (`--text-caption` … `--text-stat`), as utility suffixes.
 *
 * Plain twMerge does not know these are sizes, so it files `text-subhead` under
 * text colour and `cn("text-subhead", "text-text-primary")` silently dropped the
 * size. Registering them as the font-size group fixes both directions.
 */
export const TYPE_RAMP = [
  "caption",
  "label",
  "body",
  "callout",
  "subhead",
  "headline",
  "title",
  "display",
  "hero",
  "stat",
] as const

const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: [...TYPE_RAMP] }] } },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
