### signet-ui: auth, onboarding, pricing, checkout and error page blocks

- New `./blocks/auth-page`, `./blocks/onboarding`, `./blocks/pricing`, `./blocks/checkout-summary`, `./blocks/empty-page` and `./blocks/error-page`: whole pages with `labels`, `classNames`, `data-block` / `data-slot` hooks and `ready` / `loading` / `error` states. Back-end calls come in as callbacks (`onRequestCode`, `onVerify`, `onPay`), so a block holds no provider logic. `signet add block <name>` copies them.
