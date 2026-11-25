### signet-lib: compact currency with 0 decimals

- `createCompactCurrencyFormatter` with `decimals = 0` no longer prints 10 lakh as `₹1L` or 10 crore as `₹1Cr`; trailing zeros are trimmed only after a decimal point.
- Amounts that round up to the next tier now roll over: 99.96 lakh with 0 decimals is `₹1Cr` (not `₹100L`), and 99,999.6 is `₹1L`.
