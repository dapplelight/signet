### create-signet-app: Vercel API target shares its rate limit through Upstash

- The `vercel` API target now uses `upstashRateLimitStore` once `KV_REST_API_URL` and `KV_REST_API_TOKEN` are set (Upstash Redis from the Vercel Marketplace sets them), so the 60/min limit holds across function instances. Without them it falls back to the per-instance `memoryStore`, as before. Existing apps are untouched; to adopt it, copy the `store` function from the new `index.ts`.
- The `bun`, `deno` and `node` entries and the README now say `memoryStore` counts per process, and name `upstashRateLimitStore` for more than one instance.
