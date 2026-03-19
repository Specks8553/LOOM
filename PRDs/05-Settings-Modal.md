# 05 — Settings Modal

## Purpose

This document specifies the Settings modal in LOOM: its tab structure, all
configurable fields, persistence behaviour, and Tauri command surface.

Settings are divided into two scopes, clearly labelled in the modal:
- **App Settings** — global, apply regardless of active world
- **World Settings** — per-world, scoped to the currently active world

> **Coding-agent note:** The Settings modal is `src/components/modals/SettingsModal.tsx`.
> Opened via gear icon in the Navigator bottom bar (`Ctrl+,`). Uses shadcn/ui `<Dialog />`.
> All field changes save immediately on blur/change via `save_settings(key, value)` (world
> settings) or dedicated commands (app settings). All values are loaded on modal open via
> `get_settings_all()`. The modal uses a left-side vertical tab nav.

---

## 1. Modal Structure

```
┌─────────────────────────────────────────────────────────────┐
│  Settings                                              [✕]  │
├──────────────┬──────────────────────────────────────────────┤
│              │                                              │
│  ── APP ──   │                                              │
│  General     │  [Tab content]                               │
│  Connections │                                              │
│  Security    │                                              │
│  Export      │                                              │
│              │                                              │
│  ── WORLD ── │                                              │
│  Appearance  │                                              │
│  Writing     │                                              │
│  Templates   │                                              │
│              │                                              │
│  ── DEV ──   │                                              │
│  Developer   │                                              │
│  Advanced    │                                              │
│              │                                              │
└──────────────┴──────────────────────────────────────────────┘
```

- Left column: `180px` fixed, vertical tab list with section headers
- Right column: `flex-1`, scrollable
- Modal width: `720px`, max-height: `80vh`
- Section headers (`── APP ──`, `── WORLD ──`, `── DEV ──`):
  `10px`, Inter 500, uppercase, letter-spacing `0.06em`, `--color-text-muted`,
  not clickable, `margin: 12px 0 4px 12px`
- Active tab: `--color-bg-active`, `--color-text-primary`
- Inactive tab: transparent, `--color-text-secondary`, hover: `--color-bg-hover`
- Tab labels: `13px`, Inter 400

### 1.1 Auto-Save Behaviour

Every field saves immediately on change or blur. No Save button exists.
Successful save: subtle `lucide-react Check` flash (300ms, `--color-success`) next to label.
Error: inline `--color-error` text below field.

---

## 2. Tab: General (App Settings)

### 2.1 Auto-Lock

```
Auto-Lock
────────────────────────────────────────────────────────
Lock LOOM after a period of inactivity.

  Lock after   [ 15 minutes  ▾ ]

  Options: Off · 5 minutes · 15 minutes · 30 minutes · 1 hour
  Default: 15 minutes

  When locked, LOOM will show a 60-second warning toast before locking.
```

- Setting key: `app__auto_lock_minutes` (stored as `"0"` for Off, else number string)
- Stored in `localStorage` (app-level, not in world DB) under key `loom_auto_lock_minutes`
- Value `"0"` = disabled
- Inactivity detected via `mousemove`, `mousedown`, `keydown`, `wheel` events on `window`
- 60-second warning toast shown with `[Stay Unlocked]` dismiss button

### 2.2 World Name

```
World Name
────────────────────────────────────────────────────────
[ Mirrorlands                                          ]
```

Note: This edits the **currently active world** — it is a World Setting exposed
here for convenience, not a true App Setting. Clearly labelled:
*"Name of the currently active world: Mirrorlands"*

Saves on blur → calls `rename_world(new_name)` (updates `world_meta.json`).

---

## 3. Tab: Appearance (World Settings)

All fields save immediately on change and apply live (visible preview).

### 3.1 Accent Color

```
Accent Color
────────────────────────────────────────────────────────
The primary color used throughout LOOM for this world.

  [ #7c3aed                    ]   ██  ← live color swatch

  ⚠  Invalid color code.
```

- `<input type="text">`, validates on change: must match `/^#[0-9a-fA-F]{6}$/`
- On valid input: calls `applyAccentColor(hex)` immediately, then `save_settings("accent_color", hex)`
- Also calls `sync_accent_to_world_meta(hex)` to update `world_meta.json` cache
- Setting key: `accent_color`

### 3.2 Theater Body Font

```
Theater Body Font
────────────────────────────────────────────────────────
[ Lora (Serif)  ▾ ]
```

- Options: Lora (Serif) · Inter (Sans-serif) · JetBrains Mono (Monospace)
- Setting key: `body_font`

