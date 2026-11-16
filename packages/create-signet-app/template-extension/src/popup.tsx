import { Button } from "@dapplelight/signet-ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@dapplelight/signet-ui/components/card"
import { ThemeProvider } from "@dapplelight/signet-ui/components/theme-provider"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { useAuth } from "./lib/use-auth"
import "./app.css"

function Popup() {
  const { signedIn, error, signIn, signOut } = useAuth()
  return (
    <Card className="w-72 rounded-none border-0">
      <CardHeader>
        <CardTitle>__APP_NAME__</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {signedIn === null ? null : signedIn ? (
          <>
            <p className="text-sm text-muted-foreground">You are signed in.</p>
            <Button variant="outline" onClick={() => chrome.runtime.openOptionsPage()}>
              Options
            </Button>
            <Button variant="outline" onClick={signOut}>
              Sign out
            </Button>
          </>
        ) : (
          <Button onClick={signIn}>Sign in</Button>
        )}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  )
}

const root = document.getElementById("root")
if (!root) throw new Error("#root not found in popup.html")
createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <Popup />
    </ThemeProvider>
  </StrictMode>,
)
