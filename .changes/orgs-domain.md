### signet-server: org settings no longer take a custom domain

- `PATCH /current` in `orgRoutes` now answers 400 when the body has `domain`, instead of dropping it and returning 200. `tenant()` matches the custom domain first, so a member who could set any host would decide the tenant for every request to it. Set it with `orgs.update` from an operator or verified-DNS flow.
- signet-ui `OrgSettings`: the custom domain field is gone, along with `domain` in `OrgSettingsValue` and the `domain`, `domainHint` and `invalidDomain` labels. Migration: stop passing those labels and stop sending `domain` from `onSave`.
