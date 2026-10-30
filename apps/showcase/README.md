# Signet showcase

One page that renders a representative set of Signet components under every
theme in `packages/tokens/src/themes`, light and dark. Static: `bun run build`
writes `dist/`, which any static host can serve (asset paths are relative).

```bash
bun install            # from the repo root
bun run dev            # from apps/showcase
bun run build          # builds the workspace packages first, then dist/
```

`?theme=cinematic` in the URL selects a theme. Each theme is its own
stylesheet (Tailwind resolves utilities per theme at build time), so switching
swaps the stylesheet; light/dark is the `.dark` class.
