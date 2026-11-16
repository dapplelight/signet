import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from "fumadocs-ui/layouts/docs/page"
import { createRelativeLink } from "fumadocs-ui/mdx"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getMDXComponents } from "@/components/mdx"
import { SidebarButton } from "@/components/sidebar-button"
import { getPageImageUrl, gitConfig } from "@/lib/shared"
import { source } from "@/lib/source"

export default async function Page(props: PageProps<"/docs/[[...slug]]">) {
  const params = await props.params
  const page = source.getPage(params.slug)
  if (!page) notFound()

  const MDX = page.data.body
  const markdownUrl = `/llms.mdx${page.url}.md`

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <SidebarButton />
      <DocsTitle className="text-[2rem] font-semibold tracking-tight">{page.data.title}</DocsTitle>
      <DocsDescription className="mb-0 text-[1rem]">{page.data.description}</DocsDescription>
      <div className="flex flex-row items-center gap-2 pb-2">
        <MarkdownCopyButton markdownUrl={markdownUrl} />
        <ViewOptionsPopover
          markdownUrl={markdownUrl}
          githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/content/docs/${encodeURI(page.path)}`}
        />
      </div>
      <DocsBody>
        <MDX
          components={getMDXComponents({
            // this allows you to link to other pages with relative file paths
            a: createRelativeLink(source, page),
          })}
        />
      </DocsBody>
    </DocsPage>
  )
}

export async function generateStaticParams() {
  return source.generateParams()
}

export async function generateMetadata(props: PageProps<"/docs/[[...slug]]">): Promise<Metadata> {
  const params = await props.params
  const page = source.getPage(params.slug)
  if (!page) notFound()

  return {
    title: page.data.title,
    description: page.data.description,
    openGraph: {
      images: getPageImageUrl(page).url,
    },
  }
}
