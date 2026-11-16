import { DocsLayout } from "fumadocs-ui/layouts/docs"
import { HomeLayout } from "fumadocs-ui/layouts/home"
import { baseOptions } from "@/lib/layout.shared"
import { source } from "@/lib/source"

/**
 * One header everywhere, as on shadcn/ui: the home page's bar (mark, Docs /
 * Components / Packages, search) sits over the docs too, and the docs
 * layout's own bar is off. The sidebar shows the current section.
 */
export default function Layout({ children }: LayoutProps<"/docs">) {
  return (
    <HomeLayout {...baseOptions()}>
      <DocsLayout
        tree={source.getPageTree()}
        {...baseOptions()}
        links={[]}
        nav={{ enabled: false }}
        searchToggle={{ enabled: false }}
        themeSwitch={{ enabled: false }}
        sidebar={{ tabs: false, collapsible: false }}
        containerProps={{ className: "[--fd-nav-height:3.5rem]" }}
      >
        {children}
      </DocsLayout>
    </HomeLayout>
  )
}
