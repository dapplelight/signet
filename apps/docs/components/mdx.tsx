import { Button } from "@dapplelight/signet-ui/components/button"
import { File, Files, Folder } from "fumadocs-ui/components/files"
import { Step, Steps } from "fumadocs-ui/components/steps"
import { Tab, Tabs } from "fumadocs-ui/components/tabs"
import defaultMdxComponents from "fumadocs-ui/mdx"
import type { MDXComponents } from "mdx/types"
import { AgentPrompt } from "./agent-prompt"
import { Demo } from "./demo"
import { Preview } from "./preview"

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    Preview,
    Demo,
    Tabs,
    Step,
    Steps,
    Tab,
    Button,
    AgentPrompt,
    File,
    Files,
    Folder,
    ...components,
  } satisfies MDXComponents
}

export const useMDXComponents = getMDXComponents

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>
}
