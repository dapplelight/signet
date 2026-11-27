### signet-lib: telemetry only accepts own declared names

- `./telemetry` no longer treats inherited object keys (`constructor`, `toString`, `__proto__`) as declared events or fields. Before, an event with one of those names was accepted with empty props, and a field with one of those names threw inside `track()` (which caught it). Now both are dropped like any undeclared name.
