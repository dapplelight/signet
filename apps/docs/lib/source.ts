import { llms, loader } from "fumadocs-core/source"
import { metaSchema, pageSchema } from "fumadocs-core/source/schema"
import { defineDocs } from "fumadocs-mdx/macro"
import { z } from "zod"
import { docsRoute } from "./shared"

/** Package index pages: stable and beta are on npm; source-only is not published. */
export const maturityLevels = ["stable", "beta", "source-only"] as const

const docs = defineDocs({
  dir: "content/docs",
  docs: {
    schema: pageSchema.extend({ maturity: z.enum(maturityLevels).optional() }),
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: metaSchema,
  },
})

// See https://fumadocs.dev/docs/headless/source-api for more info
export const source = loader({
  baseUrl: docsRoute,
  source: docs.toFumadocsSource(),
  plugins: [],
})

export const docsLlms = llms(source, {
  renderPage: async (page) => `# ${page.data.title} (${page.url})
${page.data.maturity ? `\nMaturity: ${page.data.maturity}\n` : ""}
${await page.data.getText("processed")}`,
  // link to the files under `/llms.mdx`
  renderUrl: (item) => (/^\/.*\.(md|txt)$/.test(item.url) ? `/llms.mdx${item.url}` : item.url),
})
