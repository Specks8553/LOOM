# 20 — Settings and Themes

> **Status:** Complete — visual values provisional
> **Owner:** Settings & Themes umbrella (D-16)
> **Last updated:** 2026-05-04 — Feedback design pass (D-17): Features tab adds Feedback colour row (`feedback_color`); `ThemeSnapshot` extended with `feedback`; `applyTheme()` writes the `--color-feedback` triad. Default `#f59e0b`; does not track accent. See Doc 28.
> **Earlier:** 2026-05-03 — pre-implementation audit resolution: `ThemeSnapshot` widened to cover every world-overridable visual key (CD-1); Ghostwriter / Accordion CSS variable names switched to triad pattern (`<feature>`, `-hover`, `-subtle`) plus Ghostwriter's `-diff` (CD-2); world setting key for Ghostwriter renamed `ghostwriter_color` (CD-2 — Doc 03 updated); cache_enabled toggle dropped from Settings (CD-12 / Q8 — Doc 22 updated).
> **Earlier:** 2026-05-03 — D-16 umbrella settled (see 00-INDEX D-16).

---

## Overview

LOOM 2.0 settings are organised in two scopes: **App** (account- and install-wide) and **World** (per-world overrides). There is no story scope — `story_state` (Doc 03) holds operational state, not user-tunable settings.

The backend resolves the cascade `World → App → hardcoded fallback` in `services/settings.rs` and returns a single merged object to the frontend (Doc 03 §Settings cascade rule). The frontend never performs cascade logic.

Settings are presented on a **full workspace surface** — opening Settings hides the mode switcher and right pane; `← Back` restores the previous mode. The pattern matches DocEditor (D-13).

---

## Settings Scopes

### App-Level Settings
Stored in `app_settings.db` (SQLCipher, master key — Doc 03 §`app_settings`). Always loaded when the vault is unlocked. Includes the API key, all hard defaults, and the developer-only internal prompts.

### World-Level Settings
Stored in each world's `loom.db` `settings` table — **overrides only**. When a key is absent, the App default applies. When present, it shadows the App default. The World scope cannot introduce keys that don't exist in App.

### Why no Story scope
v1.0's `story_settings` was renamed to `story_state` (D-03-A) and narrowed to operational fields: `context_doc_ids`, `active_mode`, `active_aux_slot`, `draft`. None of these are user-configurable — they are set by the corresponding feature surface (paperclip in vault, mode switcher, aux selector, input area). v2.0 has no per-story settings.

---

## Surface and Navigation

Settings is a full-surface view in the workspace region:

```
┌─ Top bar ─────────────────────────────────────────────────┐
│ ← Back                                                     │
│                                                            │
│  [ App ▾ ] [ World ▾ ]                  🔍 [____] [ ⚑ ]  │
├──────────────────────────────────────────────────────────┤
│ Tabs           │ Detail pane                               │
│ • General      │ ────────────────────────────────────────  │
│ • Appearance   │  Setting label              [ value ]  ↺  │
│ • Gemini       │  Setting label              [ value ]     │
│ • System Instr.│  …                                        │
│ • Templates    │                                           │
│ • Features     │                                           │
│ • Rate Limits  │                                           │
│ • Developer    │                                           │
└──────────────────────────────────────────────────────────┘
```

- Top-left: **`← Back`** restores the previous mode (Story / Handover / Consulting / DocEditor).
- Top-centre: **chapter switcher** — `App` and `World` segmented control. Switching chapters swaps the tab list.
- Top-right: **search** (scope-scoped to current chapter) plus an **override-status filter chip** (`⚑`) that limits results to overridden keys (World chapter only).
- Left: tab list (varies per chapter, below).
- Right: detail pane for the selected tab.

Mode switching is not possible while Settings is open — the mode switcher is hidden. `← Back` first.

---

## App Chapter Tabs

Eight tabs:

| # | Tab | Purpose |
|---|---|---|
| 1 | General | Account / install behaviour |
| 2 | Appearance | App-default theme tokens |
| 3 | Gemini | API key, model, generation parameters, cache parameters |
| 4 | System Instructions | The three mode SIs (story / handover / consulting) — defaults |
| 5 | Templates | Source document templates (built-ins + user-created) |
| 6 | Features | Per-feature settings (Ghostwriter, Accordion) — defaults |
| 7 | Rate Limits | Ceilings + live counters + reset |
| 8 | Developer | Internal prompts + diagnostic toggles |

