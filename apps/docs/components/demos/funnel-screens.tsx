"use client"
import {
  ExpressCheckout,
  type FunnelPageView,
  FunnelQuestion,
  FunnelRedemption,
  WebFunnel,
} from "@dapplelight/signet-ui/screens/funnel-screens"
import { useState } from "react"

const page: FunnelPageView = {
  funnel: {
    key: "fitness-quiz",
    title: "Build your plan",
    questions: [
      {
        id: "goal",
        title: "What is your main goal?",
        options: [
          { value: "strength", label: "Build strength" },
          { value: "weight", label: "Lose weight" },
          { value: "mobility", label: "Move better" },
        ],
      },
    ],
  },
  offering: {
    key: "web-offer",
    version: 1,
    paywall: { title: "Pick your plan", highlight: "pro-annual" },
    products: [
      {
        id: "pro-monthly",
        store: "web",
        plan: "pro",
        interval: "month",
        price: { amount: 1200, currency: "USD" },
      },
      {
        id: "pro-annual",
        store: "web",
        plan: "pro",
        interval: "year",
        price: { amount: 7900, currency: "USD" },
      },
    ],
  },
  discounts: {
    "pro-annual": { valid: true, code: "WELCOME20", off: 20, amount: 6320, currency: "USD" },
  },
}

export function WebFunnelDemo() {
  return (
    <WebFunnel
      className="w-full max-w-xl"
      page={page}
      code="WELCOME20"
      onCheckout={() => undefined}
      display={{ pro: { name: "Pro", features: ["Unlimited workouts", "Meal plans"] } }}
    />
  )
}

export function FunnelQuestionDemo() {
  const [value, setValue] = useState<string | string[]>()
  const question = page.funnel.questions?.[0]
  if (!question) return null
  return (
    <FunnelQuestion
      className="w-full max-w-md"
      question={question}
      value={value}
      onAnswer={setValue}
    />
  )
}

export function FunnelRedemptionDemo() {
  return (
    <FunnelRedemption
      className="w-full max-w-md"
      data={{
        session: { id: "ses_8f2a", status: "paid", plan: "pro" },
        redemption: { link: "https://app.example.com/redeem?t=K7QX-92PD", token: "K7QX-92PD" },
      }}
    />
  )
}

export function ExpressCheckoutDemo() {
  // A stand-in for Stripe.js so the demo needs no network or keys.
  const loadStripe = async () => ({
    elements: () => ({
      create: () => ({
        mount: (el: HTMLElement) => {
          el.textContent = "Payment Element mounts here"
        },
        on: () => undefined,
      }),
      submit: async () => ({}),
    }),
    confirmPayment: async () => ({}),
  })
  return (
    <ExpressCheckout
      className="w-full max-w-md"
      publishableKey="pk_test_example"
      clientSecret="pi_example_secret_example"
      returnUrl="https://example.com/funnel?session=ses_8f2a"
      amount={6320}
      currency="USD"
      loadStripe={loadStripe}
    />
  )
}
