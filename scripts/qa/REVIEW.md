# Visual QA review rubric

How an agent reviews a `bun run qa` run. Review is done by Claude or Dobby reading the PNGs with the Read tool: no API key and no new dependency. A per-PR CI version of this review is out of scope until after launch.

## Steps

1. Read `qa-out/<run>/report.md`. It lists axe violations (ranked), console errors, horizontal overflow and the path of every sheet.
2. Read every `qa-out/<run>/sheets/<item>.png`. Each sheet is 12 tiles: editorial, cinematic and finance, each light then dark, each mobile (390, shown at 100%) then desktop (1280, shown at 50%). The label strip on a tile says which one it is and adds `axe N`, `console N` or `overflow` when non-zero. A tile that says "Not captured" was skipped by `--quick`; a tile that says "No shot: ..." failed, and that failure is a finding.
3. Open a full-size file from `shots/` when a sheet is too small to judge a detail.
4. Check each tile against the rubric below.

## Rubric

- **Overflow**: anything wider than the viewport, a horizontal scrollbar, content cut off at the page edge.
- **Clipped or overlapping text**: text cut off by its container, truncated without reason, or drawn over other content.
- **Contrast**: text or icons hard to read against their background, in either mode.
- **Tokens not applied, or hard-coded colors per theme**: a tile that looks the same in all three themes where it should differ, or a colour that does not follow the theme (a fixed hex, a light-mode colour left in dark mode).
- **Dark-mode misses**: light surfaces, dark text on a dark page, borders or shadows that vanish or glare in dark mode.
- **Mobile tap-target size**: interactive elements smaller than about 44 px on the mobile tiles, or packed so close that a thumb would hit the neighbour.
- **Empty, loading and error states**: a state that is blank, broken, missing its message, or visually unlike the other states of the same component.
- **Inconsistent spacing**: padding, gaps or alignment that differ between themes, between light and dark, or from sibling components without a reason.

## Severity

Use the axe words:

- **critical**: the item is unusable or unreadable (content missing, text unreadable, layout broken).
- **serious**: a clear defect that most users would hit (overflow on mobile, wrong or missing theme colours, tap targets too small).
- **moderate**: a visible defect with a workaround or in one theme or mode only.
- **minor**: polish (a few pixels of spacing, a slightly off alignment).

## Findings format

Report every finding. Rank them by severity (critical first), then by how many tiles are affected. There is no cap.

One block per finding:

```
- item: <item id>
  theme/mode/viewport: <theme> / <light|dark> / <mobile|desktop>
  severity: <critical|serious|moderate|minor>
  evidence: <path to the sheet, e.g. qa-out/<run>/sheets/<item>.png> (tile: "<tile label>")
  suggested fix: <what to change, and in which file if known>
```

If the same defect shows on several tiles of one item, give one block and list the tiles in `theme/mode/viewport`. If a run has no findings, say so in one line.
