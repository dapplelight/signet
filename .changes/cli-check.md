### signet-cli: signet check

- New `signet check`: the verify loop for agent-written code. It runs `tsc --noEmit`, Biome and Signet's conventions (`env-module-scope`, `error-handler`, `raw-colour`), then the conformance suite with `--api <url>` and screenshots plus axe at 390 and 1280 px with `--pages <path...>`. It prints a summary or, with `--json`, a findings list (`file`, `line`, `rule`, `level`, `message`, `fix`) and exits 1 on any error.
