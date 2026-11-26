### signet-lib: a server error no longer blocks the form after the field is edited

- `applyServerErrors` now clears a field's server error the first time that field's value changes. TanStack only dropped it when a validator ran, so a field without validators stayed blocked on "Already taken" even after the user fixed it.
- `clearServerErrors` accepts the server's dotted paths (`guests.2.name`), as `applyServerErrors` already did.
