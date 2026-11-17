import type { MetadataRoute } from "next"
import { source } from "@/lib/source"

export const dynamic = "force-static"

const origin = "https://signet.dapplelight.in"

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = ["/", "/llms.txt", "/llms-full.txt", ...source.getPages().map((p) => p.url)]
  return paths.map((path) => ({ url: `${origin}${path}` }))
}
