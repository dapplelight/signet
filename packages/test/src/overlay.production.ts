/**
 * What a production build gets for `@dapplelight/signet-test/overlay` (the
 * `production` export condition): the same API, rendering nothing, with
 * none of the panel's code.
 */
import type { ReactNode } from "react"
import type { DevOverlayProps } from "./overlay.js"

export type { DevOverlayProps, DevState } from "./overlay.js"

export function DevOverlay(_props: DevOverlayProps): ReactNode {
  return null
}
