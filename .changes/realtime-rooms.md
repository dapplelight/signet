### signet-server: realtime reducers, deadlines and rooms

- `createRealtime({ actions })`: a reducer per channel or prefix (`"room:*"`). Clients send `{ type: "action", channel, action, ref? }`; an accepted action updates the channel's value and broadcasts an `action` event with the usual seq, a rejected one (`throw new ActionRejected(message, code?)`) answers only the sender and changes nothing. `set` is refused on these channels. `joined` carries the channel's `value`.
- Deadlines: `ctx.schedule(name, at, action)` in a reducer, or `hub.schedule` / `hub.unschedule`, dispatch a server action (`who` null) later. New hub methods `act`, `value`, `schedule`, `unschedule`; new options `timers` and `storage`.
- `realtimeRoom` takes the Durable Object state: deadlines live in its storage and fire from `alarm()`, reducer values persist, so both survive eviction and restarts.
- Rooms across orgs: an identity with `room` (set by `authenticate`) joins channels under `roomScope(room)` instead of its org, and `connectRoom` routes it to that room's object. Per-org routing is unchanged.
