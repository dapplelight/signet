### signet-ui: chart on recharts 3

- `./components/chart` now targets recharts 3 (peer `>=3 <4`), matching shadcn's current chart. Tooltip and legend content props are typed from recharts 3's `DefaultTooltipContentProps` and `DefaultLegendContentProps`; `ChartContainer` passes an `initialDimension` to `ResponsiveContainer`.
- Look: grid, axes, tooltip and cursor render the same. Bars are 1-2px wider, because recharts 3 no longer truncates bar sizes to whole pixels.
- Migrating: upgrade the app's `recharts` to 3. Custom tooltip content that read `payload` or `label` from `TooltipProps` should take `TooltipContentProps`.
