### create-signet-app: organisations in the full template

- Sign-up creates a personal org (owner). `tenant()` resolves the org from the switch cookie or `x-org` header, and from a custom domain or `<slug>.ORG_ROOT_DOMAIN` (new optional env). An org switcher in the app shell; `/org` settings and `/org/members` with roles and invite links; `/invite/$token` to accept (signed-out visitors sign in and come back). `/admin` stays the platform operator's view. Migration `0001_orgs`. API and browser tests cover a second org, an accepted invite, and 404 for another org.
