"use client"
import {
  CustomerCenter,
  CustomerTimeline,
  PromotionalGrantForm,
  type RemoteOffering,
  RemotePaywall,
} from "@dapplelight/signet-ui/screens/monetisation-screens"

const offering: RemoteOffering = {
  key: "main",
  version: 3,
  paywall: {
    title: "Go further with Pro",
    subtitle: "Cancel anytime.",
    plans: ["starter", "pro"],
    highlight: "pro",
    badge: "Best value",
    trial: "7-day free trial",
  },
  products: [
    {
      id: "starter-month",
      store: "web",
      plan: "starter",
      interval: "month",
      price: { amount: 900, currency: "USD" },
    },
    {
      id: "pro-month",
      store: "web",
      plan: "pro",
      interval: "month",
      price: { amount: 1900, currency: "USD" },
    },
    {
      id: "pro-year",
      store: "web",
      plan: "pro",
      interval: "year",
      price: { amount: 15900, currency: "USD" },
    },
  ],
}

export function RemotePaywallDemo() {
  return (
    <RemotePaywall
      offering={offering}
      display={{
        starter: { name: "Starter", features: ["5 projects", "Email support"] },
        pro: { name: "Pro", features: ["Unlimited projects", "Priority support", "API access"] },
      }}
      onPurchase={() => undefined}
      onImpression={() => undefined}
    />
  )
}

export function CustomerCenterDemo() {
  return (
    <CustomerCenter
      className="w-full max-w-xl"
      overview={{
        plan: "pro",
        status: "active",
        currentPeriodEnd: "2026-12-14",
        renews: true,
        source: { gateway: "stripe", subscriptionId: "sub_1042" },
        store: false,
        manageUrl: null,
        canCancel: true,
        retention: { kind: "discount", percent: 30, months: 3 },
      }}
      onCancel={() => true}
      onAcceptRetention={() => true}
      onRequestRefund={() => true}
      onContactSupport={() => true}
    />
  )
}

export function CustomerTimelineDemo() {
  return (
    <CustomerTimeline
      className="w-full max-w-xl"
      entries={[
        {
          id: "1",
          kind: "payment",
          gateway: "stripe",
          eventType: "payment_succeeded",
          amount: 1900,
          currency: "USD",
          occurredAt: "2026-11-14T08:00:00Z",
        },
        {
          id: "2",
          kind: "subscription",
          gateway: "stripe",
          eventType: "subscription_renewed",
          subscriptionId: "sub_1042",
          occurredAt: "2026-11-14T08:00:00Z",
        },
        {
          id: "3",
          kind: "payment",
          gateway: "appstore",
          eventType: "payment_succeeded",
          amount: 1900,
          currency: "USD",
          approximate: true,
          occurredAt: "2026-10-14T08:00:00Z",
        },
        {
          id: "4",
          kind: "refund",
          gateway: "stripe",
          eventType: "refund_request",
          amount: 1900,
          currency: "USD",
          occurredAt: "2026-09-20T11:30:00Z",
        },
      ]}
      totals={[{ currency: "USD", paid: 5700, refunded: 1900, approximate: true }]}
    />
  )
}

export function PromotionalGrantFormDemo() {
  return (
    <PromotionalGrantForm
      className="w-full max-w-sm"
      plans={["starter", "pro"]}
      defaultDays={14}
      onGrant={() => true}
    />
  )
}
