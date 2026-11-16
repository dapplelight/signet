"use client"
import {
  AnswerHeadline,
  type AnswerHeadlineData,
} from "@dapplelight/signet-ui/components/answer-headline"
import { Button } from "@dapplelight/signet-ui/components/button"

const onTrack: AnswerHeadlineData = {
  question: "Are we on track this month?",
  sentence: ["Yes. Revenue is ", { value: 48200 }, ", ", { value: 12 }, "% ahead of plan."],
  detail: ["Last month closed at ", { value: 43000 }, "."],
  tone: "good",
}

const atRisk: AnswerHeadlineData = {
  question: "Can we cover payroll?",
  sentence: ["Cash covers payroll for ", { value: 5 }, " more weeks."],
  detail: ["Runway shortens if the Acme renewal slips past 30 Nov."],
  tone: "warn",
}

const plain: AnswerHeadlineData = {
  question: "How many people signed up this week?",
  sentence: [{ value: 342 }, " new accounts."],
  tone: "neutral",
}

const money = (n: number) => `$${n.toLocaleString()}`

export function AnswerHeadlineDemo() {
  return (
    <AnswerHeadline
      className="w-full max-w-lg"
      headline={onTrack}
      renderValue={(n) => n.toLocaleString()}
    />
  )
}

export function AnswerHeadlineWarnDemo() {
  return <AnswerHeadline className="w-full max-w-lg" headline={atRisk} />
}

export function AnswerHeadlineNeutralDemo() {
  return <AnswerHeadline className="w-full max-w-lg" headline={plain} />
}

export function AnswerHeadlineRenderValueDemo() {
  return <AnswerHeadline className="w-full max-w-lg" headline={onTrack} renderValue={money} />
}

export function AnswerHeadlineChildrenDemo() {
  return (
    <AnswerHeadline
      className="w-full max-w-lg"
      headline={plain}
      renderValue={(n) => n.toLocaleString()}
    >
      <div className="flex gap-2">
        <Button size="sm" variant="outline">
          Week
        </Button>
        <Button size="sm" variant="ghost">
          Month
        </Button>
      </div>
    </AnswerHeadline>
  )
}
