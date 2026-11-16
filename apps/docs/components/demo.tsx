"use client"
import { Component, type ReactNode, useEffect, useState } from "react"
import { DEMOS } from "./demos.generated"

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? (
      <span className="text-sm text-fd-muted-foreground">
        Preview needs app state. See the code below.
      </span>
    ) : (
      this.props.children
    )
  }
}

/** A generated demo, rendered in the browser only, behind an error boundary. */
export function Demo({ name }: { name: string }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const D = DEMOS[name]
  if (!mounted || !D) return null
  return (
    <Boundary>
      <D />
    </Boundary>
  )
}
