import { Button } from "@dapplelight/signet-ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@dapplelight/signet-ui/components/card"
import { ThemeToggle } from "@dapplelight/signet-ui/components/theme-toggle"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { useEffect, useState } from "react"
import { session, signIn, signOut } from "./lib/auth"

/** null while the stored session loads. */
function useSignedIn(): boolean | null {
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  useEffect(() => {
    session.get().then((t) => setSignedIn(t !== null))
    return session.subscribe((t) => setSignedIn(t !== null))
  }, [])
  return signedIn
}

export function App() {
  const signedIn = useSignedIn()
  const [error, setError] = useState<string>()
  // One flow at a time: a second click would start a second PKCE flow.
  const [busy, setBusy] = useState(false)
  // One webview app, two windows: the small tray window and the main window.
  const compact = getCurrentWindow().label === "tray"

  const run = (fn: () => Promise<void>) => {
    setError(undefined)
    setBusy(true)
    fn()
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false))
  }

  return (
    <main className={compact ? "p-3" : "mx-auto max-w-md p-8"}>
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>__APP_NAME__</CardTitle>
          <ThemeToggle />
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {signedIn === null ? "Loading..." : signedIn ? "Signed in." : "Signed out."}
          </p>
          {signedIn ? (
            <Button variant="outline" disabled={busy} onClick={() => run(signOut)}>
              Sign out
            </Button>
          ) : (
            <Button disabled={signedIn === null || busy} onClick={() => run(signIn)}>
              Sign in with your browser
            </Button>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>
    </main>
  )
}
