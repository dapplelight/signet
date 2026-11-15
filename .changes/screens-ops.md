### signet-ui: billing and growth screens

- New `@dapplelight/signet-ui/screens/billing-screens`: `BillingScreen` and
  `Paywall`, plus `PlanPicker` (plan cards as one radio group, monthly /
  yearly with the saving, store builds hide web-only plans), `CurrentPlanCard`
  (status, `currentPeriodEnd`, source: App Store, Google Play or web),
  `RestorePurchasesButton`, `UsageMeters` (signet-db `Usage`, amber at 75%,
  red at 90%), `InvoiceList` (links to the GST HTML invoice) and `WalletCard`.
  `plansFromEntitlements` turns a `definePlans` object plus names and prices
  into the plan list; `formatMoney` formats minor units.
- New `@dapplelight/signet-ui/screens/growth-screens`: `WaitlistJoin` (place
  in line), `InviteAccept` (`acceptInvite` reasons in plain words),
  `ReferralCard` (code, copy, Web Share, stats), `OnboardingChecklist`
  (progress ring, next step), `FeedbackWidget` / `FeedbackForm` (kinds,
  optional stars) and `WhatsNew` (unseen count; opening marks seen).
- Same contract as the admin screen: theme tokens only, every string in
  `DEFAULT_BILLING_LABELS` / `DEFAULT_GROWTH_LABELS`, `className` on every
  part and `classNames` on composites, state as `data-*`, `render` to swap
  a part's element, controlled or uncontrolled selection and open state.
- Showcase: `screens-ops.html` demos every screen in every theme, with a bar
  to switch screen, theme and dark mode.
