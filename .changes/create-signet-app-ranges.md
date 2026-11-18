### create-signet-app: apps install the current Signet releases

Scaffolded apps asked for `@dapplelight/signet-server` `^0.5.0` and `@dapplelight/signet-ui` `^0.3.5`; on 0.x a caret keeps the minor, so they installed the old releases and failed to typecheck against the 0.6 server modules the API imports. They now ask for `^0.6.1` and `^0.4.0`, and the scaffold test fails when a range misses the current release.
