### signet-server: organisations and tenants

- New `./http/orgs`: `tenant()` middleware resolves the org from the custom domain, subdomain, route param, `x-org` header or switch cookie; `orgGuards()` gives `requireMember`, `requireRole` and `requirePermission` (401 / 404 for outsiders / 403); `orgRoutes()` mounts org switching, settings, members and invites on signet-db's `createOrgs`. `currentTenant`, `currentMembership`, `grants`.
- `PATCH /current` ignores `domain`: the tenant resolves from the custom domain first, so a member who could claim a host (the app's own, say) would decide the tenant for every request to it. Set a domain with `orgs.update` from an operator or verified-DNS flow.
