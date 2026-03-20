# 21 — Media System: Audio / TTS Narration (v2)

## Scope

**Data models and provider interface only. Do not implement in v1 or v1.1.**

This document defines the architecture, data models, and Rust trait interface
for the future voiced narration system. The goal is to ensure that when
implementation begins in v2, no structural refactors are required to the
database schema, vault layout, or state management.

> **Coding-agent note (v1 requirements):** Create `src-tauri/src/tts.rs` with
> the trait and data models defined in §5. All Tauri commands from §9 must be
> registered in `lib.rs` but return `Err("TTS not yet implemented")`. The
> `voice_profiles` and `tts_scripts` tables (§3) must be created in
> `init_schema()` so no future migration is needed. The Settings UI entry
> for Audio / TTS in Settings → Connections must show as greyed-out with
> `[not yet available]`.

---

## 1. Feature Overview (Future — v2)

The Audio / TTS Narration system allows users to generate voiced audio from
any AI-generated story message:

1. **Parse** prose output into a structured script — narrator segments and
   character dialogue, each tagged with a speaker name.
2. **Assign** a `VoiceProfile` to each speaker (Storyteller + named characters).
3. **Generate** per-segment audio via a `TtsProvider` (ElevenLabs or Google
   Cloud TTS).
4. **Stitch** segments into a final MP3 file saved to
   `worlds/<world_id>/audio/`.
5. **Display** an inline audio player in the message bubble.

---

## 2. Data Models

### 2.1 `VoiceProfile`

```rust
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct VoiceProfile {
    pub id:       String,    // UUID
    pub name:     String,    // "Storyteller" | character name
    pub provider: String,    // "elevenlabs" | "google_tts"
    pub voice_id: String,    // provider-specific voice identifier
    pub settings: VoiceSettings,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct VoiceSettings {
    pub stability:        Option<f32>,  // ElevenLabs: 0.0–1.0
    pub similarity_boost: Option<f32>,  // ElevenLabs: 0.0–1.0
    pub speaking_rate:    Option<f32>,  // Google TTS: 0.25–4.0 (default 1.0)
    pub pitch:            Option<f32>,  // Google TTS: -20.0–20.0 (default 0.0)
}
```

### 2.2 `TtsScript`

```rust
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct TtsScript {
    pub message_id: String,
    pub segments:   Vec<TtsSegment>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct TtsSegment {
    pub index:      usize,
    pub speaker:    String,           // "Storyteller" or character name
    pub text:       String,           // text to be spoken
    pub audio_path: Option<String>,   // relative path once generated: "audio/<uuid>/segment_NNN.mp3"
}
```

### 2.3 TypeScript Interfaces (`src/lib/types.ts`)

```ts
export interface VoiceSettings {
  stability?:        number;
  similarity_boost?: number;
  speaking_rate?:    number;
  pitch?:            number;
}

export interface VoiceProfile {
  id:       string;
  name:     string;
  provider: string;   // "elevenlabs" | "google_tts"
  voice_id: string;
  settings: VoiceSettings;
}

export interface TtsSegment {
  index:       number;
  speaker:     string;
  text:        string;
  audio_path?: string | null;
}

export interface TtsScript {
  message_id: string;
  segments:   TtsSegment[];
}
```

---

## 3. Database Schema (`init_schema()` — Required in v1)

Both tables created in v1, even though TTS is not yet implemented:

```sql
CREATE TABLE IF NOT EXISTS voice_profiles (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    provider    TEXT NOT NULL,
    voice_id    TEXT NOT NULL,
    settings    TEXT NOT NULL DEFAULT '{}',  -- JSON: VoiceSettings
    created_at  TEXT NOT NULL,
    modified_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tts_scripts (
    id          TEXT PRIMARY KEY,
    message_id  TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    segments    TEXT NOT NULL,     -- JSON: Vec<TtsSegment>
    created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tts_scripts_message
    ON tts_scripts(message_id);
```

---

## 4. Audio File Storage Layout

```
worlds/<world_id>/
├── loom.db
├── assets/          ← uploaded + generated images (v1, v1.1)
└── audio/           ← generated narration (v2)
    ├── <message_id>/
    │   ├── segment_000.mp3
    │   ├── segment_001.mp3
    │   └── final.mp3          ← stitched full narration
    └── ...
```

The `audio/` directory is created on first TTS generation. Each message gets
its own subdirectory. `final.mp3` is the stitched output.

---

## 5. `TtsProvider` Rust Trait (`src-tauri/src/tts.rs`)

```rust
use async_trait::async_trait;

pub struct TtsRequest {
    pub text:     String,
    pub voice_id: String,
    pub settings: VoiceSettings,
}

pub struct TtsResult {
    pub audio_bytes: Vec<u8>,
    pub mime_type:   String,  // "audio/mpeg" | "audio/wav"
}

pub struct ProviderVoice {
    pub voice_id:     String,
    pub display_name: String,
    pub gender:       Option<String>,
    pub preview_url:  Option<String>,
}

#[async_trait]
pub trait TtsProvider: Send + Sync {
    fn name(&self) -> &'static str;
    fn requires_api_key(&self) -> bool;
    async fn synthesize(&self, req: TtsRequest) -> anyhow::Result<TtsResult>;
    async fn list_voices(&self) -> anyhow::Result<Vec<ProviderVoice>>;
}
```

### 5.1 Provider Stubs (v1 — compile only, no HTTP calls)

