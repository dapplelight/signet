### create-signet-app: quieter first install and lint

- Generated `biome.json` points `$schema` at the installed Biome's own schema, so `lint` no longer asks you to run `biome migrate` when a newer Biome 2.x installs.
- With `--pm npm`, the generated `package.json` allows esbuild's install script (`allowScripts`), so npm 11 no longer warns about it, and a future npm that blocks unreviewed scripts still builds.
