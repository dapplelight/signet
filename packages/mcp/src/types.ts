/** The shape of `generated/index.ts`, written by `scripts/build-index.ts` from the repo. */

export type Doc = {
  /** Short name: `signet://docs/<name>`. */
  name: string
  /** Repo-relative path of the source file. */
  path: string
  title: string
  text: string
}

export type SymbolInfo = {
  name: string
  kind: string
  /** The declaration's head, as written in the source. */
  signature: string
  /** The JSDoc comment above it, cleaned of `*`. */
  doc: string
  /** Repo-relative file the declaration lives in. */
  source: string
}

export type ExportPath = {
  package: string
  /** The exact import path, e.g. `@dapplelight/signet-server/http`. */
  path: string
  source: string | null
  /** First sentence of the file's doc comment. */
  summary: string
  symbols: SymbolInfo[]
  stylesheet?: boolean
}

export type PackageInfo = {
  name: string
  dir: string
  version: string
  description: string
  private: boolean
}

export type CvaInfo = {
  name: string
  variants: Record<string, string[]>
  defaults: Record<string, string>
}

export type ComponentInfo = {
  name: string
  importPath: string
  source: string
  exports: string[]
  /** Each exported component's parameter list, as written. */
  props: Record<string, string>
  /** `interface …Props` / `type …Props` declarations in the file. */
  propTypes: string[]
  cva: CvaInfo[]
  /** Contract variables the component's classes resolve through. */
  tokens: string[]
  example: string
  domain: boolean
}

export type ThemeInfo = {
  name: string
  file: string
  importPath: string
  description: string
  /** Theme this one imports and extends, if any. */
  overlayOf: string | null
  css: string
}

export type TokenInfo = {
  name: string
  kind: "required" | "optional" | "domain"
  group: string
}

export type RecipeStep = { title: string; source: string; markdown: string }

export type Recipe = {
  id: string
  title: string
  keywords: string[]
  install: string[]
  steps: RecipeStep[]
  verify: string[]
}

export type TemplateFile = { path: string; content: string }

export type ScaffoldTemplate = {
  files: TemplateFile[]
  scripts: Record<string, string>
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
}

export type SignetIndex = {
  packages: PackageInfo[]
  docs: Doc[]
  exports: ExportPath[]
  components: ComponentInfo[]
  themes: ThemeInfo[]
  tokens: TokenInfo[]
  contractCounts: { required: number; optional: number }
  recipes: Recipe[]
  scaffold: { themes: string[]; web: ScaffoldTemplate; api: ScaffoldTemplate }
}
