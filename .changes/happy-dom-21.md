### signet-ui, signet-test: happy-dom 21

- Dev dependency `@happy-dom/global-registrator` (and `happy-dom`) 20.14 to 21.0.4. Test-only: no runtime or published API change. happy-dom 21 turns off CSS file and iframe page loading by default (SSRF hardening); none of the DOM tests load either.
