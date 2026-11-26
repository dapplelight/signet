### signet-server: MCP `maxToolInputElements`

- `createMcpServer`, `resolveMcpServer` and `mountMcp` take an optional `maxToolInputElements`: the most array elements and object members one `tools/call` may carry in its `arguments`, counted together. A bigger call is refused before the tool's schema or handler run, so a huge nested argument cannot burn CPU or memory. Default: no limit, so nothing changes unless you set it.
