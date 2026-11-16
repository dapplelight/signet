### lib: offline outbox, sync conflict rules, IndexedDB storage

- `@dapplelight/signet-lib/offline`: `createOutbox<T>({ storage })` saves work done offline and `flush(send)` sends it on reconnect, keeping failures. Runs on any `StorageAdapter`.
- `@dapplelight/signet-lib/sync`: hybrid logical clock (`tick`, `receive`, `compareHlc`) and `apply(row, change, { guarded })`: per-field last-write-wins, guarded fields (amounts, dates) come back as a `Conflict` for a person, edit-after-delete is flagged (`deletedButEdited`). Order-independent and idempotent; tested over 2000 random two-device sessions.
- `indexedDbStorage()` in `/storage`: larger than localStorage and reachable from a service worker. No new dependency.
