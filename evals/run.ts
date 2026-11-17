// Agent build evals (dev-only, never published): bun evals/run.ts --tasks all --arms A,B,C --runs 1
// See apps/docs/content/docs/guides/evals.mdx. `--dry-run` calls no agent; real runs cost money.
import { main } from "./src/cli"

process.exit(await main(process.argv.slice(2)))
