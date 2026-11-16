### ui: LabelsProvider, so apps can translate the words components say by themselves

Text that Signet's components show without being passed it ("Close", "Something went wrong", "Search…", table headers, aria labels…) now comes from `useLabels()`, English by default. Wrap the app once to swap them with any i18n library:

```tsx
<LabelsProvider labels={{ close: t("close"), somethingWentWrong: t("error.title") }}>
```

Unset keys stay English, nested providers merge, and a component prop for the same text (for example `DataTable`'s `emptyMessage`) still wins. Nothing changes for apps that don't use it. Exports: `LabelsProvider`, `useLabels`, `defaultLabels`, `Labels`.