## World Chapter Tabs

Five tabs (the App-only tabs — General, Rate Limits, Developer — and the API key field are not present):

| # | Tab | Purpose |
|---|---|---|
| 1 | Appearance | World-override accent + feature colours |
| 2 | Gemini | World-override model + generation + cache parameters |
| 3 | System Instructions | World-override mode SIs |
| 4 | Templates | World-only templates (additive — built-ins not duplicated) |
| 5 | Features | World-override Ghostwriter / Accordion colours |

Each World tab has a **"Reset all overrides in this tab"** button at the top.

---

## Tab Specifications

### 1. General (App only)

| Field | Type | Default | Notes |
|---|---|---|---|
| Auto-lock timer | minutes (slider + numeric) | 15 | Stored as `auto_lock_secs`. Reset on any meaningful UI activity (2026-04-27 decision); 15 min is a failsafe |
| Startup behaviour | radio | Last world | Choices: `Last world` / `World picker` / `Lock screen only` |
| Export folder | folder picker | OS-default | Where `.loom-backup` zips are written |
| Export settings | button | — | Bundles app + world settings into the `.loom-backup` zip (per D-15 Q24) |
| About / version | static | — | App version, Tauri version, Gemini SDK version |

### 2. Appearance

| Field | Type | App default | World override |
|---|---|---|---|
| Accent colour | hex input + swatch + derived-tones preview | `#7c3aed` | ✅ |

`applyTheme()` reflects on edit immediately. No light/dark toggle — v2.0 ships dark-only. Light mode is deferred to v2.1 (Out of Scope).

### 3. Gemini

| Field | Scope | Default | Notes |
|---|---|---|---|
| API key | App only | `""` | Masked input with "Show" toggle. Encrypted in `app_settings.db`. Changing invalidates all caches |
| Model | App + World | `gemini-2.5-flash` | Selectable from a curated list |
| `gen_temperature` | App + World | `1.0` ⚠️ | Range 0.0–2.0 |
| `gen_top_p` | App + World | `0.95` ⚠️ | Range 0.0–1.0 |
| `gen_top_k` | App + World | `40` ⚠️ | Range 1–100 |
| `gen_max_output_tokens` | App + World | `8192` ⚠️ | Range 1–32768 |
| `gen_summarise_temperature` | App + World | `0.3` ⚠️ | Accordion summarisation (D-12) |
| `gen_summarise_top_p` | App + World | `0.95` ⚠️ | |
| `gen_summarise_top_k` | App + World | `40` ⚠️ | |
| `gen_summarise_max_output_tokens` | App + World | `2048` ⚠️ | Summaries are shorter than story output |
| `cache_ttl_secs` | App + World | `3600` | Explicit cache TTL (D-11) |
| `cache_min_tokens` | App + World | `4096` ⚠️ | Auto-create cache only when prefix exceeds this (TODO O16; Gemini 2.5 Pro published minimum) |
| `context_token_limit` | App + World | `128000` | Soft ceiling for the token meter |

API key is App-only; everything else is world-overridable.

### 4. System Instructions

Three persona prompts:

| Field | Scope | Default |
|---|---|---|
| `story_si` | App + World | `""` (built-in fallback in `services/`) |
| `handover_si` | App + World | `""` (built-in fallback in `services/`) |
| `consulting_si` | App + World | `""` (built-in fallback in `services/`) |

Editor: `<textarea>` + `[Preview]` Markdown toggle (mutually exclusive — same model as DocEditor per D-13). Each field has `[Restore Default]` that writes the hardcoded baseline back. World tab also exposes the `↺` revert (clears the override entirely).

The mode SIs are sent as the Gemini `system_instruction` field and are part of the cached prefix (Doc 22). Editing invalidates the affected cache.

### 5. Templates (App + World)

Inline editor — no separate surface. Tab layout: list on the left (built-ins first, then user-created), editor on the right.

**Built-ins** (App scope only): `image`, `character_profile`, `world_building`. Renameable; `default_content` editable; `[Restore Default]` per built-in. **Not deletable.**

**User-created** (App or World scope): full CRUD.

Each row exposes:
- Name (editable)
- Subtype (read-only for built-ins)
- `default_content` (editor: `<textarea>` + Markdown preview toggle)
- Delete (user-created only)
- Restore Default (built-ins only)

