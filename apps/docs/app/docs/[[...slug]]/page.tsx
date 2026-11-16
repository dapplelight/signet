import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/layouts/docs/page"
import { createRelativeLink } from "fumadocs-ui/mdx"
import { MessageSquare, SquarePen } from "lucide-react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getMDXComponents } from "@/components/mdx"
import { PageActions } from "@/components/page-actions"
import { SidebarButton } from "@/components/sidebar-button"
import { getPageImageUrl, gitConfig } from "@/lib/shared"
import { source } from "@/lib/source"

export default async function Page(props: PageProps<"/docs/[[...slug]]">) {
  const params = await props.params
  const page = source.getPage(params.slug)
  if (!page) notFound()

  const MDX = page.data.body
  const markdownUrl = `/llms.mdx${page.url}.md`
  const repo = `https://github.com/${gitConfig.user}/${gitConfig.repo}`
  const sourcePath = `apps/docs/content/docs/${encodeURI(page.path)}`
  const githubUrl = `${repo}/blob/${gitConfig.branch}/${sourcePath}`
  const feedbackUrl = `${repo}/issues/new?${new URLSearchParams({ title: `Docs: ${page.data.title}`, body: `Page: ${page.url}\n\n` })}`

  return (
    <DocsPage
      toc={page.data.toc}
      full={page.data.full}
      tableOfContent={{
        footer: (
          <div className="mt-4 flex flex-col gap-1.5 border-t pt-4 text-sm text-fd-muted-foreground">
            <a
              href={`${repo}/edit/${gitConfig.branch}/${sourcePath}`}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 hover:text-fd-foreground"
            >
              <SquarePen className="size-3.5" />
              Edit this page on GitHub
            </a>
            <a
              href={feedbackUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 hover:text-fd-foreground"
            >
              <MessageSquare className="size-3.5" />
              Give feedback
            </a>
          </div>
        ),
      }}
    >
      <SidebarButton />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <DocsTitle className="text-[2rem] font-semibold tracking-tight">
          {page.data.title}
        </DocsTitle>
        <PageActions markdownUrl={markdownUrl} githubUrl={githubUrl} />
      </div>
      <DocsDescription className="mb-6 text-[1rem]">{page.data.description}</DocsDescription>
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
