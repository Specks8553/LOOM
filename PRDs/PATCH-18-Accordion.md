# PATCH — 18-Accordion.md
# Issue addressed: #7 (Accordion summarisation with image-containing messages)
# Apply: insert this as a new sub-section inside the existing Summarisation Flow
#        section (after the Gemini call description, before the toast/UI notes).
---

## NEW SECTION — Summarisation with Image-Containing Messages

When `summarise_segment` extracts the segment's messages to send to Gemini,
some user messages may contain `image_blocks` in their `UserContent` JSON.
The summarisation call **includes these images** so the AI can produce an
accurate summary of visual context as well as narrative text.

### History Assembly for Summarisation

Use `build_user_turn()` (Doc 09 §4.2) for each user message in the segment.
This automatically includes image parts:

```rust
// Inside summarise_segment — building segment history for the Gemini call:
for msg in &segment_messages {
    match msg.role.as_str() {
        "user" => {
            let content: UserContent = serde_json::from_str(&msg.content)?;
            // build_user_turn includes image parts via inline base64 or File API
            let parts = build_user_turn(&content, conn, world_dir).await;
            history.push(Content { role: "user".into(), parts });
        }
        "model" => {
            // Extract text for summarisation.
            // For "blocks" messages (Doc 20 generated images): use text blocks only.
            // Generated images are not re-sent during summarisation —
            // the narrative text provides sufficient context.
            let text = extract_text_for_summarisation(&msg);
            history.push(Content { role: "model".into(), parts: vec![Part::text(text)] });
        }
        _ => {}
    }
}
```

### `extract_text_for_summarisation` Helper

```rust
fn extract_text_for_summarisation(msg: &ChatMessage) -> String {
    match msg.content_type.as_str() {
        "blocks" => {
            // Model message with generated images (Doc 20): extract text blocks only
            let blocks: Vec<MessageBlock> = serde_json::from_str(&msg.content)
                .unwrap_or_default();
            blocks.iter()
                .filter_map(|b| if let MessageBlock::Text { text } = b { Some(text.as_str()) } else { None })
                .collect::<Vec<_>>()
                .join("\n")
        }
        _ => msg.content.clone(), // "text" — plain markdown
    }
}
```

### Error Handling During Summarisation

| Failure | Behaviour |
|---------|-----------|
| Asset file missing from disk | Skip image part for that message; log `warn!`; continue summarisation with text only |
| File API upload failure (`LoomError::Api`) | Skip image part; log `warn!`; continue. Toast after summarisation: *"Summary generated. Note: one image could not be included (File API error)."* |
| All image parts fail but text succeeds | Summary is generated from text only — this is acceptable and not treated as an error |

### Stale Summary Detection — Image Changes

The existing stale-summary detection (edit or regeneration inside a collapsed segment)
already covers image changes: editing a user message via the edit flow creates a new
branch (Doc 09 §8), which marks the segment summary as stale. No additional stale
detection logic is required for image-specific changes.
