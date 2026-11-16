import { ansi } from "@dapplelight/signet-tokens/ansi"

/** Colour only on a terminal, and never when NO_COLOR is set (https://no-color.org). */
const on = process.stdout.isTTY === true && !process.env.NO_COLOR
const theme = on
  ? ansi("editorial", {
      mode: "dark",
      depth: /truecolor|24bit/.test(process.env.COLORTERM ?? "") ? "truecolor" : "256",
    })
  : undefined
const paint = (token: string) => (s: string) => theme?.fg[token]?.(s) ?? s

export const ok = paint("accentGreen")
export const fail = paint("accentRed")
export const link = paint("accentBlue")
export const dim = paint("textMuted")
