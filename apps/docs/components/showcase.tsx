"use client"
import { Alert, AlertDescription, AlertTitle } from "@dapplelight/signet-ui/components/alert"
import { Avatar, AvatarFallback } from "@dapplelight/signet-ui/components/avatar"
import { Badge } from "@dapplelight/signet-ui/components/badge"
import { Button } from "@dapplelight/signet-ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@dapplelight/signet-ui/components/card"
import { Input } from "@dapplelight/signet-ui/components/input"
import { Kbd } from "@dapplelight/signet-ui/components/kbd"
import { Label } from "@dapplelight/signet-ui/components/label"
import { Progress } from "@dapplelight/signet-ui/components/progress"
import { Switch } from "@dapplelight/signet-ui/components/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@dapplelight/signet-ui/components/tabs"

/** Live Signet components with realistic content, like the shadcn/ui home page. */
export function Showcase() {
  return (
    <div className="grid gap-4 text-left text-foreground md:grid-cols-2 lg:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle>Create your account</CardTitle>
          <CardDescription>Sign in with a magic link. No password.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          <Label htmlFor="sc-email">Email</Label>
          <Input id="sc-email" type="email" placeholder="priya.raghunathan@example.com" />
        </CardContent>
        <CardFooter>
          <Button className="w-full">Send magic link</Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Monthly revenue</CardTitle>
          <CardDescription>October 2026</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="text-3xl font-semibold tracking-tight">₹4,82,15,300</div>
          <div className="flex gap-2">
            <Badge>+12.4%</Badge>
            <Badge variant="outline">1,284 subscriptions</Badge>
          </div>
          <Progress value={72} />
          <p className="text-sm text-text-muted">72% of the quarterly target</p>
        </CardContent>
      </Card>

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

      <div className="grid gap-4">
        <Alert>
          <AlertTitle>Deploy succeeded</AlertTitle>
          <AlertDescription>production · 41s · commit 9f3c2e1</AlertDescription>
        </Alert>
        <Alert variant="destructive">
          <AlertTitle>Card declined</AlertTitle>
          <AlertDescription>Ask the customer for another payment method.</AlertDescription>
        </Alert>
      </div>
    </div>
  )
}
