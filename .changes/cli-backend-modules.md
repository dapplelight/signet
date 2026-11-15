### signet-cli: backend modules and codemods

- `signet add auth | db | payments | notify | admin` copies a backend module into `src/server/` of an app made with `create-signet-app --template api`, adds its import and `.route(...)` to `src/app.ts`, its keys to `envSchema` in `src/env.ts` and to `.env.example` (once; lines without an anchor are printed), and installs its npm packages with the app's package manager (from the lockfile; `--no-install` prints the command). Module files upgrade and diff like any item.
- `signet upgrade` runs versioned codemods once per app: signet-ai 0.4 rewrites `generateObject` to `generateText` with `Output.object` and bumps `ai` to 7; signet-db `setPlan` and signet-server `registerIngest` call sites are listed with what changed. `--dry-run` prints the diffs. Needs `typescript` in the app.
- signet-mcp: new `add-backend-module` recipe.
