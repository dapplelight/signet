"use client"
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
import { Label } from "@dapplelight/signet-ui/components/label"

/** The homepage "Create your account" tile, also the Button and Input composition. */
export function SignUpCardDemo() {
  return (
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
  )
}

export function InputDemo() {
  return (
    <Input className="max-w-sm" type="email" placeholder="name@company.com" aria-label="Email" />
  )
}

export function InputWithLabelDemo() {
  return (
    <div className="grid w-full max-w-sm gap-2">
      <Label htmlFor="invoice-ref">Reference</Label>
      <Input id="invoice-ref" placeholder="PO-20931" />
    </div>
  )
}

export function InputFileDemo() {
  return (
    <div className="grid w-full max-w-sm gap-2">
      <Label htmlFor="receipt">Receipt</Label>
      <Input id="receipt" type="file" />
    </div>
  )
}

export function InputDisabledDemo() {
  return <Input className="max-w-sm" disabled defaultValue="INV-1042" aria-label="Invoice number" />
}

export function InputInvalidDemo() {
  return <Input className="max-w-sm" aria-invalid defaultValue="12/31/26" aria-label="Due date" />
}
