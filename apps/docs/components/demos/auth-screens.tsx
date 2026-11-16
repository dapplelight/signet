"use client"
import { Button } from "@dapplelight/signet-ui/components/button"
import {
  AuthCard,
  AuthDivider,
  AuthError,
  AuthHeader,
  AuthScreen,
  CodeRequestForm,
  OAuthButtons,
  SessionExpiredScreen,
  VerifyCodeForm,
  VerifyCodeScreen,
} from "@dapplelight/signet-ui/screens/auth-screens"
import { useState } from "react"

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const providers = [{ id: "google", label: "Google" }]

export function AuthScreenDemo() {
  return (
    <AuthScreen
      providers={providers}
      onOAuth={() => wait(500)}
      onRequestCode={() => wait(500)}
      onVerify={async ({ code }) => {
        await wait(400)
        if (code !== "123456") throw new Error("That code is wrong. Try 123456.")
      }}
      footer={
        <p className="text-center text-xs text-neutral-500">By continuing you accept the terms.</p>
      }
    />
  )
}

export function VerifyCodeScreenDemo() {
  return (
    <VerifyCodeScreen
      channel="phone"
      to="+91******3210"
      onBack={() => undefined}
      onVerify={async (code) => {
        await wait(400)
        if (code !== "123456") throw new Error("That code is wrong. Try 123456.")
      }}
      onResend={() => wait(300)}
      resendAfterSeconds={10}
    />
  )
}

export function SessionExpiredScreenDemo() {
  const [clicks, setClicks] = useState(0)
  return (
    <div className="flex flex-col gap-2">
      <SessionExpiredScreen onSignIn={() => setClicks((n) => n + 1)} />
      <p className="text-center text-xs text-neutral-500">Sign-in requested {clicks} times</p>
    </div>
  )
}

export function CodeRequestFormDemo() {
  return (
    <div className="w-full max-w-sm">
      <CodeRequestForm channel="email" onSubmit={() => wait(500)} />
    </div>
  )
}

export function VerifyCodeFormDemo() {
  return (
    <div className="w-full max-w-sm">
      <VerifyCodeForm
        length={4}
        resendAfterSeconds={0}
        onVerify={async (code) => {
          await wait(300)
          if (code !== "1234") throw new Error("Try 1234.")
        }}
        onResend={() => wait(300)}
      />
    </div>
  )
}

export function OAuthButtonsDemo() {
  return (
    <div className="w-full max-w-sm">
      <OAuthButtons
        providers={[
          { id: "google", label: "Google" },
          { id: "github", label: "GitHub" },
        ]}
        onSelect={() => wait(800)}
      />
    </div>
  )
}

export function AuthPartsDemo() {
  return (
    <AuthCard>
      <AuthHeader title="Join Acme" description="Create a workspace for your team." />
      <Button size="lg">Continue with email</Button>
      <AuthDivider>or</AuthDivider>
      <Button size="lg" variant="outline">
        Use single sign-on
      </Button>
      <AuthError>That email is already registered.</AuthError>
    </AuthCard>
  )
}
