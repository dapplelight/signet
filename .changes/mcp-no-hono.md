### signet-server: `./mcp` loads without hono

- `@dapplelight/signet-server/mcp` no longer imports `./http/validate` at runtime, so it loads when the optional `hono` peer is absent. This fixes `npx @dapplelight/signet-mcp` and `bunx @dapplelight/signet-mcp`, which crashed on start with "Cannot find package 'hono'".
