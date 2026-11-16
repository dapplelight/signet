### server: publish Phase 2 and 3 exports

signet-server 0.5.0, signet-ui 0.3.0, signet-lib 0.4.0, signet-tokens 0.3.0, signet-ai 0.4.1 and signet-db 0.1.1 publish the export paths that landed on main without a version bump. create-signet-app 0.4.1 points its templates at these versions; 0.4.0 scaffolded apps that imported `signet-server/auth/otp` and other paths missing from npm. CI now fails when a package's export paths differ from npm for the same version.
