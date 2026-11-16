"use client"
import { Button } from "@dapplelight/signet-ui/components/button"
import { MetricHeadline } from "@dapplelight/signet-ui/components/metric-headline"
import { MaskToggle, PrivacyMaskProvider } from "@dapplelight/signet-ui/components/privacy-mask"

export function MetricHeadlineDemo() {
  return (
    <div className="w-full max-w-sm">
      <MetricHeadline label="Signups" result={{ current: 1240, previous: 1050 }} />
    </div>
  )
}

export function MetricHeadlineDownDemo() {
  return (
    <div className="grid w-full max-w-md gap-3">
      <MetricHeadline
        label="Revenue"
        period="this month"
        result={{ current: 38200, previous: 41500 }}
      />
      <MetricHeadline
        label="Failed payments"
        period="this month"
        goodWhen="down"
        result={{ current: 12, previous: 30 }}
      />
    </div>
  )
}

export function MetricHeadlineStatesDemo() {
  return (
    <div className="grid w-full max-w-md gap-3">
      <MetricHeadline label="Active users" result={{ current: 820, previous: 818 }} />
      <MetricHeadline label="New trials" result={{ current: 64, previous: null }} />
    </div>
  )
}

export function MetricHeadlineCopyDemo() {
  return (
    <div className="w-full max-w-sm">
      <MetricHeadline
        label="Orders"
        period="today"
        format={(n) => `${n} orders`}
        copy={{ up: (c) => `${c.value}, ${c.percent} more than yesterday` }}
        result={{ current: 212, previous: 180 }}
      >
        <Button variant="link" size="sm" className="self-start px-0">
          View orders
        </Button>
      </MetricHeadline>
    </div>
  )
}

export function MetricHeadlineMaskedDemo() {
  return (
    <PrivacyMaskProvider storageKey={false} defaultMasked>
      <div className="flex w-full max-w-sm flex-col items-start gap-3">
        <MaskToggle />
        <MetricHeadline
          label="Revenue"
          period="this month"
          result={{ current: 38200, previous: 31000 }}
        />
      </div>
    </PrivacyMaskProvider>
  )
}
