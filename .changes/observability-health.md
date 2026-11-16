### server: observability/health routes

- New `./observability/health` with `healthRoutes({ checks, timeoutMs? })`, a Hono app for load balancer probes. `GET /live` always returns 200. `GET /ready` runs every check in parallel with a per-check timeout (default 2000 ms) and returns 503 when any check returns false, throws or times out. The body holds only `ok` and one boolean per check, never error text. Takes config and never reads env. Nothing existing changes.
