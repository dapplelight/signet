### signet-ui: action row

- New `./components/action-row`: `ActionRow` shows one item that waits on the user: an icon, a title, one sentence and a button group. On narrow screens the buttons move under the text, full width and at least 44px tall. `tone` is `neutral`, `ask` or `warn` (amber, never red). Parts (`ActionRowRoot`, `ActionRowIcon`, `ActionRowBody`, `ActionRowTitle`, `ActionRowDescription`, `ActionRowActions`), `classNames` and `data-*` hooks; `signet add action-row` copies it in.
