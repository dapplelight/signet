### signet-tokens: green, amber and primary text reach 4.5:1 on cards

- Light `--accent-green` is a shade darker: editorial (and finance) `#12833c` → `#117e3a`, cinematic `#0c847a` → `#0b7e75`. Green text on cards (`stat-strip` deltas, `trend-chip`, `amount`'s credit tone through `--money-credit`) measured 4.19–4.25:1 on `--bg-surface`; it is now 4.53:1. Dark themes are unchanged.
- The contrast test now checks `--accent-green` on `--bg-surface` and `--card`, so it fails if green text drops below 4.5:1 again.
- Light `--accent-amber` is a shade darker too: editorial `#986908` → `#926508`, cinematic `#b16105` → `#aa5d05` (4.21–4.23 → 4.51:1). Editorial `--primary` and `--ring` go from `#12833c` to `#117e3a`, so `text-primary` on cards passes (4.53:1); buttons and the focus ring shift by the same shade, and white on primary is 5.16:1. The contrast test checks amber and primary on `--bg-surface` and `--card` as well.
