Verify the current phase is complete and meets the quality bar.

Find the current phase in `docs-v2/IMPLEMENTATION-PLAN.md` (`Status: In progress`). Run these checks in order; report pass/fail per item; do not flip `Status:` to `Complete` until every check is green.

## Build & lint

1. `cargo build --release` (in `src-tauri/`) — zero errors. On Windows requires `OPENSSL_DIR="C:/Users/Adrian/scoop/apps/openssl/current"`.
2. `cargo clippy -- -D warnings` — zero warnings.
3. `cargo test` — all tests pass.
4. `npx tsc --noEmit` — zero errors.
5. `npx eslint .` — zero errors. (`no-cross-store-imports` lands in Phase 0; available from Phase 0 onward.)
6. `npx prettier --check .` — clean.
7. **`ts-rs` drift check** (Phase 0 onward): regenerate `src/lib/types.ts` via `cargo test ts_rs_export`, then `git diff --exit-code src/lib/types.ts` — must be a no-op.

## Phase content

8. Walk every `- [ ]` Testable Checkpoint in the current phase block. For each: verify the checkpoint manually (run the command, exercise the UI, inspect the DB row, grep the logs — whatever the checkpoint asserts). Tick `- [x]` only on a real pass.
9. The feature doc(s) cited in the phase's Inputs each have their own checkpoint list — confirm those pass too (the phase's "All `features/NN` Testable Checkpoints pass" line).

## Quality bar (CLAUDE.md §Quality bar — definition of done)

10. **Error states handled.** Walk the `LoomError` variants the phase's surface can produce (Doc 12). Each has a defined display rule (toast, inline, modal). Verify by triggering at least one error path manually.
11. **Empty states rendered** per Doc 12. Blank screens are bugs.
12. **Visually consistent** with Docs 02, 08, 27. No hex values in components — grep the diff for `#[0-9A-Fa-f]{3,8}` in `src/`.
13. **Tauri commands typed.** No raw `invoke("...", { ... })` in components — grep the diff: `import { invoke }` should only appear in `src/lib/tauriApi/`.
14. **Sensitive data protected.** No master key, API key, or user content in logs — grep captured `tracing` output. No secrets in `localStorage` — review `localStorage.setItem` call sites.
15. **No forbidden patterns** (CLAUDE.md §Forbidden patterns). Grep the diff for `// Phase`, raw `.lock()` on AppState fields, string keys for settings (`SELECT.*FROM settings WHERE key`), `.unwrap()` in production paths, `--no-verify`.
16. **Audit items on this phase's surface ticked** in `PRE-IMPLEMENTATION-AUDIT.md`. Append a Resolution log entry for each.

## Outcome

- **All green:** flip `Status:` to `Complete` in `IMPLEMENTATION-PLAN.md`. Tidy `Resumption notes:` (consolidate, drop superseded lines, leave a final one-liner that the next agent can read cold). Commit.
- **Anything red:** report exactly what failed and where. Do not flip `Status:`. The phase is not done.