### 3.3 Message Bubble Colors

```
Message Bubble Colors
────────────────────────────────────────────────────────
Your messages     [ #1e1033       ]   ██
                  Leave empty to track accent color.

AI messages       [ #1a1a1a       ]   ██
```

- Setting keys: `bubble_user_color` (empty = null = tracks accent), `bubble_ai_color`

### 3.4 Feature Colors

```
Feature Colors
────────────────────────────────────────────────────────
All colors default to the accent color when left empty.

Ghostwriter frame   [ _________ ]   ██  (bubble outline during Ghostwriter mode)
Ghostwriter diff    [ _________ ]   ██  (diff highlight color)
Checkpoint marker   [ _________ ]   ██  (checkpoint divider in Theater + Branch Map)
Accordion segment   [ _________ ]   ██  (accordion card in Theater + Branch Map)
```

- All `<input type="text">` with hex validation
- Empty string = `null` = tracks current accent color
- Setting keys: `ghostwriter_frame_color`, `ghostwriter_diff_color`,
  `checkpoint_color`, `accordion_color`
- On change: calls `applyFeatureColors(...)` immediately then saves

---

## 4. Tab: Writing (World Settings)

### 4.1 System Instructions

```
System Instructions
────────────────────────────────────────────────────────
┌────────────────────────────────────────────────────┐
│ You are a master storyteller collaborating with    │
│ a writer...                                        │
└────────────────────────────────────────────────────┘
  Applied to every AI request in this world.
  Also editable in the Control Pane.
```

- `<textarea>`, min-height `120px`, auto-grow
- Setting key: `system_instructions`
- Synced with Control Pane textarea (same store value)
- Saves on blur

### 4.2 Modificator Presets

```
Modificator Presets
────────────────────────────────────────────────────────
Save frequently-used tone combinations for quick access.
Maximum 5 presets.

  [dark horror · slow burn  ×]
  [introspective · melancholic  ×]
  [+ Add current modificators as preset]

  To add a preset: enter tags in the Modificators field,
  then click the save icon, or use the button above.
```

- Up to 5 presets stored as JSON array
- Setting key: `modificator_presets`
- Default: `"[]"`
- Each preset: `{ name: string, tags: string[] }` — name is auto-generated from tags
- Delete: `[×]` on each preset chip
- Add: via save icon in the input area OR from this Settings tab

---

## 5. Tab: Connections (App Settings)

### 5.1 Layout

```
Connections
────────────────────────────────────────────────────────

  TEXT GENERATION
  ┌──────────────────────────────────────────────────┐
  │  Model      [ gemini-2.5-flash-preview  ▾      ] │
  │  API Key    [- - - - - - - - - - - - ]  [Change] │
  └──────────────────────────────────────────────────┘

  IMAGE GENERATION                    [not yet available]
  ┌──────────────────────────────────────────────────┐
  │  Model      [ _________________________        ] │ ← disabled
  │  API Key    [ _________________________        ] │ ← disabled
  └──────────────────────────────────────────────────┘

  AUDIO / TTS                         [not yet available]
  ┌──────────────────────────────────────────────────┐
  │  Model      [ _________________________        ] │ ← disabled
  │  API Key    [ _________________________        ] │ ← disabled
  └──────────────────────────────────────────────────┘
```

### 5.2 Text Generation — Model Selector

```
Model
[ gemini-2.5-flash-preview  ▾ ]
```

- Dropdown populated from `text_model_options` setting (JSON array of model name strings)
- Default options (seeded on world creation):
  - `gemini-2.5-flash-preview`
  - `gemini-2.0-flash`
  - `gemini-1.5-pro`
- Additional models can be added via **Developer → Custom Models** (see §8.2)
- On change: saves `save_settings("text_model_name", value)` immediately
- Setting key: `text_model_name`
- The selected model name is sent in every `send_message` request and displayed
  in the token badge on AI message bubbles

### 5.3 Text Generation — API Key

```
API Key    [- - - - - - - - - - - - - - - - - - ]  [Change]
```

- Current key is **never** sent to frontend — only presence shown (masked dashes)
- `[Change]` → inline input field appears with `[Test]` and `[Save]` buttons
- Save calls `validate_and_store_api_key(key)` — validates then stores in DB
- Setting stored in `settings` table as `gemini_api_key` (not in localStorage)

### 5.4 Image Generation / TTS (Greyed Out)

Both disabled in v1. Fields visible but `opacity: 0.4`, `cursor: not-allowed`.
Setting keys reserved: `img_gen_model_name`, `img_gen_api_key`, `tts_model_name`, `tts_api_key`.

