### all packages: one zod 4 range

- Every package's zod peer and dev range is now `^4.6.7` (was a mix of `>=4.0.0`, `>=4.2.0`, `^4.0.0` and `^4.6.5`), and scaffolded apps ask for the same. `>=4` no longer admits a future zod 5. A test in `signet-config` fails if any range drifts or the lockfile resolves more than one zod.
