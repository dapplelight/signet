### mcp: plan_page tool

- New `plan_page({ description, target? })`: describe a page in words and get a file plan. It returns the block to add (with its `signet add block` command), the components it uses, server modules, the matching recipe, the data the page needs and the files to create, each with a one-line purpose. `target` is `web` (default), `api` or `full`. It ranks the blocks, recipes and server exports by words only: no LLM call, and the same description gives the same plan.