---

## 6. Tab: Security (App Settings)

### 6.1 Change Master Password

```
Change Master Password
────────────────────────────────────────────────────────
Current password    [ ••••••••••  👁 ]
New password        [ ••••••••••  👁 ]
Confirm new         [ ••••••••••  👁 ]

[ Change Password ]
```

**Flow:**
1. Validate: new ≥ 8 chars, new = confirm
2. Confirmation dialog: *"This will re-encrypt all world databases. Do not close the app during this process."*
3. Call `change_master_password(current, new)`:
   - Verify current password via key sentinel (see `11-App-Lifecycle-and-State-Management.md §5.3`)
   - Generate NEW random 32-byte salt
   - Derive new key (PBKDF2-HMAC-SHA256, same iterations)
   - **Set `password_change_in_progress` flag** in `app_config.json` with:
     `{ "completed_world_ids": [], "new_salt_hex": "…", "new_sentinel": {…} }`
   - `PRAGMA rekey` on each world DB, appending world ID to `completed_world_ids` after each
   - On all worlds complete: remove `password_change_in_progress` flag
   - Generate new key sentinel for `app_config.json`
   - Update `app_config.json` (new salt + iterations + sentinel)
   - Zero old key from memory
4. **On partial failure** (crash mid-process): on next unlock, if `password_change_in_progress`
   exists in `app_config.json`, LOOM detects the interrupted state:
   - Worlds listed in `completed_world_ids` use the new key
   - Remaining worlds still use the old key
   - LOOM prompts: *"A password change was interrupted. Enter your NEW password to resume."*
   - On successful re-derivation: resumes re-keying for remaining worlds
5. On success: prompt to re-save recovery file

---

## 7. Tab: Export (App Settings)

```
Export
────────────────────────────────────────────────────────

Export folder
[ /Users/user/Documents/LOOM Exports    ] [Browse]

  Exported Markdown files are saved here automatically.
  Click the success toast after export to open the folder.
```

- `[Browse]` → `tauri-plugin-dialog: open({ directory: true })`
- Stored in `localStorage` key `loom_export_folder_path` (app-level — shared across all worlds)

---

## 8. Tab: Developer

### 8.1 Rate Limit Configuration

```
Rate Limit Configuration
────────────────────────────────────────────────────────
These values should match your Gemini API tier.

  Requests per minute (RPM)    [ 10      ]
  Tokens per minute (TPM)      [ 250000  ]
  Requests per day (RPD)       [ 1500    ]

  [ Reset Rate Limit Counters ]

  ℹ  Soft limits — set to match your plan to avoid 429 errors.
```

Setting keys: `rate_limit_rpm`, `rate_limit_tpm`, `rate_limit_rpd`
Defaults: `10`, `250000`, `1500`

### 8.2 Context Token Limit

```
Context Token Limit
────────────────────────────────────────────────────────
Maximum tokens shown in the Theater token counter.
Set to match your model's context window.

  [ 128000 ]  tokens

  ℹ  This affects the counter display only, not actual API limits.
```

- Setting key: `context_token_limit`
- Default: `128000`
- Used by the Theater token counter (F-01) to calculate fill percentage and warnings

### 8.3 Custom Models

```
Custom Models
────────────────────────────────────────────────────────
Add model names to the Text Generation dropdown.
Enter the exact API identifier as shown in Google AI Studio.

  [ gemini-2.0-flash-thinking-exp  ] [+ Add]

  Custom entries:
  gemini-2.0-flash-thinking-exp  [×]

  ℹ  Invalid model names will result in API errors at generation time.
```

- Each custom model name is added to the `text_model_options` JSON array
- Setting key: `text_model_options` (JSON array, default: `["gemini-2.5-flash-preview","gemini-2.0-flash","gemini-1.5-pro"]`)
- Custom models appear in the Connections → Model dropdown below built-in options
- Max 10 total models in dropdown

### 8.4 AI Prompt Templates (Editable)

All system instructions and prompts used for AI requests are exposed here
for advanced users to customize. Each field auto-saves on blur.

```
AI Prompt Templates
────────────────────────────────────────────────────────
These prompts are sent to the AI during various operations.
Edit with care — changes affect AI behaviour directly.

Ghostwriter System Instruction
┌──────────────────────────────────────────────────────┐
│ You are assisting a writer with targeted revisions…  │
└──────────────────────────────────────────────────────┘

Accordion Summarisation Instruction
┌──────────────────────────────────────────────────────┐
│ Summarise the following story chapter…               │
└──────────────────────────────────────────────────────┘

Accordion Fake-Pair User Prompt
┌──────────────────────────────────────────────────────┐
│ Summarize this chapter: actions, character states,   │
│ and world state at the end of the chapter.           │
└──────────────────────────────────────────────────────┘

  [ Reset All to Defaults ]
```