`templates.creator_instructions` (forward-compat for the v2.1 Source Document Creator) is **hidden** in v2.0 — the column exists in the schema but is not surfaced.

World templates are additive — they appear alongside App templates when listing, never replace them.

### 6. Features

Per-feature settings:

| Feature | Field | Scope | Default | Notes |
|---|---|---|---|---|
| Ghostwriter | Feature colour (`ghostwriter_color`) | App + World | tracks accent | Drives `--color-ghostwriter` and derived `-hover` / `-subtle` / `-diff` tokens. Independent override; `↺` reverts to "track accent" |
| Accordion | Feature colour (`accordion_color`) | App + World | tracks accent | Drives `--color-accordion` and derived tokens. Independent override; `↺` reverts to "track accent" |
| Feedback | Feature colour (`feedback_color`) | App + World | `#f59e0b` ⚠️ | Drives `--color-feedback` and derived `-hover` / `-subtle` tokens (Doc 28). Default does **not** track accent — feedback uses a stable amber by default; the override is independent. `↺` reverts to the stable default rather than to accent |

"Track accent" is the implicit default for Ghostwriter and Accordion when the override is empty — `services/settings.rs` resolves the empty value to the current scope's accent. Feedback's default is the literal `#f59e0b`; an empty override resolves to that hex, not to accent.

### 7. Rate Limits (App only)

