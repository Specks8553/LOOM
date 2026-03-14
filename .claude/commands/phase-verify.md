Verify the current phase is complete and meets the quality bar.

Run these checks in order:
1. `npx tsc --noEmit` — must produce zero errors.
2. `cargo check` in `src-tauri/` — must produce zero errors (skip if no Rust changes this phase).
3. Review the phase plan's Testable Checkpoints list and confirm each one passes.
4. Check for empty states — are all zero-data conditions handled per Doc 03?
5. Check for error handling — does every `invoke()` call have a `.catch()`?
6. Check for security — no keys in logs, no secrets in localStorage, no raw invoke() calls.
7. Report results: which checks passed, which failed, and what needs fixing.
