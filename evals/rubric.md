# Eval visual rubric

How the judge checks the screenshots of one eval run. It is a tree of yes/no checks, not a score out of a scale. The judge reads the run's PNGs with the Read tool. The checks cover the same ground as `scripts/qa/REVIEW.md`.

## Tiles

Each run has one tile per page, per width (390 and 1440) and per mode (light and dark). The label on a tile reads `<page> · <mode> · <width>`. A tile that says "No shot: ..." failed to capture. Answer no to every check it hides and cite it as a finding. A page that does not build has no tiles at all, and has no visual result.

## How to answer

Answer every check below with yes or no, and nothing in between. Answer yes only when no tile shows the defect. When the page has nothing the check could apply to (for example no list that could be empty), answer yes.

The result is the share of checks answered yes, as a percentage. A check is never weighted.

The check lines are the only list the harness reads: one line per check, written as a dash, the id in backticks, a colon and the question.

## Checks

### layout

- `layout.no-overflow`: Is every tile free of content wider than the viewport and of a horizontal scrollbar?
- `layout.no-clipping`: Is all text fully visible, never cut off by its container or drawn over other content?
- `layout.aligned`: Do the page's blocks line up on one consistent left edge or grid?
- `layout.uses-width`: At 1440, does the content use the width sensibly, neither stretched edge to edge nor lost in empty space?

### hierarchy

- `hierarchy.heading`: Is there one clear page heading that is visibly the largest text?
- `hierarchy.primary-action`: Is the main action visibly stronger than the secondary ones?
- `hierarchy.readable-type`: Do the type sizes step up in a clear order, with body text easy to read?

### spacing

- `spacing.even-gaps`: Are the gaps between similar items equal?
- `spacing.padding`: Do cards, panels and buttons have comfortable, consistent inner padding?
- `spacing.stable`: Is the spacing the same in light and dark, and does it change between widths only for a reason?

### tokens

- `tokens.one-palette`: Do all colours, radii and type look like one theme, with no stray hard-coded colour?
- `tokens.dark-mode`: In dark mode do surfaces, text and borders all switch, with no light surface left behind?
- `tokens.contrast`: Is text and every icon easy to read against its background in both modes?

### states

- `states.empty`: Is every list or table that could be empty given a visible empty message, or is there none?
- `states.loading`: Is every area that loads data given a visible loading placeholder, or is there none?
- `states.error`: Is every form or request that can fail given a visible, worded error, or is there none?

### responsive

- `responsive.stacks`: At 390, does the layout fit one readable column?
- `responsive.tap-targets`: At 390, are buttons, links and inputs at least about 44 px high and not packed against each other?
- `responsive.text-fits`: At 390, does all text wrap inside the screen, with no word broken or cut?

## Severity

Use the axe words, the same as `scripts/qa/REVIEW.md`:

- **critical**: the page is unusable or unreadable (content missing, text unreadable, layout broken).
- **serious**: a clear defect that most users would hit (overflow on mobile, wrong or missing theme colours, tap targets too small).
- **moderate**: a visible defect with a workaround, or in one mode only.
- **minor**: polish (a few pixels of spacing, a slightly off alignment).

Severity only labels a finding. Every check you answer no to needs one finding.

## Answer

The judge answers with one JSON object and nothing else. `checks` has every id above, each true (yes) or false (no):

```json
{
  "checks": { "layout.no-overflow": true, "tokens.dark-mode": false },
  "findings": [
    { "dimension": "tokens", "severity": "serious", "tile": "/ · dark · 390", "note": "The cards stay white on a dark page." }
  ]
}
```

`dimension` is the group name (layout, hierarchy, spacing, tokens, states or responsive). Every finding cites the tile it comes from, by the label on the tile. If a run has no findings, `findings` is an empty list.

## Pairwise judge

A second judge sees one screenshot from each of two arms for the same task, the first page at 1440 in light mode. The two are labelled X and Y, in random order, with nothing that names the arm. It answers `{"pick":"X"}`, `{"pick":"Y"}` or `{"pick":"tie"}`. The report shows win rates for C vs B, B vs A and C vs A.
