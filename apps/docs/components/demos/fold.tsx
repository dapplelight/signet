"use client"
import { Fold } from "@dapplelight/signet-ui/components/fold"

export const BUILDER_NOTES = `Changed \`packages/ui\` only.

- Added the **Fold** component and its tests
- Reused \`Markdown\` for the body, so links and lists render safely
- Left every existing component as it was

Run \`bun run test\` in \`packages/ui\` to check it.`

export function FoldDemo() {
  return (
    <div className="w-full max-w-xl">
      <Fold title="Builder notes" detail="12 lines, written by the builder">
        {BUILDER_NOTES}
      </Fold>
    </div>
  )
}

export function FoldOpenDemo() {
  return (
    <div className="w-full max-w-xl">
      <Fold title="Builder notes" detail="12 lines, written by the builder" defaultOpen>
        {BUILDER_NOTES}
      </Fold>
    </div>
  )
}

export function FoldCopyDemo() {
  return (
    <div className="w-full max-w-xl">
      <Fold
        title="Release notes"
        detail="written by the team"
        showMoreLabel="Read on"
        showLessLabel="Fold up"
        classNames={{ detail: "italic" }}
      >
        {BUILDER_NOTES}
      </Fold>
    </div>
  )
}
