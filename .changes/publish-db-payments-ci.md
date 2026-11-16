### release: signet-db and signet-payments publish from CI

Both packages now have a Trusted Publisher and are in the release order, so
the release workflow publishes signet-db 0.1.0 and signet-payments 0.1.0, then
create-signet-app 0.3.0 (npm has up to 0.2.2), whose full template installs
them. Merging this changes no package.json, so the workflow is run by hand. PUBLISHING.md's first-release steps
use `npm trust` before the first version instead of a hand publish.
