"use client"
import { LogoStack } from "@dapplelight/signet-ui/components/logo-stack"

/** A small SVG mark as a data URI, so the demos need no network. A real app passes its own URLs. */
function mark(letter: string, fill: string, glyph = "#ffffff") {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="${fill}"/><text x="16" y="22.5" font-family="sans-serif" font-size="18" font-weight="700" text-anchor="middle" fill="${glyph}">${letter}</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/** A dark glyph on a transparent background: invisible on a dark page without a light tile. */
function darkMark(letter: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><text x="16" y="24" font-family="sans-serif" font-size="26" font-weight="800" text-anchor="middle" fill="#111111">${letter}</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

const projects = [
  { src: mark("A", "#2563eb"), alt: "Acme Billing" },
  { src: mark("G", "#059669"), alt: "Globex Mobile" },
  { src: mark("H", "#d97706"), alt: "Hooli Search" },
]

const many = [
  ...projects,
  { src: mark("I", "#7c3aed"), alt: "Initech Reports" },
  { src: mark("U", "#dc2626"), alt: "Umbrella Docs" },
  { src: mark("S", "#0891b2"), alt: "Stark Console" },
]

const mixed = [
  { src: darkMark("N"), alt: "Northwind Ledger", lightTile: true },
  { src: mark("G", "#059669"), alt: "Globex Mobile" },
  { src: darkMark("V"), alt: "Vandelay Import", lightTile: true },
]

export function LogoStackDemo() {
  return <LogoStack marks={projects} />
}

export function LogoStackMoreDemo() {
  return <LogoStack marks={many} />
}

export function LogoStackDarkMarksDemo() {
  return <LogoStack marks={mixed} />
}

export function LogoStackSizesDemo() {
  return (
    <div className="flex flex-col items-start gap-4">
      <LogoStack size="sm" marks={many} />
      <LogoStack marks={many} />
      <LogoStack size="lg" marks={many} />
    </div>
  )
}
