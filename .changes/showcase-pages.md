### repo: the showcase deploys to Cloudflare Pages

`apps/showcase` now builds and deploys on every merge to main, and each PR from this repo gets a preview URL posted as a comment (`.github/workflows/showcase.yml`). It needs the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets and a Pages project named `signet-showcase`.
