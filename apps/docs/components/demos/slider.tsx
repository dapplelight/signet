"use client"

import { Slider } from "@dapplelight/signet-ui/components/slider"
import { useState } from "react"

export function SliderDemo() {
  return <Slider defaultValue={[50]} max={100} step={1} aria-label="Volume" className="max-w-sm" />
}

export function SliderRangeDemo() {
  return <Slider defaultValue={[20, 80]} max={100} step={5} className="max-w-sm" />
}

export function SliderControlledDemo() {
  const [budget, setBudget] = useState([2500])
  return (
    <div className="w-full max-w-sm space-y-3">
      <div className="flex justify-between text-sm">
        <span>Monthly budget</span>
        <span className="font-mono">${budget[0]}</span>
      </div>
      <Slider
        value={budget}
        onValueChange={(v) => setBudget(v as number[])}
        min={500}
        max={5000}
        step={100}
        aria-label="Monthly budget"
      />
    </div>
  )
}

export function SliderDisabledDemo() {
  return <Slider defaultValue={[40]} disabled aria-label="Brightness" className="max-w-sm" />
}

export function SliderVerticalDemo() {
  return (
    <div className="h-40">
      <Slider defaultValue={[60]} orientation="vertical" aria-label="Level" />
    </div>
  )
}
