import { Badge } from "@dapplelight/signet-ui/components/badge"
import { Button } from "@dapplelight/signet-ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@dapplelight/signet-ui/components/card"
import { createFileRoute } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

export const Route = createFileRoute("/")({
  component: Home,
})

function Home() {
  const { t } = useTranslation()
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("home.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        <Button onClick={() => toast.success(t("home.saved"))}>{t("home.showToast")}</Button>
        <Button variant="outline">{t("home.outline")}</Button>
        <Badge>{t("home.badge")}</Badge>
        <p className="w-full text-sm text-muted-foreground">{t("home.themeHint")}</p>
      </CardContent>
    </Card>
  )
}
