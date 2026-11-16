### tokens: finance theme drops product category colours

`finance.css` no longer defines `--cat-needs`, `--cat-wants`, `--cat-investments`, `--cat-income`, `--cat-transfer` or their `--color-cat-*` utilities. Those are an app's budgeting vocabulary, and Signet carries no business logic: define them in your app's CSS. The theme keeps the optional money slots (`--money-credit`, `--money-debit`, `--money-transfer`). Breaking for apps that used `bg-cat-*` / `text-cat-*`, hence 0.4.0.
