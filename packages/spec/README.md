# @dapplelight/signet-spec

The wire contract of [Signet](https://github.com/dapplelight/signet) as Zod: the error envelope and every error code with its HTTP status.

```bash
bun add @dapplelight/signet-spec
```

Generated, versioned JSON files in `schemas/`:

- `error-envelope.schema.json`
- `error-codes.json`
- `analytics-ingest-request.schema.json`
- `analytics-ingest-response.schema.json`
- `tracked-event.schema.json`
- `webhook-delivery.schema.json`
- `contract.json`: the theme contract's variable names, parsed from `packages/tokens/CONTRACT.md`. Names only; a DTCG export is a deliberate non-goal, since the contract has no values.

OpenAPI documents in `openapi/`:

- `auth.openapi.json`

Docs: signet.dapplelight.in/docs/packages/spec
