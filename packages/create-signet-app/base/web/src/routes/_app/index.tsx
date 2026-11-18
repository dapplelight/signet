import { Card, CardContent, CardHeader, CardTitle } from "@dapplelight/signet-ui/components/card"
import { useQuery } from "@tanstack/react-query" // @auth
import { createFileRoute, Link } from "@tanstack/react-router" // @payments
import { createFileRoute } from "@tanstack/react-router" // @!payments
import { meQuery } from "../../lib/api" // @auth

export const Route = createFileRoute("/_app/")({
  component: Home,
})

// Your product goes here. The other pages are already wired; this one is
// yours.
function Home() {
  // auth:begin
  const me = useQuery(meQuery).data
  return (
    <Card>
      <CardHeader>
        <CardTitle>Hello{me?.user.name ? `, ${me.user.name}` : ""}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        {/* payments:begin */}
        <p>
          You are on the <strong className="text-foreground">{me?.plan ?? "…"}</strong> plan.{" "}
          <Link to="/billing" className="underline">
            See plans
          </Link>
        </p>
        {/* payments:end */}
        <p>
          Replace this page with your product: <code>src/routes/_app/index.tsx</code>, backed by a
          route in <code>api/app.ts</code>. {/* @api */}
          route in your API. {/* @!api */}
        </p>
      </CardContent>
    </Card>
  )
  // auth:end
  // !auth:begin
  return (
    <Card>
      <CardHeader>
        <CardTitle>Hello</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        <p>
          Replace this page with your product: <code>src/routes/_app/index.tsx</code>, backed by a
          route in <code>api/app.ts</code>. {/* @api */}
          route in your API. {/* @!api */}
        </p>
      </CardContent>
    </Card>
  )
  // !auth:end
}
