# Code Standards

## Rust

- **Edition 2021.** Use idiomatic Rust — `Result<T, LoomError>`, `?` operator, no unwrap() in production paths.
- **Every Tauri command** returns `Result<T, LoomError>`. No panics crossing the IPC boundary.
- **`LoomError`** is the single error type (Doc 14 §1.1). Map external errors via `From` impls.
- **Logging:** Use `log` crate. INFO for lifecycle events, DEBUG for request metadata (IDs, token counts), WARN for approaching limits, ERROR for failures. **Never log** master key, API key, user content, message text, feedback, or document content.
- **Atomic file writes:** Always write to `.tmp` then `fs::rename`. Applies to `app_config.json`, `world_meta.json`, any config file.
- **Key zeroing:** Overwrite `[u8; 32]` with `0x00` before dropping. Use `zeroize` crate or manual fill.
- **SQLCipher:** Use `rusqlite` with `features = ["sqlcipher", "bundled"]`. Always PRAGMA key immediately after opening.
- **Tests:** Unit tests for `crypto.rs`, `rate_limiter.rs`, `history.rs` at minimum. Use in-memory SQLite (non-encrypted) for DB logic tests.

## TypeScript / React

- **Strict mode.** No `any` unless wrapping a third-party type.
- **Zustand stores** per Doc 11 §11. Don't add new stores without clear justification — prefer extending existing ones.
- **Component files** are functional components with hooks. No class components.
- **Styling:** Tailwind utility classes + CSS variables from `globals.css`. Use `cn()` (clsx + tailwind-merge) for conditional classes. Override shadcn/ui defaults with LOOM's design tokens, not inline styles.
- **No localStorage for sensitive data.** Only UI preferences: pane widths, collapsed states, expanded paths, auto-lock timer, export folder, onboarding_complete.
- **Tauri IPC:** All `invoke()` calls wrapped in typed async functions in `src/lib/tauriApi.ts` (or similar). No raw `invoke("command_name", { ... })` scattered through components.
- **Error handling:** Every `invoke()` call has a `.catch()` that surfaces the error via toast, banner, or inline message per Doc 14 §2.

## CSS / Design

- **Read Doc 02 before touching any visual.** It is pixel-precise.
- **Color palette:** `globals.css` CSS variables are the single source of truth. Never hardcode hex values in components.
- **Dark editorial aesthetic.** Minimal chrome, generous typography, writing is the focus. Reference points: Craft dark mode, Bear dark mode, early Linear.
- **Accent color is runtime-computed** from a single hex input. `applyAccentColor()` derives hover, subtle, and text variants. Feature colors (Ghostwriter, Checkpoint, Accordion) track accent by default but can be independently overridden.
- **Type scale** per Doc 02 §3.3. Pane headers 11px uppercase. Prose 15px serif. UI body 13px sans. Don't invent new sizes.
- **Transitions:** 150–300ms ease. Nothing should feel sluggish or jumpy.
- **Empty states are first-class UI** (Doc 03). Every zero-data condition has specified content, styling, and actions. Blank screens are bugs.
