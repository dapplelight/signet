import { Card, CardContent, CardHeader, CardTitle } from "@dapplelight/signet-ui/components/card"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { meQuery } from "../../lib/api"

export const Route = createFileRoute("/_app/")({
  component: Home,
})

// Your product goes here. Sign-in, account, inbox, privacy, billing and admin
// are already wired; this page is the one that is yours.
function Home() {
  const me = useQuery(meQuery).data
  return (
    <Card>
      <CardHeader>
        <CardTitle>Hello{me?.user.name ? `, ${me.user.name}` : ""}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        <p>
          You are on the <strong className="text-foreground">{me?.plan ?? "…"}</strong> plan.{" "}
          <Link to="/billing" className="underline">
            See plans
          </Link>
        </p>
        <p>
          Replace this page with your product: <code>src/routes/_app/index.tsx</code>, backed by a
          route in <code>api/app.ts</code>.
        </p>
      </CardContent>
    </Card>
  )
}
