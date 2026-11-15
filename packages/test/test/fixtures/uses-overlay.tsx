// An app entry for the production-strip check in test/overlay.tsx: imports
// the package by name, so the build resolves it through the exports map.
import { DevOverlay } from "@dapplelight/signet-test/overlay"

export const App = () => <DevOverlay />
