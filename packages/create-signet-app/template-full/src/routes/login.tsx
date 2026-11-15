import { AuthScreen } from "@dapplelight/signet-ui/screens/auth-screens"
import { createFileRoute } from "@tanstack/react-router"
import { api } from "../lib/api"

// Phone one-time-code sign-in against api/routes/auth.ts. In development the
// code is printed in the API's console. Add email or OAuth through
// AuthScreen's `channels` and `providers` once the API has them.
export const Route = createFileRoute("/login")({
  component: Login,
})

function Login() {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <AuthScreen
        channels={["phone"]}
        hideModeSwitch
        labels={{ signInTitle: "Sign in to __APP_NAME__" }}
        onRequestCode={async ({ to }) => {
          await api.auth.otp.$post({ json: { phone: to } })
        }}
        onVerify={async ({ to, code }) => {
          await api.auth.verify.$post({ json: { phone: to, code } })
          // A full load, so no query from before sign-in survives.
          window.location.assign("/")
        }}
      />
    </main>
  )
}
