### signet-server: MCP on by default — routes as tools, per-user tools, pending approvals

- `appTools(app)` (`./mcp`): every route validated with `zValidator` becomes an
  MCP tool — name from the method and path, description from `asTool` or the
  schema's `.describe()`, input from the json/query/param validators. GET is
  read-only; any other method asks first through `requireApproval`.
  `asTool({ ... })` names, describes or opts a route in; `asTool(false)` leaves
  it out; `appTools(app, { optIn: true })` takes only marked routes. A GET
  or DELETE with a json validator is skipped (its arguments go in the query).
- `routesAsTools` routes take `approval`, `query` and `visible`, and forward
  `cf-connecting-ip` / `x-forwarded-for` so route tools share the caller's
  rate-limit bucket.
- Tools take `visible(caller)`: a tool for some roles or plans is neither
  listed nor callable for anyone else. `createMcpServer` throws on one (it has
  no caller); serve through `resolveMcpServer` / `mcpHandler`.
- Pending approvals: `kvApprovals(kv, { ttlSeconds, onEvent })` on
  `createMcpServer({ approvals })`. A client that cannot ask gets
  `APPROVAL_PENDING` with the record's id; the person approves or denies it
  through `approvalRoutes` (`./http/routes`); the same call (tool, principal,
  arguments) then runs once. Records expire; requests, decisions and uses are
  events for an audit log, elicited answers included. A call with no
  principal opens no record (no one could decide it) and gets
  `APPROVAL_REQUIRED`. Without a store, behaviour is unchanged.
- `approvalGate`: `requireApproval` in the `approve` shape signet-db's and
  signet-payments' tool factories take, so their writes use the same step.

### signet-lib: `APPROVAL_PENDING` error code

- New code in `ERROR_CODES`, with default copy.

### create-signet-app: MCP for agents, chosen at scaffold time

- The api template asks "Add MCP for agents?" (default yes); `--mcp` /
  `--no-mcp` decide without a terminal (default `--mcp`). With MCP, `/mcp`
  serves every `zValidator` route as a tool (`appTools`), writes ask first,
  `MCP=off` turns it off, and `@modelcontextprotocol/server` is added. With
  `--no-mcp` there is no dependency, file or mention of it. Needs the
  signet-server release with `appTools`.
