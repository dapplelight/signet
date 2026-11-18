### all packages: dependencies on their latest minor and patch versions

- React 19.3.1, the AI SDK (`ai` 7.0.176, `@ai-sdk/react` 4.0.180), the MCP SDK 2.4.0, OpenTelemetry API 1.10, Radix (checkbox, dropdown menu, popover, tooltip), TanStack Query 5.108 and Table 9.3, Tailwind 4.3.5, lucide-react 1.74, react-day-picker 10.0.2, Fumadocs 16.19.4 and dev tooling. Scaffolded apps get the same versions.
- Held back because they broke here: recharts 3.11 (chart types), Biome 2.6 (reformats code, new rule), Hono 4.13.19 (server declaration types too large to emit). Majors (postgres 4, happy-dom 21, @tanstack/react-hotkeys 0.27, @ui-sdk beta.6) are separate.