```rust
pub struct ElevenLabsProvider { pub api_key: String }
pub struct GoogleTtsProvider  { pub api_key: String }

#[async_trait]
impl TtsProvider for ElevenLabsProvider {
    fn name(&self) -> &'static str { "ElevenLabs" }
    fn requires_api_key(&self) -> bool { true }
    async fn synthesize(&self, _req: TtsRequest) -> anyhow::Result<TtsResult> {
        anyhow::bail!("TTS not yet implemented")
    }
    async fn list_voices(&self) -> anyhow::Result<Vec<ProviderVoice>> {
        anyhow::bail!("TTS not yet implemented")
    }
}
// Identical stub for GoogleTtsProvider
```

### 5.2 Provider Registry

```rust
pub fn get_tts_provider(
    provider_id: &str,
    api_key: String,
) -> Box<dyn TtsProvider> {
    match provider_id {
        "elevenlabs" => Box::new(ElevenLabsProvider { api_key }),
        "google_tts" => Box::new(GoogleTtsProvider  { api_key }),
        _            => Box::new(ElevenLabsProvider { api_key }),
    }
}
```

---

## 6. Script Parsing (Gemini — v2 Implementation)

### 6.1 Prompt

```
System: You are a script adaptor for audiobook narration. Convert the given prose
into a narration script. Split it into segments by speaker. The narrator is always
called "Storyteller". Character names are extracted from dialogue attribution
(e.g. "said Ava" → speaker = "Ava"). Adapt text minimally for spoken delivery
(expand abbreviations, remove Markdown). Output only JSON, no preamble.

User: <prose>{message_content}</prose>

JSON schema:
[
  { "index": 0, "speaker": "Storyteller", "text": "..." },
  { "index": 1, "speaker": "Ava",         "text": "..." }
]
```

### 6.2 Speaker Detection

- Text between dialogue markers attributed to a character → `speaker = character name`
- Everything else → `speaker = "Storyteller"`
- Character names are normalized (trimmed, title-cased)
- New characters are added to the world character roster:
  `settings` key `tts_characters`, value JSON array

---

## 7. Full Generation Pipeline (v2 — Reference)

```
generate_tts_for_message(message_id)
  │
  ├─ 1. Call parse_tts_script(message_content) → TtsScript  [Gemini JSON call]
  │
  ├─ 2. Save TtsScript to tts_scripts table
  │
  ├─ 3. For each segment:
  │       a. Look up VoiceProfile for segment.speaker
  │          (fallback to "Storyteller" profile if unassigned)
  │       b. provider.synthesize(TtsRequest) → TtsResult
  │       c. Save to audio/<message_id>/segment_NNN.mp3
  │       d. Update segment.audio_path in tts_scripts table
  │
  ├─ 4. Stitch segments:
  │       rodio or ffmpeg subprocess → audio/<message_id>/final.mp3
  │
  └─ 5. Return audio path → AudioPlayer renders in message bubble
```

---

## 8. Future Settings

Additional settings keys (added to `settings` table when TTS is implemented):

| Key | Default | Description |
|---|---|---|
| `tts_provider` | `"elevenlabs"` | Active TTS provider |
| `tts_api_key_elevenlabs` | `""` | ElevenLabs API key |
| `tts_api_key_google` | `""` | Google Cloud TTS API key |
| `tts_default_storyteller_voice` | `""` | Default narrator voice ID |
| `tts_characters` | `"[]"` | Character roster JSON array |

---

## 9. Tauri Command Stubs (Required in v1 — Return Stub Errors)

| Command | Parameters | Returns |
|---|---|---|
| `generate_tts_for_message` | `message_id: String` | `String` (audio path) |
| `get_tts_script` | `message_id: String` | `TtsScript` |
| `save_voice_profile` | `profile: VoiceProfile` | `()` |
| `list_voice_profiles` | — | `Vec<VoiceProfile>` |
| `delete_voice_profile` | `id: String` | `()` |
| `list_tts_voices` | `provider_id: String` | `Vec<ProviderVoice>` |

All return `Err("TTS not yet implemented")` in v1 and v1.1.

---

## 10. Frontend Architecture (v2 — Reference Only)

### 10.1 `AudioPlayer` Component

Inline in AI message bubbles when a `tts_script` exists for the message:

```
┌──────────────────────────────────────────────────────────┐
│  AI  ·  3:12 PM  ·  488 tok         [🔊 Play Narration]  │
│                                                           │
│  ┌──────────────────────────────────────────────────┐    │
│  │  ▶  ━━━━━━━━━━━●━━━━━━━━━  1:24 / 3:06          │    │
│  │  Storyteller · Ava · Commander Rahl               │    │
│  └──────────────────────────────────────────────────┘    │
│                                                           │
│  Her hands trembled as she broke the seal…               │
└──────────────────────────────────────────────────────────┘
```

- Speaker chips show all characters in the narration
- Scrubber position highlights the currently active segment speaker
- Uses HTML5 `<audio>` element with `asset://` URL pointing to `final.mp3`

### 10.2 Voice Profile Manager

Modal opened from Settings:
- List of all `VoiceProfile` rows for the world
- Per-profile: speaker name, provider dropdown, voice picker (from `list_tts_voices()`), settings sliders
- "Assign voice to character" flow for newly detected character names
- Unassigned characters use the Storyteller profile as fallback

---

## 11. World Export (v2 Update)

When TTS is implemented, `vault_export_world` must bundle `audio/`:

```
loom-backup.zip
├── loom.db       ← SQLCipher encrypted
├── assets/       ← images (not encrypted)
└── audio/        ← generated narration (not encrypted)
```

Audio files are unencrypted in the backup archive — same security note as
images (see `19-Media-System-Image-Uploads.md §7`).