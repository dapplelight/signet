### create-signet-app: --describe, a whole-app plan from one sentence

- New `--describe "<sentence>"`: picks the template (`web`, `api` or `full`) and theme from the sentence, scaffolds, then writes `PLAN.md` (pages with their block commands, components, modules and data; data models; recipes; build order; the `signet check` to run after each page) and `AGENTS.md` (follow the plan one page at a time). No LLM call: the same sentence gives the same files. An explicit `--template` or `--theme` wins. Without `--describe` nothing changes.
- create-signet-app now depends on `@dapplelight/signet-mcp`, for `plan_page` and the blocks index.
- signet-mcp: no longer private, and exports `./plan` (`planPage`) and `./generated` (`INDEX`).
