# Lifted from the donor app

The list of generic pieces first written in the donor product (app-a) and
moved into Signet. It replaces `BACKLOG.md`, which is gitignored and was lost.
Every item is either lifted, with the package and the test that covers it, or
not lifted, with the reason.

## Lifted

| Item | Where | Test |
|---|---|---|
| Type-ramp-aware `cn()` (`text-stat`, `text-caption`) | `ui/lib/utils.ts` | `ui/test/ui.tsx` |
| Button sizes `touch` / `icon-touch` (44px) | `ui/components/ui/button.tsx` | `ui/test/ui.tsx` |
| `ResponsiveSheet` (drawer on phone, dialog on desktop) | `ui/components/ui/responsive-sheet.tsx` | `ui/test/dom.tsx` |
| `AnswerHeadline`, `StatStrip` (generic, not finance) | `ui/components/ui/answer-headline.tsx`, `stat-strip.tsx` | `ui/test/dom.tsx` |
| Chart kit on shadcn chart | `ui/components/ui/chart.tsx` | `ui/test/ui.tsx` |
| `Drawer`, `InputOTP` | `ui/components/ui/drawer.tsx`, `input-otp.tsx` | `ui/test/ui.tsx`, `ui/test/dom2.tsx` |
| "Hide amounts" mask: `PrivacyMask`, `RatioText`, `useMaskedRatio` | `ui/components/ui/privacy-mask.tsx` | `ui/test/dom.tsx` |
| `ThemeProvider` `themeColor` prop (value or function) | `ui/components/ui/theme-provider.tsx` | `ui/test/ui.tsx` |
| `ApiError` shows `Request failed (HTTP n)` for a non-JSON error body, keeps the text on `.body` | `lib/api/client.ts` | `lib/test/smoke.ts` |
| Date arithmetic (`addDays`, `addMonths`, `startOf*`, `endOfMonth`, `differenceInCalendarDays`) so apps can drop date-fns | `lib/format/date.ts` | `lib/test/date.ts` |
| Optional token slots (`--money-*`, `--chart-1..6`, `--focus-ring*`, `--accent-primary*`, `--accent-red-fg`, `--leading-display`) | `tokens/CONTRACT.md`, themes | `tokens/test/themes.ts` |
| `editorial.css` no longer recolours stock Tailwind scales | `tokens/src/themes/editorial.css` | `tokens/test/themes.ts` |
| Fail-closed field decryption | `lib/crypto` | `lib/test/smoke.ts` |
| Rendering tests for `signet-ui` (the donor's test approach) | `ui/test/*.tsx` (30 files, happy-dom) | `bun run test` in `packages/ui` |

## Not lifted

- **Revocation marker** (a localStorage flag, fail-closed, until an IndexedDB
  delete is confirmed). No second app needs it, and the pieces it uses are
  already here (`webStorage`, `indexedDbStorage` in `lib/storage`). It is a
  dozen lines on those adapters. Lift it when a second app asks.
- **WebAuthn unlock** (PRF, then HKDF, then a non-extractable AES-GCM key
  wrap). Signet ships no client-side key management: `decryptFields` takes the
  caller's `decrypt`. Lifting this means Signet owns a key-custody design and
  its threat model. That is a new feature, not a lift. Revisit only if Signet
  decides to ship client-side encryption.
- **The donor's added-lines-only rules lint script.** Its rules are the
  donor's own conventions. Signet's equivalent is Biome (`bun run lint`) plus
  `scripts/check-*.ts`.
- **Test-pattern note** (bun `mock.module` is process-global, so keep shared
  fakes in one `test/setup.ts` with per-file setters). Signet's tests inject
  fakes as arguments and use no `mock.module`, so there is nothing to centralise.
