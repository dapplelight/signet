### signet-server: real-time channels

- New `./realtime`: `createRealtime({ authorize, limits, heartbeatMs, timeoutMs, typingMs, idleMs })`, one hub for every runtime. Channels per resource live under the connection's org (from `authenticate`, never the client), so one org never receives another's events; `authorize` denies by default. Presence (one entry per user with a tab count, `joined` / `left`, `typing` that clears itself, `editing`), heartbeat timeouts, resume after reconnect from a per-channel history (`since` with epoch and seq, `reset` when the gap is too old), a last-writer-wins shared state per channel with versions and a `conflict` notice to a writer that replaced a newer write, inbound size and rate limits and a slow-consumer close for backpressure. `hub.publish`, `hub.disconnect`, `hub.sweep`, `hub.presence`, `hub.state`.
- `realtimeOutbox(publisher)` delivers signet-db outbox rows on `REALTIME_TOPIC` as change events, with the row id as the event id. `sessionAuth({ verify, cookieName, orgs })` authenticates from the session cookie plus org membership; `admit` checks the handshake's `Origin` (same host unless listed in `origins`).
- New `./realtime/bun` (`bunRealtime`, on `Bun.serve` WebSockets), `./realtime/node` (`attachRealtime`: a small RFC 6455 server on `http.Server`'s upgrade event, no dependency, since Node ships only a WebSocket client) and `./realtime/cloudflare` (`realtimeRoom` Durable Object class, one object per org; `connectRoom`, `roomPublisher`).

### signet-ui: real-time hooks and components

- New `./hooks/use-channel`: `createRealtimeClient` (reconnect with backoff and resume, heartbeat, duplicate-event drop, versioned state), `useChannel`, `usePresence`, `useRecordChanges`.
- New `./screens/realtime-screens`: `AvatarStack`, `EditingBadge`, `TypingIndicator` and `RecordChangedBanner`, with `DEFAULT_REALTIME_LABELS`. Showcase page `screens-realtime.html`.

### signet-mcp: add-realtime recipe

- New `add-realtime` recipe: transports, tenancy, outbox live updates, presence, shared state and the React hooks, cut from the server and ui READMEs.
