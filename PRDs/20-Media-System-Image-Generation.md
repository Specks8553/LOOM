# 20 — Media System: AI Image Generation (v1.1)

## Scope

**Architecture defined in v1. Implement in v1.1.**

This document specifies the AI image generation system in LOOM: a per-send
toggle that generates an image alongside the text response, and a
selected-text-to-image flow. The backend uses a pluggable
`ImageGenerationProvider` Rust trait so any model or API can be swapped
without changing calling code.

The default free provider is **Gemini 2.0 Flash** multimodal output. Paid
providers (Imagen 3, Stability AI, Together AI) are supported via user-supplied
API keys configured in Settings → Connections.

> **Coding-agent note (v1 requirements):** Create `src-tauri/src/image_gen.rs`
> in v1 with the trait and provider stubs defined in §3. All Tauri commands
> from §6 must be registered in `lib.rs` but return
> `Err("Image generation not yet implemented")`. Settings keys from §5.1 must
> be seeded in `init_schema()`. The Settings UI section (§5.2) must be built
> in v1 but all controls disabled/greyed-out with a "coming soon" notice.
> Per-story `img_gen_enabled` state lives in `story_settings` table (already
> present in v1 schema). This ensures v1.1 requires only filling provider
> logic — no structural refactors.

---

## 1. Feature Overview

### 1.1 Image Generation Toggle (Send Flow)

A toggle button in the Theater input area, to the left of the Send button:

```
[🖼 + Image]  [▼ Background]  [▼ Modificators]

[🎨 Image ◯]                             [■ Stop] [↑ Send]
```

*(Toggle appears in the action row, to the left of Send.)*

When toggled **ON**:
1. Text generation proceeds as normal — Gemini produces story text.
2. A second Gemini call extracts a structured scene description from the text.
3. The scene description is sent to the configured `ImageGenerationProvider`.
4. The returned image is saved to `assets/` and appended as an `image` block
   at the end of the AI message content.

**Toggle state:** per-story, persisted in `story_settings` table,
key `img_gen_enabled`, value `"true"` / `"false"`. Default: `"false"`.

### 1.2 Selected Text → Image (Contextual Flow)

When the user has a text selection in any AI bubble, the action row gains a
**Generate Image from Selection** button (`lucide-react Sparkles`).

Flow:
1. Capture selected text (same selection mechanism as Ghostwriter)
2. Send selected text + full message content to Gemini for scene description
3. Scene description → `ImageGenerationProvider` → image saved → inserted
   as a new `image` block immediately after the selected passage in the
   message's `MessageBlock[]` content

---

## 2. Scene Description Extraction (Gemini)

Before calling any image generation provider, a Gemini call extracts a
structured scene description from the generated text.

### 2.1 Extraction Prompt

```
System: You are a visual director. Given a passage of prose, extract the single
most visually compelling scene or moment. Output only JSON, no preamble.

User: <passage>{text}</passage>

JSON schema:
{
  "scene_description": "string",  // 1–3 vivid sentences for an image generator
  "dominant_mood":     "string",  // e.g. "melancholic", "tense", "ethereal"
  "style_hint":        "string | null"  // e.g. "oil painting", "photorealistic"
}
```

### 2.2 Final Image Prompt Construction

```rust
fn build_image_prompt(scene: &SceneDescription) -> String {
    let mut prompt = scene.scene_description.clone();
    prompt.push_str(&format!(". Mood: {}", scene.dominant_mood));
    if let Some(hint) = &scene.style_hint {
        prompt.push_str(&format!(". Style: {}", hint));
    }
    prompt
}
```

---

## 3. `ImageGenerationProvider` Rust Trait (`src-tauri/src/image_gen.rs`)

```rust
use async_trait::async_trait;

pub struct ImageGenRequest {
    pub prompt:     String,
    pub width:      u32,           // default: 1024
    pub height:     u32,           // default: 1024
    pub style_hint: Option<String>,
}

pub struct ImageGenResult {
    pub image_bytes: Vec<u8>,
    pub mime_type:   String,   // "image/png" | "image/jpeg" | "image/webp"
}

#[async_trait]
pub trait ImageGenerationProvider: Send + Sync {
    fn name(&self) -> &'static str;
    fn requires_api_key(&self) -> bool;
    async fn generate(&self, req: ImageGenRequest) -> anyhow::Result<ImageGenResult>;
}
```

### 3.1 Provider Registry

```rust
pub fn get_provider(
    provider_id: &str,
    api_key: Option<String>,
) -> Box<dyn ImageGenerationProvider> {
    match provider_id {
        "gemini_flash" => Box::new(GeminiFlashImageProvider::new()),
        "imagen3"      => Box::new(Imagen3Provider::new(api_key.unwrap_or_default())),
        "stability"    => Box::new(StabilityProvider::new(api_key.unwrap_or_default())),
        "together"     => Box::new(TogetherProvider::new(api_key.unwrap_or_default())),
        _              => Box::new(GeminiFlashImageProvider::new()),
    }
}
```

### 3.2 Provider Implementations

#### `GeminiFlashImageProvider` (Default — Free Tier)

```rust
pub struct GeminiFlashImageProvider;

// API: POST https://generativelanguage.googleapis.com/v1beta/models/
//          gemini-2.0-flash-exp:generateContent
// Request: include "generationConfig": { "responseModalities": ["TEXT", "IMAGE"] }
// Response: parts array where type="image" contains
//           inline_data { mime_type, data (base64) }
```

