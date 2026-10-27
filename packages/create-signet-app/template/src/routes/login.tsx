import { Card, CardContent, CardHeader, CardTitle } from "@dapplelight/signet-ui/components/card"
import { createFileRoute } from "@tanstack/react-router"

// Where the 401 handler in main.tsx sends the user. A placeholder: wire it to
// your own auth (a form posting to your API, an OAuth button) — the template
// deliberately does not pick an auth provider.
export const Route = createFileRoute("/login")({
  component: Login,
})

function Login() {
  return (
    <Card className="mx-auto max-w-sm">
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Your session has ended or you are not signed in. Replace this page with your sign-in flow.
        </p>
      </CardContent>
    </Card>
  )
}
