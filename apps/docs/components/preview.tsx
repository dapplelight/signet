import { Tab, Tabs } from "fumadocs-ui/components/tabs"
import { Children, type ReactNode } from "react"

/**
 * shadcn-style Preview / Code tabs. Write the live demo, then a fenced code
 * block, as children; the last child becomes the Code tab.
 */
export function Preview({ children }: { children: ReactNode }) {
  const parts = Children.toArray(children)
  const code = parts.pop()
  return (
    <Tabs items={["Preview", "Code"]}>
      <Tab value="Preview">
        <div className="not-prose flex min-h-40 flex-wrap items-center justify-center gap-3 rounded-lg bg-background p-8 text-foreground">
          {parts}
        </div>
      </Tab>
      <Tab value="Code">{code}</Tab>
    </Tabs>
  )
}
