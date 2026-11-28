### signet-ui: Fold

- New `./components/fold`: `Fold` shows one row (a title, a muted detail and a Show more / Show less link) that opens long Markdown text in place. Keyboard and screen reader friendly, text capped near 66 characters wide. Parts `FoldRoot`, `FoldHeader`, `FoldTitle`, `FoldDetail`, `FoldToggle` and `FoldBody`; words through `showMoreLabel` / `showLessLabel` or the new `showMore` / `showLess` labels.
