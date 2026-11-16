import { Card, CardContent, CardHeader, CardTitle } from "@dapplelight/signet-ui/components/card"
import { createFileRoute } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"

// Where the 401 handler in main.tsx sends the user. A placeholder: wire it to
// your own auth (a form posting to your API, an OAuth button) — the template
// deliberately does not pick an auth provider.
export const Route = createFileRoute("/login")({
  component: Login,
})

function Login() {
  const { t } = useTranslation()
  return (
    <Card className="mx-auto max-w-sm">
      <CardHeader>
        <CardTitle>{t("login.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{t("login.body")}</p>
      </CardContent>
    </Card>
  )
}