Configurable ceilings (the writer can set values **lower** than Gemini's published limit, never higher):

| Field | Default | Notes |
|---|---|---|
| `rate_limit_rpm` | 10 | Requests per minute |
| `rate_limit_tpm` | 250000 | Tokens per minute |
| `rate_limit_rpd` | 1500 | Requests per day |

**Live counter view** below the inputs: current minute usage, current day usage, time-to-next-refill. Updates at 1 Hz (subscribed to telemetry events).

**`[Reset counters]`** button — calls the Rust `reset_rate_limiter` command. Confirmation modal before zeroing.

### 8. Developer (App only)

**Internal prompts** — editable but rarely should be:

| Key | Purpose |
|---|---|
| `prompt_ghostwriter` | Surgical-stitching scaffold (D-14): `<context_before>` / `<selected_passage>` / `<context_after>` template |
| `prompt_accordion_summarise` | Summarisation prompt body (D-12) |
| `prompt_accordion_fake_user` | Fake-pair injection format for collapsed segments (D-12) |
| `prompt_handover_seed` | Handover persona / instruction seed (D-10) |
| `prompt_consulting_seed` | Consulting persona / instruction seed (D-10) |

Each has `[Restore Default]` that writes the hardcoded baseline from `services/` constants back to `app_settings`.

**Diagnostic toggles:**
- Verbose logging — increases log level for the active session
- API Debug Preview — enables the inspector hook for the deferred PRD 23 modal

---

## Theme System

### Dark Mode (v2.0)
v2.0 ships dark-only. Light mode is deferred to v2.1.

### Accent Colour
- **App default:** `app_settings.accent_color`
- **World override:** `settings.accent_color` (per-world)
- Editing the World value auto-creates the override (cascade UX rule, below). `↺` clears the override and snaps back to the App default.

### Feature Colours (Ghostwriter, Accordion)
Track accent by default — when the resolved value is empty, the cascade resolver substitutes the current scope's accent. Each feature can be overridden independently per scope.

### `applyTheme()` Contract

```ts
applyTheme(snapshot: ThemeSnapshot): void

interface ThemeSnapshot {
  // Resolved values (World override → App default → hardcoded fallback)
  accent: string;          // hex
  ghostwriter: string;     // hex — = accent if not overridden
  accordion: string;       // hex — = accent if not overridden
  checkpoint: string;      // hex — = accent if not overridden
  feedback: string;        // hex — = #f59e0b if not overridden (Doc 28; does not track accent by default)
  bubbleUser: string;      // hex — = accent-subtle equivalent if not overridden
  bubbleAi: string;        // hex
  bodyFont: string;        // CSS font-family stack — drives --font-theater-body
}
```

**Behaviour:** writes every theme-related CSS variable to `:root`. Single function, single call site, single subscription. Derivation logic for `-hover` / `-subtle` / `-text` variants is the same as v1.0's `applyAccentColor` — kept in one place to prevent the v1 drift between `applyAccentColor`, `applyBodyFont`, `applyBubbleColors`, `applyFeatureColors`.

Variables written per call:

- **Accent:** `--color-accent`, `--color-accent-hover`, `--color-accent-subtle`, `--color-accent-text`
- **Ghostwriter:** `--color-ghostwriter`, `--color-ghostwriter-hover`, `--color-ghostwriter-subtle`, `--color-ghostwriter-diff`
- **Accordion:** `--color-accordion`, `--color-accordion-hover`, `--color-accordion-subtle`
- **Checkpoint:** `--color-checkpoint`
- **Feedback:** `--color-feedback`, `--color-feedback-hover`, `--color-feedback-subtle`
- **Bubbles:** `--bubble-user-bg`, `--bubble-ai-bg`
- **Body font:** `--font-theater-body`
- **shadcn shadows:** `--primary`, `--ring` (RGB triplets, derived from accent)

**Triggers** (one `useEffect` at App root):
1. App phase becomes `workspace` → resolve App-level snapshot, call.
2. World opens → resolve App+World snapshot via cascade resolver, call.
3. World switches → re-resolve, call.
4. `settingsStore` change to any field above → re-resolve, call.

No light/dark toggle in v2.0 (deferred to v2.1).

---

## Cascade UX

The cascade is `World → App → hardcoded fallback` (Doc 03). User-facing behaviours:

**Override creation.** Editing a value in the World chapter automatically creates a `settings` row (no explicit "Override" toggle). Rationale: writers expect editing a value to take effect; an extra toggle is friction.

**Override visualisation.** Overridden fields in the World chapter show a `↺` revert icon next to the input. Clicking it deletes the `settings` row, snapping the value back to the App default.

**Per-tab "Reset all overrides".** A button at the top of each World tab clears every override on that tab. Confirmation modal before applying.

**Hardcoded fallback.** Never shown in UI. The fallback is a backend safety net for settings that have neither a World nor App value set (e.g. a fresh install before defaults are written).

---

## Default Values

App defaults live in `app_settings` (Doc 03 §`app_settings`). The hardcoded fallback for each key lives in a constant in `services/settings.rs` and is used when neither an App value nor a World value exists. The per-key default table is authoritative in Doc 03 — Doc 20 references it; the lists in §Tab Specifications are convenience copies and should match.

---

## Persistence Rules

| Store | What lives there |
|---|---|
| `app_settings.db` (SQLCipher, master key) | API key; all app-level settings; internal prompts |
| World `loom.db` `settings` table | Overrides only |
| `story_state` (per-story, in `loom.db`) | Operational state only — `context_doc_ids`, `active_mode`, `active_aux_slot`, `draft` |
| `app_config.json` (unencrypted) | PBKDF2 salt; key sentinel; last-opened-world hint; `onboarding_complete` flag |
| `localStorage` | UI ephemera only — pane widths, expanded paths, collapsed states, current Settings tab, scroll positions, `exportFolder` mirror |

**Never in `localStorage` or `app_config.json`:** API key, master key, any setting value, any user content. (Red Lines, CLAUDE.md.)

---

## Validation

Two-layer enforcement:

**Frontend (primary UX).** Per-field validator runs on input. Invalid → inline error message under the field, field border in `--color-danger`, **auto-save suppressed** until valid. The in-flight value stays in component-local state; `settingsStore` is not written.

**Backend (defense in depth).** Every `save_app_setting` / `save_world_setting` Tauri command revalidates against the same schema. Returns `LoomError::InvalidSettingValue { key, reason }` on failure. The frontend treats backend rejection as a hard error (toast + revert).

**Schema source.** Single source of truth in `services/settings.rs` — exports per-key validators (type, range, enum, regex). Frontend imports the typed contract via the IPC layer; no schema drift between the two.

---

## Save Semantics

**Debounced auto-save**, ~1 s after last edit (consistent with DocEditor per D-13). No Save button. Pending writes flush on `← Back`, vault lock, world switch, app close.

For **invalid input**: auto-save is suppressed until the value is valid. The in-flight value stays in component state; the underlying setting is unchanged.

---

## Search

Text search over **setting names only** (not body content of SIs / templates / prompts — those would explode the result list). Results scope to the current chapter.

The `⚑` filter chip restricts results to keys that are **overridden in the current World** (only meaningful in the World chapter; hidden in App).

---

## Backend API

All commands live in `commands/settings.rs` and require the vault to be unlocked.

| Command | Signature | Purpose |
|---|---|---|
| `get_resolved_settings()` | `() -> ResolvedSettings` | Returns the merged cascade for the current world (or App-only if no world is open). |
| `get_app_settings()` | `() -> Map<String, String>` | Raw App values (Settings UI App chapter). |
| `get_world_settings()` | `() -> Map<String, String>` | Raw World overrides (Settings UI World chapter). |
| `save_app_setting(key, value)` | `(String, String) -> Result<()>` | Writes to `app_settings.db`. Validates server-side. Emits `settings_changed`. |
| `save_world_setting(key, value)` | `(String, String) -> Result<()>` | Writes to current world's `settings` table. Validates server-side. Emits `settings_changed`. |
| `clear_world_override(key)` | `(String) -> Result<()>` | Deletes the row from world `settings`. Emits `settings_changed`. |
| `clear_all_world_overrides_in_tab(tab)` | `(String) -> Result<u32>` | Tab-scoped bulk clear. Returns count cleared. |
| `restore_prompt_default(key)` | `(String) -> Result<()>` | Writes the hardcoded baseline for a `prompt_*` key. |
| `list_templates()` | `() -> Vec<Template>` | App + current world templates merged. |
| `save_template(template)` | `(Template) -> Result<()>` | CRUD for built-ins (rename / default_content) and user-created. |
| `delete_template(id)` | `(String) -> Result<()>` | User-created only. Built-ins return `LoomError::Forbidden`. |
| `restore_template_default(id)` | `(String) -> Result<()>` | Built-ins only. |
| `reset_rate_limiter()` | `() -> Result<()>` | Zeros the rate-limit counters. |
| `get_telemetry()` | `() -> Telemetry` | Live counter snapshot. |
| `export_settings_bundle(path)` | `(String) -> Result<()>` | Writes app + world settings into the `.loom-backup` zip per D-15. |

**Events:**

| Event | Payload | When |
|---|---|---|
| `settings_changed` | `{ scope: 'app' \| 'world', key: String }` | After any successful save / clear. Frontend re-fetches `get_resolved_settings()` and re-runs `applyTheme()` if relevant. |
| `telemetry_tick` | `Telemetry` | 1 Hz while Rate Limits tab is open. |

---

## Frontend State (`settingsStore`)

See Doc 06 for the full interface. Key responsibilities:

- Holds the resolved cascade returned by `get_resolved_settings()`.
- Holds the raw App values and raw World overrides (separately, for the App / World chapter views).
- Owns the validators (mirrored from `services/settings.rs` via the IPC contract).
- Triggers `applyTheme()` when accent / feature-colour fields change.

`exportFolder` is the only settings-related UI preference that is mirrored in `localStorage` (for fast access before the vault is unlocked).

---

## Edge Cases and Error Handling

**API key change while caches exist.** Caches are tied to the API key (Gemini-side). Changing the API key invalidates every cache. The backend marks all cache states stale and emits `cache_state_changed` per affected story / session. The Settings UI shows a confirmation modal: *"Changing the API key will invalidate all context caches. Continue?"*

**World accent override removal.** `↺` deletes the override; `applyTheme()` re-runs and the UI reflects the App default immediately. No reload required.

**Invalid template body.** Same validation pattern as other fields — auto-save suppressed; inline error.

**Settings export during active generation.** `export_settings_bundle` blocks while `isGenerating` is true. Surfaced as a toast: *"Wait for the current generation to finish, then try again."*

**Restore Default on a key with no hardcoded baseline.** The command returns `LoomError::NoBaseline { key }`. Should never happen for the listed keys — defensive only.

**Tab "Reset all overrides" with zero overrides.** Button is disabled; tooltip: *"No overrides on this tab."*

---

## Out of Scope

- **Per-story user settings** — all per-story values are operational (`story_state`), set by the relevant feature surface.
- **Settings sync across devices** — local-first; no sync layer in v2.0.
- **Settings versioning / undo** — covered by the same v2.1 deferral as message undo (D-09).
- **Plugin / extension settings** — no plugin system in v2.0.
- **Multi-user profiles** — single-user app.
- **Light mode** — deferred to v2.1.
- **Source Document Creator's `creator_instructions` UI** — schema column retained for forward-compat (D-13); no UI surface in v2.0.
- **Modificator catalogue / presets** — modificators are free-text per-turn tags with no persistence (Doc 15 §Modificators); the v1.0 `modificator_presets` keys are removed from `app_settings` and `settings`.
- **Image-gen / TTS provider settings** — deferred with the rest of media generation (D-15).
