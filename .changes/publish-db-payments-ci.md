### release: signet-db and signet-payments publish from CI

Both packages now have a Trusted Publisher and are in the release order, so
the release workflow publishes signet-db 0.1.0 and signet-payments 0.1.0, then
create-signet-app 0.4.0 (npm has 0.3.0 from before the full template existed),
whose full template installs them. PUBLISHING.md's first-release steps use
`npm trust` before the first version instead of a hand publish.
