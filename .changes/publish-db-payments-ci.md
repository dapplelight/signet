### release: signet-db and signet-payments publish from CI

Both packages now have a Trusted Publisher and are in the release order, so
CI publishes signet-db 0.1.0 and signet-payments 0.1.0, then create-signet-app
0.3.0, whose full template installs them. PUBLISHING.md's first-release steps
use `npm trust` before the first version instead of a hand publish.
