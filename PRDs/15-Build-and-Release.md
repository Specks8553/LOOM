# 15 — Build and Release

## Purpose

This document specifies LOOM's build configuration, target platforms,
Tauri configuration, dependency constraints, and release process for v1.

---

## 1. Target Platforms

| Platform | Architecture | Minimum OS |
|---|---|---|
| macOS | arm64 (Apple Silicon) | macOS 12 Monterey |
| macOS | x86_64 (Intel) | macOS 12 Monterey |
| Windows | x86_64 | Windows 10 (build 19041) |
| Linux | x86_64 | Ubuntu 22.04 LTS |

Universal macOS binary (arm64 + x86_64 fat binary) is the preferred macOS release.

---

## 2. Window Configuration (`tauri.conf.json`)

```json
{
  "tauri": {
    "windows": [
      {
        "title": "LOOM",
        "width": 1280,
        "height": 800,
        "minWidth": 1100,
        "minHeight": 700,
        "resizable": true,
        "fullscreen": false,
        "decorations": true,
        "transparent": false
      }
    ]
  }
}
```

**Minimum window size:** `1100 × 700px`.

At 1100px width with default pane widths (Navigator 260px + Control Pane 280px):
- Theater minimum effective width: `1100 - 260 - 280 = 560px`
- Bubble max-width at 80%: `~448px` — sufficient for comfortable reading

At 1100px width with Control Pane collapsed (auto at < 1200px):
- Theater effective width: `1100 - 260 = 840px` ✓

---

## 3. Tech Stack

| Layer | Technology |
|---|---|
| Shell / IPC | Tauri v2 |
| Systems / Backend | Rust (2021 edition) |
| Frontend | React 19 + TypeScript 5 |
| Build tool | Vite 5 |
| State management | Zustand |
| UI components | shadcn/ui (Radix primitives) |
| Styling | Tailwind CSS |
| Notifications | Sonner |
| Markdown | `marked` or `remark` |
| Encryption | SQLCipher (SQLite extension) |
| HTTP client (Rust) | `reqwest` with `tokio` runtime |
| Key derivation | `pbkdf2` + `sha2` |
| Random generation | `rand` |
| Timezone handling | `chrono` + `chrono-tz` |
| Error types | `thiserror` |
| Serialisation | `serde` + `serde_json` |

---

## 4. Key Tauri Plugins

| Plugin | Purpose |
|---|---|
| `tauri-plugin-dialog` | File open/save dialogs, folder picker |
| `tauri-plugin-fs` | Atomic file writes, directory operations |
| `tauri-plugin-shell` | Open folder in system file manager |
| `tauri-plugin-process` | App restart on crash recovery |
| `tauri-plugin-window-state` | Window size/position persistence |

---

## 5. Rust Crate Dependencies

```toml
[dependencies]
tauri       = { version = "2", features = ["unstable"] }
serde       = { version = "1", features = ["derive"] }
serde_json  = "1"
rusqlite    = { version = "0.31", features = ["sqlcipher", "bundled"] }
tokio       = { version = "1", features = ["full"] }
reqwest     = { version = "0.12", features = ["json", "stream"] }
pbkdf2      = "0.12"
sha2        = "0.10"
rand        = "0.8"
chrono      = { version = "0.4", features = ["serde"] }
chrono-tz   = "0.9"
thiserror   = "1"
log         = "0.4"
env_logger  = "0.11"
uuid        = { version = "1", features = ["v4"] }
aes-gcm     = "0.10"
hex         = "0.4"
```

---

## 6. Frontend Dependencies

```json
{
  "dependencies": {
    "react":           "^19.0.0",
    "react-dom":       "^19.0.0",
    "zustand":         "^5.0.0",
    "@tauri-apps/api": "^2.0.0",
    "lucide-react":    "^0.383.0",
    "marked":          "^12.0.0",
    "sonner":          "^1.0.0",
    "clsx":            "^2.0.0",
    "tailwind-merge":  "^2.0.0"
  },
  "devDependencies": {
    "typescript":               "^5.0.0",
    "vite":                     "^5.0.0",
    "@vitejs/plugin-react":     "^4.0.0",
    "tailwindcss":              "^3.0.0",
    "autoprefixer":             "^10.0.0",
    "@types/react":             "^19.0.0",
    "@types/react-dom":         "^19.0.0"
  }
}
```

---

