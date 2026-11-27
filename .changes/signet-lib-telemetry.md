### signet-lib: telemetry

- New `./telemetry`: opt-in usage stats for CLIs and desktop apps. The app declares every event, field and allowed value up front, and anything else is dropped before it is written or sent. Off until the person says yes (`optIn()`); `DO_NOT_TRACK`, `<APP>_TELEMETRY=off` and `CI` force it off. Everything that leaves is appended to a local log first, and it never throws, never retries and gives up after `timeoutMs`. Its own import path, so browser bundles never see `node:fs`; web pages use `./analytics`.
