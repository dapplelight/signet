### signet-ui: pace chart

- New `PaceChart` in `./components/chart`: usage against an even pace and a limit, with a dashed on-pace line, the solid used line, a dashed amber projection from Now to the limit, a Now marker, a limit point, a slot in the header for a Day / Week / Month selector, and one screen-reader sentence per part. Label, colour, className and hide per part. `ChartContainer` and the existing charts are unchanged.
