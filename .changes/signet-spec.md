### signet-spec: new package with the error envelope and error-code schemas

- New `@dapplelight/signet-spec` (peer: `zod`). `./error` has `errorEnvelopeSchema`, `ERROR_CODE_STATUS` (every `ERROR_CODES` entry from signet-lib mapped to its default HTTP status), `ErrorCode` and `errorCodeSchema`. `./schemas/*.json` ships `error-envelope.schema.json` (JSON Schema 2020-12) and `error-codes.json`, both generated from the Zod source with `"specVersion": "v1"` and served at `/spec/v1/` on the docs site.
- signet-server's `ERROR_ENVELOPE_SCHEMA` is unchanged; a test now fails if it disagrees with the spec package's schema.
