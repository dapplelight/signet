### signet-cli: conformance command

- New `signet conformance <baseUrl>` runs the Signet wire-contract cases against a live backend, prints one `pass` or `fail` line per case and exits 1 when any fails. Flags: `--auth-prefix`, `--ingest`, `--sessions`, `--json-path`, `--json`.
- signet-spec: `/spec/v1/index.json` lists every file under `/spec/v1/` with its URL and description. `bun run gen` writes it.
