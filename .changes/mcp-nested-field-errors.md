### signet-server: MCP tool validation errors name the nested field

- A zod error thrown from an MCP tool handler now keys `details.fieldErrors` by the full dotted path (`address.city`, `guests.2.name`), like `zValidator` does over HTTP. Before, it was keyed by the first segment only (`address`), so an agent could not tell which nested field was wrong. A client that read the first-segment key for a nested field must read the dotted key.
