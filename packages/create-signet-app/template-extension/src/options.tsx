import { Button } from "@dapplelight/signet-ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@dapplelight/signet-ui/components/card"
import { ThemeProvider } from "@dapplelight/signet-ui/components/theme-provider"
import { ThemeToggle } from "@dapplelight/signet-ui/components/theme-toggle"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { useAuth } from "./lib/use-auth"
import "./app.css"

function Options() {
  const { signedIn, error, signIn, signOut } = useAuth()
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Follows your system unless you pick one.</CardDescription>
        </CardHeader>
        <CardContent>
          <ThemeToggle showLabels />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-3">
          {signedIn === null ? null : signedIn ? (
            <Button variant="outline" onClick={signOut}>
              Sign out
            </Button>
          ) : (
            <Button onClick={signIn}>Sign in</Button>
          )}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>
    </main>
  )
}

const root = document.getElementById("root")
if (!root) throw new Error("#root not found in options.html")
createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <Options />
    </ThemeProvider>
  </StrictMode>,
)