Setting keys (World-level, `settings` table):

| Key | Default |
|---|---|
| `prompt_ghostwriter` | *(see Doc 16 §3.1 for full default text)* |
| `prompt_accordion_summarise` | *(see Doc 18 §4.3 for full default text)* |
| `prompt_accordion_fake_user` | `"Summarize this chapter: actions, character states, and world state at the end of the chapter."` |

`[Reset All to Defaults]`: resets all three keys to their default values.

Each prompt is a `<textarea>`, `min-height: 100px`, auto-grow, `--font-mono`, `12px`.

### 8.5 Full Branch JSON Export

```
Export
────────────────────────────────────────────────────────
[ ↓ Export Full Branch JSON ]

  Available when a story is open.
  Exports the complete active branch as structured JSON.
```

Calls `export_full_branch_json(story_id, leaf_id)`. Saves via `dialog.save()`.
See `04-Reader-View-and-Export.md` for schema.

---

## 9. Tab: Templates (World Settings)

Full specification in `08-Vault-and-World-Management.md §5.5`.

```
Templates
────────────────────────────────────────────────────────
  👤  Character Profile        [Edit] [Delete]
  🌍  World Building           [Edit] [Delete]

  [ + New Template ]
```

---

## 10. Tab: Advanced (App Settings)

Contains destructive actions. Requires confirmation dialogs.

See §6 (Change Master Password) above. Additional future actions go here.

---

## 11. Default Settings Values

Inserted by `init_schema()` on first world creation:

| Key | Default | Scope |
|---|---|---|
| `system_instructions` | `""` | World |
| `system_instructions_2` | `""` | World |
| `si_slot_1_name` | `"SI 1"` | World |
| `si_slot_2_name` | `"SI 2"` | World |
| `active_si_slot` | `"1"` | World |
| `text_model_name` | `"gemini-2.5-flash-preview"` | World |
| `text_model_options` | `'["gemini-2.5-flash-preview","gemini-2.0-flash","gemini-1.5-pro"]'` | World |
| `accent_color` | `"#7c3aed"` | World |
| `body_font` | `"serif"` | World |
| `bubble_user_color` | `""` (= track accent) | World |
| `bubble_ai_color` | `"#1a1a1a"` | World |
| `ghostwriter_frame_color` | `""` (= track accent) | World |
| `ghostwriter_diff_color` | `""` (= track accent) | World |
| `checkpoint_color` | `""` (= track accent) | World |
| `accordion_color` | `""` (= track accent) | World |
| `export_folder_path` | `""` | ~~World~~ *removed — now app-level* |
| `rate_limit_rpm` | `"10"` | World |
| `rate_limit_tpm` | `"250000"` | World |
| `rate_limit_rpd` | `"1500"` | World |
| `context_token_limit` | `"128000"` | World |
| `modificator_presets` | `"[]"` | World |
| `last_open_story_id` | `""` | World |
| `img_gen_model_name` | `""` | World |
| `tts_model_name` | `""` | World |
| `prompt_ghostwriter` | *(see Doc 16 §3.1)* | World |
| `prompt_accordion_summarise` | *(see Doc 18 §4.3)* | World |
| `prompt_accordion_fake_user` | `"Summarize this chapter: actions, character states, and world state at the end of the chapter."` | World |

App-level settings in `localStorage`:
| Key | Default |
|---|---|
| `loom_auto_lock_minutes` | `"15"` |
| `loom_export_folder_path` | `""` |

---

## 12. Tauri Command Reference

| Command | Parameters | Returns |
|---|---|---|
| `get_settings_all` | — | `HashMap<String, String>` |
| `save_settings` | `key: String, value: String` | `()` |
| `validate_and_store_api_key` | `key: String` | `()` |
| `rename_world` | `new_name: String` | `()` |
| `change_master_password` | `current: String, new: String` | `PasswordChangeResult` |
| `reset_rate_limiter` | — | `()` |
| `sync_accent_to_world_meta` | `hex: String` | `()` |
| `list_templates` | — | `Vec<Template>` |
| `save_template` | `template: Template` | `Template` |
| `delete_template` | `id: String` | `()` |
| `export_full_branch_json` | `story_id: String, leaf_id: String` | `String` |
