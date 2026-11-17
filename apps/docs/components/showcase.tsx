"use client"
import { Avatar, AvatarFallback } from "@dapplelight/signet-ui/components/avatar"
import { Badge } from "@dapplelight/signet-ui/components/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@dapplelight/signet-ui/components/card"
import { Kbd } from "@dapplelight/signet-ui/components/kbd"
import { Switch } from "@dapplelight/signet-ui/components/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@dapplelight/signet-ui/components/tabs"
import Link from "next/link"
import { Fragment, type ReactNode } from "react"
import { AlertStackDemo } from "./demos/alert"
import { RevenueCardDemo } from "./demos/card"
import { SignUpCardDemo } from "./demos/input"

/**
 * A showcase tile plus a row of links to the docs of the components in it.
 * The tile itself is never a link: it holds inputs and switches.
 */
function Tile({
  links,
  className = "",
  children,
}: {
  links: string[]
  className?: string
  children: ReactNode
}) {
  return (
    <div className={`mb-4 flex break-inside-avoid flex-col gap-2 ${className}`}>
      {children}
      <p className="text-sm text-fd-muted-foreground">
        {links.map((name, i) => (
          <Fragment key={name}>
            {i > 0 && " · "}
            <Link
              href={`/docs/components/${name.toLowerCase()}`}
              className="inline-block py-0.5 hover:text-fd-foreground hover:underline"
            >
              {name}
            </Link>
          </Fragment>
        ))}
      </p>
    </div>
  )
}

/** Live Signet components with realistic content, like the shadcn/ui home page. */
export function Showcase() {
  return (
    <div className="columns-1 gap-4 text-left text-foreground md:columns-2 lg:columns-3">
      <Tile links={["Card", "Label", "Input", "Button"]}>
        <SignUpCardDemo />
      </Tile>

      <Tile links={["Card", "Badge", "Progress"]}>
        <RevenueCardDemo />
      </Tile>

      <Tile links={["Card", "Switch"]}>
        <Card>
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
            <CardDescription>Choose what reaches you.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {[
              ["Payment failed", true],
              ["New team member", true],
              ["Weekly digest", false],
            ].map(([label, on]) => (
              <div key={label as string} className="flex items-center justify-between">
                <span className="text-sm">{label}</span>
                <Switch defaultChecked={on as boolean} />
              </div>
            ))}
          </CardContent>
        </Card>
      </Tile>

      <Tile links={["Card", "Avatar", "Badge"]} className="max-md:hidden">
        <Card>
          <CardHeader>
            <CardTitle>Team</CardTitle>
            <CardDescription>3 members, 1 invite pending</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {[
              ["AK", "Arjun Krishnamurthy", "Owner"],
              ["ML", "Mei Lin", "Admin"],
              ["OS", "Oluwaseun Adebayo-Smith", "Member"],
            ].map(([i, name, role]) => (
              <div key={name} className="flex items-center gap-3">
                <Avatar>
                  <AvatarFallback>{i}</AvatarFallback>
                </Avatar>
                <span className="flex-1 truncate text-sm">{name}</span>
                <Badge variant="secondary">{role}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </Tile>

      <Tile links={["Card", "Kbd", "Tabs"]} className="max-md:hidden">
        <Card>
          <CardHeader>
            <CardTitle>API keys</CardTitle>
            <CardDescription>
              Press <Kbd>⌘</Kbd> <Kbd>K</Kbd> to search
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="live">
              <TabsList>
                <TabsTrigger value="live">Live</TabsTrigger>
                <TabsTrigger value="test">Test</TabsTrigger>
              </TabsList>
              <TabsContent value="live" className="pt-3 font-mono text-sm">
                sk_live_••••••••3f9a
              </TabsContent>
              <TabsContent value="test" className="pt-3 font-mono text-sm">
                sk_test_••••••••b21c
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </Tile>

      <Tile links={["Alert"]} className="max-md:hidden">
        <AlertStackDemo />
      </Tile>
    </div>
  )
}
