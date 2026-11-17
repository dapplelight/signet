# Eval visual rubric

How the judge scores the screenshots of one eval run. It uses the same dimensions as `scripts/qa/REVIEW.md`, scored instead of listed. The judge reads the run's PNGs with the Read tool.

## Tiles

Each run has one tile per page, per width (390 and 1440) and per mode (light and dark). The label on a tile reads `<page> · <mode> · <width>`. A tile that says "No shot: ..." failed to capture. Score it as a miss on every dimension it hides and cite it as a finding. A page that does not build has no tiles at all, and scores 0.

## Dimensions

Score each dimension from 0 to 2. The total is out of 16.

- 0: a clear defect that most people would hit, on any tile.
- 1: a visible defect on some tiles only, or one with a workaround.
- 2: no defect on any tile.

| Dimension | What to look for |
| --- | --- |
| overflow | Anything wider than the viewport, a horizontal scrollbar, content cut off at the page edge. |
| clipped-text | Text cut off by its container, truncated without reason, or drawn over other content. |
| contrast | Text or icons hard to read against their background, in either mode. |
| tokens | Colours, radii and type that look hard-coded, or that do not follow one consistent style across the page. |
| dark-mode | Light surfaces left in dark mode, dark text on a dark page, borders or shadows that vanish or glare. A page with no dark mode at all scores 0. |
| tap-targets | Interactive elements smaller than about 44 px on the 390 tiles, or packed so close that a thumb would hit the neighbour. |
| states | Empty, loading, error and selected states that are blank, broken, missing their message or unlike the rest of the page. |
| spacing | Padding, gaps or alignment that are uneven, or differ between light and dark or between widths without a reason. |

## Severity

Use the axe words, the same as `scripts/qa/REVIEW.md`:

- **critical**: the page is unusable or unreadable (content missing, text unreadable, layout broken).
- **serious**: a clear defect that most users would hit (overflow on mobile, wrong or missing theme colours, tap targets too small).
- **moderate**: a visible defect with a workaround, or in one mode only.
- **minor**: polish (a few pixels of spacing, a slightly off alignment).

A dimension with a critical or serious finding scores 0. One with only moderate findings scores 1. One with only minor findings, or none, scores 2.

## Answer

The judge answers with one JSON object and nothing else:

```json
{
  "scores": { "overflow": 2, "clipped-text": 2, "contrast": 1, "tokens": 2, "dark-mode": 0, "tap-targets": 1, "states": 2, "spacing": 2 },
  "findings": [
    { "dimension": "dark-mode", "severity": "serious", "tile": "/ · dark · 390", "note": "The cards stay white on a dark page." }
  ]
}
```

Every finding cites the tile it comes from, by the label on the tile. If a run has no findings, `findings` is an empty list.
