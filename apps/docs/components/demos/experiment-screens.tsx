"use client"
import {
  ExperimentForm,
  ExperimentList,
  ExperimentResults,
  type ExperimentResultsView,
  type ExperimentView,
  PricingExperimentResults,
  type PricingReadoutView,
} from "@dapplelight/signet-ui/screens/experiment-screens"
import { useState } from "react"

const experiments: ExperimentView[] = [
  {
    key: "onboarding-checklist",
    description: "Checklist on the first screen",
    status: "running",
    goal: "activated",
    variants: [
      { key: "control", weight: 50 },
      { key: "checklist", weight: 50 },
    ],
  },
  {
    key: "annual-first-paywall",
    status: "draft",
    goal: "subscribed",
    variants: [
      { key: "monthly-first", weight: 50 },
      { key: "annual-first", weight: 50 },
    ],
  },
  {
    key: "dark-signup",
    status: "rolled_out",
    goal: "signed_up",
    winner: "dark",
    variants: [
      { key: "light", weight: 50 },
      { key: "dark", weight: 50 },
    ],
  },
]

const results: ExperimentResultsView = {
  goal: "activated",
  alpha: 0.05,
  control: "control",
  variants: [
    {
      key: "control",
      exposed: 1840,
      converted: 312,
      rate: 0.1696,
      lift: null,
      pValue: null,
      significant: false,
    },
    {
      key: "checklist",
      exposed: 1822,
      converted: 391,
      rate: 0.2146,
      lift: 0.2653,
      pValue: 0.0007,
      significant: true,
    },
  ],
}

export function ExperimentListDemo() {
  const [selected, setSelected] = useState("onboarding-checklist")
  return (
    <ExperimentList
      className="w-full max-w-xl"
      experiments={experiments}
      selected={selected}
      onSelect={setSelected}
    />
  )
}

export function ExperimentResultsDemo() {
  return (
    <ExperimentResults
      className="w-full max-w-3xl"
      experiment={experiments[0]}
      results={results}
      onStop={() => undefined}
      onRollout={() => undefined}
    />
  )
}

export function ExperimentFormDemo() {
  return (
    <ExperimentForm
      className="w-full max-w-xl"
      experiment={experiments[1]}
      onSubmit={() => true}
      onStart={() => undefined}
    />
  )
}

export function PricingExperimentResultsDemo() {
  const readout: PricingReadoutView = {
    placements: ["onboarding"],
    alpha: 0.05,
    control: "monthly-first",
    variants: [
      {
        key: "monthly-first",
        offering: { offering: "pro-monthly" },
        exposed: 2400,
        converted: 168,
        rate: 0.07,
        lift: null,
        pValue: null,
        significant: false,
        trials: 410,
        trialConverted: 120,
        trialConversion: 0.29,
        revenue: { USD: 167832 },
        revenuePerExposed: { USD: 70 },
        ltv: { estimate: true, perCurrency: { USD: 5400 }, churn: 0.08, expectedPayments: 12 },
      },
      {
        key: "annual-first",
        offering: { offering: "pro-annual" },
        exposed: 2380,
        converted: 214,
        rate: 0.09,
        lift: 0.2857,
        pValue: 0.011,
        significant: true,
        trials: 430,
        trialConverted: 150,
        trialConversion: 0.35,
        revenue: { USD: 256800 },
        revenuePerExposed: { USD: 108 },
        ltv: { estimate: true, perCurrency: { USD: 6200 }, churn: 0.06, expectedPayments: 16 },
      },
    ],
  }
  return (
    <PricingExperimentResults
      className="w-full max-w-4xl"
      experiment={{ ...experiments[1], status: "running" }}
      readout={readout}
      onRollout={() => undefined}
      onStop={() => undefined}
    />
  )
}
