"use client"
import { type ReactNode, useEffect, useState } from "react"

/** Renders children after mount. For demos whose server HTML cannot match the client (clock, viewport). */
export function ClientOnly({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return mounted ? children : null
}
