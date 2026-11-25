### signet-lib, signet-ui: amount strings that are not plain numbers show 0, not their first digits

A string amount such as `"1,234.50"` or `"12abc"` used to be read up to the first
character that was not part of a number, so it formatted as ₹1 or ₹12. `format`
(`createCurrencyFormatter`, `createCompactCurrencyFormatter`, `formatPercent`) and
`Amount` now read strings with `Number()`: it is invalid and shows 0, like any other
junk. Decimal strings from an API (`"1234.50"`) are unchanged. If you pass
display-formatted strings, strip the separators first.
