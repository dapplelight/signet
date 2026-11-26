### signet-server: MCP skills option

- `createMcpServer`, `resolveMcpServer` and `mountMcp` take a `skills` option: a catalog from the SDK's `@modelcontextprotocol/server/ext/skills` (Skills over MCP, SEP-2640), attached to every server they build. Clients then list and read the skills with `skills/list`, `skills/get` and `resources/read`, and the server declares the `io.modelcontextprotocol/skills` extension. The catalog is the same for every caller, and skill reads skip `scopes`, `rateLimit` and `onToolCall`.
