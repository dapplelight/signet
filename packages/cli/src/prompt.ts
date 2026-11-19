/**
 * The clack look for commands a person runs at a terminal. Everything here is
 * gated on `interactive`: off a TTY (agents, CI, pipes) and with --json the
 * output and exit codes stay exactly what they were.
 */

import { cancel, isCancel } from "@clack/prompts"

export { autocompleteMultiselect, intro, outro, select, spinner, text } from "@clack/prompts"

/** A person at a terminal, not a pipe, and not asking for JSON. */
export const interactive = (json = false) =>
  !json && !!process.stdin.isTTY && !!process.stdout.isTTY

/** The answer, or on Ctrl+C a "Cancelled." line and exit 130. */
export async function ask<T>(prompt: Promise<T>): Promise<Exclude<T, symbol>> {
  const v = await prompt
  if (isCancel(v)) {
    cancel("Cancelled.")
    process.exit(130)
  }
  return v as Exclude<T, symbol>
}
