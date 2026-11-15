### signet-tokens: green text reaches 4.5:1 on cards

- Light `--accent-green` is a shade darker: editorial (and finance) `#12833c` → `#117e3a`, cinematic `#0c847a` → `#0b7e75`. Green text on cards (`stat-strip` deltas, `trend-chip`, `amount`'s credit tone through `--money-credit`) measured 4.19–4.25:1 on `--bg-surface`; it is now 4.53:1. Dark themes are unchanged.
- The contrast test now checks `--accent-green` on `--bg-surface` and `--card`, so it fails if green text drops below 4.5:1 again.
