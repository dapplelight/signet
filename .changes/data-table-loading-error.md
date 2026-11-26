### signet-ui: DataTable loading and error states

- `DataTable` takes an opt-in `loading` prop (placeholder rows, `aria-busy`) and `error` prop (`true`, or `{ message, onRetry }`, rendered as an `ErrorState` in the body), so a slow or failed fetch no longer reads as "No data". Without them, rendering is unchanged.