## 7. Database Schema

### 7.1 World Database (`loom.db`) — Full Table List

All tables created by `init_schema()` in a new world:

| Table | Purpose |
|---|---|
| `items` | Vault tree nodes (stories, folders, docs, images) |
| `messages` | Conversation messages (DAG) |
| `story_settings` | Per-story key-value settings |
| `checkpoints` | Branch checkpoints (used by Branch Map + Accordion) |
| `accordion_segments` | Accordion segment summaries |
| `templates` | User-defined Source Document templates |
| `settings` | World-level key-value settings |
| `telemetry` | Rate limiter counters (3 rows: text, image_gen, tts) |
| `attachment_history` | Doc attachment/detach audit trail |

### 7.2 Complete `items` Table

```sql
CREATE TABLE IF NOT EXISTS items (
    id           TEXT PRIMARY KEY,
    story_id     TEXT,
    parent_id    TEXT REFERENCES items(id) ON DELETE SET NULL,
    item_type    TEXT NOT NULL CHECK(item_type IN ('Story','Folder','SourceDocument','Image')),
    item_subtype TEXT,
    name         TEXT NOT NULL,
    content      TEXT NOT NULL DEFAULT '',
    description  TEXT,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL,
    modified_at  TEXT NOT NULL,
    deleted_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_items_parent   ON items(parent_id);
CREATE INDEX IF NOT EXISTS idx_items_type     ON items(item_type);
CREATE INDEX IF NOT EXISTS idx_items_deleted  ON items(deleted_at);
```

---

## 8. App Data Directory Structure

```
<app_data_dir>/
  app_config.json        ← master salt + iterations + world list
  loom_recovery.json     ← optional, user-saved
  worlds/
    <world_uuid>/
      loom.db            ← SQLCipher world database
      world_meta.json    ← world metadata + accent_color cache
      cover.jpg          ← optional cover image
      images/            ← image source documents
        <uuid>.jpg
        <uuid>.png
```

macOS: `~/Library/Application Support/LOOM/`
Windows: `%APPDATA%\LOOM\`
Linux: `~/.local/share/LOOM/`

---

## 9. App Identifier and Naming

```json
{
  "tauri": {
    "bundle": {
      "identifier": "com.loom.app",
      "productName": "LOOM",
      "shortDescription": "Private AI writing companion",
      "longDescription": "AI-assisted creative writing, encrypted on your device.",
      "copyright": "Copyright © 2026",
      "category": "Productivity"
    }
  }
}
```

---

## 10. Release Process (v1)

1. Increment version in `tauri.conf.json` + `Cargo.toml` + `package.json`
2. Run full build: `cargo tauri build --target universal-apple-darwin` (macOS)
3. Run full build: `cargo tauri build` on Windows and Linux CI runners
4. Code-sign macOS bundle (Developer ID Application certificate)
5. Notarize macOS `.dmg` via `xcrun notarytool`
6. Windows: sign `.msi` with EV certificate
7. Distribute via GitHub Releases (`.dmg`, `.msi`, `.AppImage`)
8. Auto-update endpoint: not included in v1 (manual update by re-download)

---

## 11. Development Build

```bash
# Install Rust + Tauri CLI
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
cargo install tauri-cli

# Install Node dependencies
npm install

# Development mode (hot reload)
cargo tauri dev

# Production build
cargo tauri build
```

`RUST_LOG=debug cargo tauri dev` enables debug logging.

---

## 12. Security Checklist

| Requirement | Status |
|---|---|
| Master key stored only in `AppState` (memory) | ✓ Required |
| Master key zeroed on lock/app close | ✓ Required |
| Key verification sentinel (AES-256-GCM) in `app_config.json` | ✓ Required |
| API key stored only in SQLCipher DB + `AppState` | ✓ Required |
| API key never in localStorage, app_config.json, or logs | ✓ Required |
| User content never logged | ✓ Required |
| `app_config.json` atomic writes (temp + rename) | ✓ Required |
| SQLCipher AES-256 with PBKDF2 salt per vault | ✓ Required |
| New salt generated on every password change | ✓ Required |
| Tauri `allowlist` restricted to required plugins only | ✓ Required |
| CSP configured in `tauri.conf.json` | ✓ Required |
| No external network requests except Gemini API | ✓ Required |
| Fonts bundled locally (no Google Fonts CDN) | ✓ Required |
