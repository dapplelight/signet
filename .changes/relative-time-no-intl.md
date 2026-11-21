### signet-lib: relative time works without Intl.RelativeTimeFormat

- `createRelativeTimeFormatter` no longer throws where `Intl.RelativeTimeFormat` is missing (Hermes on Android, which crashed the mobile starter at launch). It falls back to plain English: "3 days ago", "in 2 hours", "now".
