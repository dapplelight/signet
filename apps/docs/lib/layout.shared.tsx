import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared"
import { Mark } from "@/components/mark"
import { appName, gitConfig } from "./shared"

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="flex items-center gap-2 font-semibold">
          <Mark className="size-6" />
          {appName}
        </span>
      ),
    },
    links: [
      { text: "Docs", url: "/docs" },
      { text: "Guides", url: "/docs/guides" },
      { text: "Components", url: "/docs/components" },
      { text: "Packages", url: "/docs/packages" },
    ],
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  }
}
