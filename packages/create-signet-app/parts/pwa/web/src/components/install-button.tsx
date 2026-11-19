import { Button } from "@dapplelight/signet-ui/components/button"
import { useSyncExternalStore } from "react"
import { canInstall, install, subscribeInstall } from "../lib/pwa"

/** "Install app", while the browser offers to install it. */
export function InstallButton() {
  const available = useSyncExternalStore(subscribeInstall, canInstall)
  if (!available) return null
  return (
    <Button variant="outline" size="sm" onClick={() => void install()}>
      Install app
    </Button>
  )
}
