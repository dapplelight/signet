import { Badge } from "@dapplelight/signet-ui/components/badge"
import { Button } from "@dapplelight/signet-ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@dapplelight/signet-ui/components/card"
import { createFileRoute } from "@tanstack/react-router"
import { toast } from "sonner"

export const Route = createFileRoute("/")({
  component: Home,
})

function Home() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Running on the __THEME__ theme</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        <Button onClick={() => toast.success("Saved")}>Show a toast</Button>
        <Button variant="outline">Outline</Button>
        <Badge>Badge</Badge>
        <p className="w-full text-sm text-muted-foreground">
          Swap the theme import in <code>src/app.css</code> and everything here reshapes — colour,
          radius, type scale and motion. No component changes.
        </p>
      </CardContent>
    </Card>
  )
}
