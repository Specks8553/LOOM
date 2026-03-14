# Common Pitfalls & PRD Reference

## PRD Quick Reference

When in doubt, read the PRD. The documents are implementation-ready — they contain
SQL DDL, Rust structs, TypeScript interfaces, CSS snippets, ASCII layouts, and
precise behavioral specs.

| Question | Read |
|---|---|
| How does the app launch? What screens exist? | Doc 11 |
| What does X look like? Colors? Spacing? | Doc 02 |
| What happens when data is empty? | Doc 03 |
| How does onboarding work? | Doc 07 |
| How are messages structured? How does send work? | Doc 09 |
| How does branching/editing/regeneration work? | Doc 09 §7–§8 |
| What settings exist? Defaults? | Doc 05 |
| How does the Control Pane work? Context docs? | Doc 10 |
| How does rate limiting work? | Doc 06 |
| How do errors surface? Error taxonomy? | Doc 14 |
| How does Ghostwriter work? | Doc 16 |
| How does the Branch Map work? Checkpoints? | Doc 17 |
| How does Accordion (context compression) work? | Doc 18 |
| How do image uploads work? | Doc 19 |
| How does Reader View / export work? | Doc 04 |
| What keyboard shortcuts exist? | Doc 13 |
| What Rust crates? What npm packages? | Doc 15 |
| What DB tables exist? Complete schemas? | Doc 15 §7, plus individual docs |
| What Tauri commands exist? | Each doc has a command reference table at the end |
| What is planned for v1.1 / v2? | Doc 20 (image gen stubs), Doc 21 (TTS stubs) |

## Common Pitfalls (Read Before Each Phase)

### Rust / Tauri

- **SQLCipher on Windows:** The `bundled` feature compiles OpenSSL from source. First build may take 5+ minutes. If it fails, check that `perl` and `nasm` are on PATH (required for OpenSSL build). Visual Studio Build Tools must be installed with C++ workload.
- **Tauri v2 IPC serialization:** All types crossing the IPC boundary must derive `serde::Serialize` + `serde::Deserialize`. Enums need `#[serde(tag = "type")]` or similar for clean JSON.
- **Mutex in AppState:** Use `Mutex<Option<T>>` for fields that can be absent (e.g., DB connection when locked). Always drop the lock guard before calling other locked methods to avoid deadlocks.
- **Stream cancellation:** Dropping a `reqwest` response stream doesn't immediately cancel the HTTP connection. Use an `AbortHandle` or a `CancellationToken` to properly cancel Gemini streaming.

### React / Frontend

- **Zustand store subscriptions:** Use selectors (`useStore(s => s.field)`) to avoid unnecessary re-renders. Never subscribe to the entire store.
- **shadcn/ui Dialog:** Doesn't unmount children on close by default. If a dialog contains state that should reset on close, use a key prop or reset in an onOpenChange handler.
- **Tailwind class conflicts:** Use `cn()` (clsx + tailwind-merge) everywhere. Raw `className` string concatenation causes class conflicts that silently break styles.
- **Tauri events (streaming):** `listen()` returns an unlisten function. Always clean up in useEffect return. Forgetting this causes memory leaks and ghost listeners.

### Design

- **Bubble max-width:** 80% of Theater width, not a fixed pixel value. This adapts to pane resizing.
- **Section headers:** 11px, Inter 500, uppercase, letter-spacing 0.08em, --color-text-muted. This is consistent across Navigator, Control Pane, Branch Map, Settings.
- **Escape chain:** Priority order is modal > Branch Map > Feedback > Ghostwriter > Editor (dirty) > Editor (clean) > Reader View > no-op. Getting this wrong causes confusing UX. Implement it as a single function with explicit priority checks (Doc 13 §1.1).

## Quality Bar

Before considering any phase complete:

1. **Does it compile without warnings?** Both `cargo build` and `tsc --noEmit`.
2. **Do all Testable Checkpoints pass?** Every single one, manually verified.
3. **Are error states handled?** Not just the happy path — what happens when the Gemini call fails? When the DB is locked? When the network is down?
4. **Are empty states rendered?** Not blank screens. Specific messages with specific actions per Doc 03.
5. **Is it visually consistent with Doc 02?** Correct fonts, sizes, colors, spacing. Screenshot-compare if needed.
6. **Are Tauri commands typed?** Frontend has typed wrappers, not raw invoke calls.
7. **Is sensitive data protected?** No keys in logs, no content in error messages, no secrets in localStorage.
8. **Is the code committed?** With a descriptive commit message referencing the phase.
