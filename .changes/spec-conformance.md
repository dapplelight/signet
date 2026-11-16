### spec: conformance cases and runner

- New `conformance/cases.json` (also served at `/spec/v1/conformance-cases.json`): language-neutral request and expected-response cases for the error envelope, analytics ingest, client login and session routes.
- New `./conformance` export: `runConformance({ baseUrl, authPrefix, ingestPath, jsonPath, fetch? })` runs them with `fetch` alone and returns `{ passed, failed, results }`.