> **Stability note:** Gemini 2.0 Flash multimodal image output is experimental.
> The provider interface ensures switching providers requires only a settings
> change — no code changes.

#### `Imagen3Provider` (Paid — Google AI Studio)

```rust
pub struct Imagen3Provider { api_key: String }
// API: POST https://generativelanguage.googleapis.com/v1beta/models/
//          imagen-3.0-generate-002:predict
// Returns: base64-encoded PNG
```

#### `StabilityProvider` (Paid — Stability AI)

```rust
pub struct StabilityProvider { api_key: String }
// API: POST https://api.stability.ai/v2beta/stable-image/generate/ultra
// Returns: binary image (PNG or JPEG)
```

#### `TogetherProvider` (Paid — Together AI)

```rust
pub struct TogetherProvider { api_key: String }
// API: POST https://api.together.xyz/v1/images/generations
// Models: FLUX.1-schnell, FLUX.1-dev, etc.
// Returns: base64-encoded PNG
```

### 3.3 v1 Stubs

In v1, all four providers return `anyhow::bail!("Image generation not yet implemented")`.
The trait and structs must compile and be registered.

---

## 4. End-to-End Generation Flow (Backend, v1.1)

```
send_message_with_image_gen()
  │
  ├─ 1. Call Gemini → text response (standard send_message flow)
  │
  ├─ 2. Call extract_scene_description(text) → SceneDescription JSON
  │
  ├─ 3. build_image_prompt(scene) → prompt string
  │
  ├─ 4. get_provider(provider_id, api_key).generate(ImageGenRequest)
  │        → ImageGenResult { image_bytes, mime_type }
  │
  ├─ 5. Save image to assets/:
  │        path = worlds/<world_id>/assets/<new_uuid>.<ext>
  │        std::fs::write(path, image_bytes)
  │
  ├─ 6. Insert into items table (ItemType::Image, asset_path + asset_meta set)
  │
  ├─ 7. Append ImageBlock to message content:
  │        content_type = "blocks"
  │        content = [...existing_text_blocks,
  │                  { type: "image", item_id, asset_path }]
  │
  └─ 8. Update message in DB, return updated ChatMessage to frontend
```

If image generation fails (§7), the text response is saved normally.

---

## 5. Settings

### 5.1 Settings Keys (World `settings` table)

| Key | Default | Description |
|---|---|---|
| `img_gen_provider` | `"gemini_flash"` | Active provider ID |
| `img_gen_api_key_imagen3` | `""` | Imagen 3 API key |
| `img_gen_api_key_stability` | `""` | Stability AI API key |
| `img_gen_api_key_together` | `""` | Together AI API key |
| `img_gen_width` | `"1024"` | Output width (px) |
| `img_gen_height` | `"1024"` | Output height (px) |

### 5.2 Settings UI (Settings → Connections → IMAGE GENERATION section)

In v1: section visible but fully greyed out with `[not yet available]` badge.
In v1.1: fully active.

```
IMAGE GENERATION
────────────────────────────────────────────────────────
Provider     [ Gemini 2.0 Flash (Free)  ▾ ]

             ⚠  Gemini 2.0 Flash image output is experimental
                and may change without notice.

Imagen 3     [ API Key ••••••••••••••••  👁 ]
Stability AI [ API Key ••••••••••••••••  👁 ]
Together AI  [ API Key ••••••••••••••••  👁 ]

Output size  [ 1024 ] × [ 1024 ] px
────────────────────────────────────────────────────────
```

- Selecting a paid provider without a key: inline warning
  *"An API key is required for this provider."*
- API key fields: `type="password"` with reveal toggle

---

## 6. Tauri Commands

| Command | Parameters | Returns |
|---|---|---|
| `send_message_with_image_gen` | `story_id, history, user_content, file_uris, provider_id` | `ChatMessage` |
| `generate_image_from_selection` | `story_id, message_id, selected_text, full_content, provider_id` | `ChatMessage` |
| `save_img_gen_settings` | `provider_id: String, width: u32, height: u32` | `()` |
| `save_img_gen_api_key` | `provider_id: String, api_key: String` | `()` |

`send_message_with_image_gen` replaces `send_message` when the image gen toggle
is ON. Both commands coexist — `send_message` is unchanged.

---

## 7. Frontend — Generation State

```ts
// workspaceStore additions (v1.1)
isGeneratingImage: boolean;    // true while image generation step is in-progress
imageGenError: string | null;  // non-null if image gen failed (text still saved)
```

**Image gen failure handling:**
- Text response is saved normally regardless of image gen outcome
- Toast: *"Text saved. Image generation failed: {reason}."*
- No retry — user may re-trigger via "Generate Image from Selection"

### 7.1 Toggle Button

```tsx
<button
  onClick={toggleImgGen}
  disabled={!imgGenAvailable}  // disabled in v1
  className={cn(
    "flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors",
    imgGenEnabled
      ? "bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)]"
      : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
  )}
>
  <Sparkles size={14} />
  {imgGenEnabled ? "Image On" : "Image"}
</button>
```

---

## 8. Rate Limiting

Image generation requests count against the **RPM** limiter (one additional
request per send when image gen is ON, plus the scene-description Gemini call).
The TPM counter is **not** incremented for image generation calls — they are
not token-based in the Gemini multimodal sense.

Paid providers (Stability, Together) have their own rate limits managed by
their respective APIs. LOOM does not track these.