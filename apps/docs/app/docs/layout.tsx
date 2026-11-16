import { DocsLayout } from "fumadocs-ui/layouts/notebook"
import { baseOptions } from "@/lib/layout.shared"
import { source } from "@/lib/source"

/** shadcn-style: a top bar with the section tabs, a flat sidebar under it. */
export default function Layout({ children }: LayoutProps<"/docs">) {
  return (
    <DocsLayout
      tree={source.getPageTree()}
      {...baseOptions()}
      tabMode="navbar"
      nav={{ ...baseOptions().nav, mode: "top" }}
    >
      {children}
    </DocsLayout>
  )
}
