//! Gemini API client — streaming generation and request assembly.
//!
//! Doc 09 §4–§5: The frontend sends (story_id, leaf_id, user_content).
//! This module builds the Gemini request and streams the response.

use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tokio::sync::watch;

use crate::error::LoomError;

// ─── Data Types ──────────────────────────────────────────────────────────────

/// Three-field user input per Doc 09 §4.1.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserContent {
    pub plot_direction: String,
    #[serde(default)]
    pub background_information: String,
    #[serde(default)]
    pub modificators: Vec<String>,
    #[serde(default)]
    pub constraints: String,
    #[serde(default)]
    pub output_length: Option<u32>,
    /// Names of context docs attached at send time (display only, not sent to API).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub context_doc_names: Vec<String>,
    /// Image blocks attached inline to this user message — Doc 19 PATCH.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub image_blocks: Vec<ImageBlock>,
}

/// An inline image reference in a user message — Doc 19 PATCH.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageBlock {
    pub item_id: String,
    pub asset_path: String,
}

/// Message stored in DB and sent to frontend — Doc 09 §1.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: String,
    pub story_id: String,
    pub parent_id: Option<String>,
    pub role: String,
    pub content_type: String,
    pub content: String,
    pub token_count: Option<i64>,
    pub model_name: Option<String>,
    pub finish_reason: Option<String>,
    pub created_at: String,
    pub deleted_at: Option<String>,
    pub user_feedback: Option<String>,
    pub ghostwriter_history: String,
}

/// Emitted per streaming token via Tauri event.
#[derive(Debug, Clone, Serialize)]
pub struct StreamChunk {
    pub message_id: String,
    pub delta: String,
}

/// Emitted when streaming completes.
#[derive(Debug, Clone, Serialize)]
pub struct StreamDone {
    pub message_id: String,
    pub user_msg_id: String,
    pub model_msg: ChatMessage,
}

/// Return type for load_story_messages.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoryPayload {
    pub messages: Vec<ChatMessage>,
    pub sibling_counts: Vec<SiblingCount>,
}

/// Fork point with count of siblings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SiblingCount {
    pub parent_id: String,
    pub count: i64,
}

// ─── Request Assembly ────────────────────────────────────────────────────────

/// Build the user turn text sent to Gemini from UserContent — Doc 09 §4.2.
pub fn build_user_turn_text(content: &UserContent) -> String {
    let mut parts = vec![];
    parts.push(format!(
        "[PLOT DIRECTION]\n{}",
        content.plot_direction.trim()
    ));
    if !content.background_information.trim().is_empty() {
        parts.push(format!(
            "[BACKGROUND INFORMATION — NOT FOR THE READER]\n{}",
            content.background_information.trim()
        ));
    }
    if !content.modificators.is_empty() {
        let joined: Vec<&str> = content
            .modificators
            .iter()
            .filter(|m| !m.trim().is_empty())
            .map(|m| m.as_str())
            .collect();
        if !joined.is_empty() {
            parts.push(format!("[MODIFICATORS]\n{}", joined.join(" · ")));
        }
    }
    if !content.constraints.trim().is_empty() {
        parts.push(format!(
            "[CONSTRAINTS — DO NOT INCLUDE IN OUTPUT]\n{}",
            content.constraints.trim()
        ));
    }
    parts.join("\n\n")
}

/// Build feedback-injected model content — Doc 09 §4.3.
pub fn build_history_message_with_feedback(content: &str, feedback: Option<&str>) -> String {
    let mut result = content.to_string();
    if let Some(fb) = feedback {
        if !fb.trim().is_empty() {
            result.push_str(&format!("\n\n[WRITER FEEDBACK]\n{}", fb.trim()));
        }
    }
    result
}

// ─── File API Upload ─────────────────────────────────────────────────────────

/// Upload a file to the Gemini File API — Doc 19 §5.1.
/// Returns the `file.uri` string.
pub async fn upload_to_file_api(
    api_key: &str,
    bytes: &[u8],
    mime_type: &str,
    display_name: &str,
) -> Result<String, LoomError> {
    let boundary = format!("loom-upload-{}", uuid::Uuid::new_v4().simple());

    // Build multipart/related body
    let metadata = serde_json::json!({
        "file": {
            "displayName": display_name,
        }
    });
    let metadata_str = metadata.to_string();

    let mut body: Vec<u8> = Vec::new();
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(b"Content-Type: application/json; charset=UTF-8\r\n\r\n");
    body.extend_from_slice(metadata_str.as_bytes());
    body.extend_from_slice(b"\r\n");
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(format!("Content-Type: {}\r\n\r\n", mime_type).as_bytes());
    body.extend_from_slice(bytes);
    body.extend_from_slice(b"\r\n");
    body.extend_from_slice(format!("--{}--\r\n", boundary).as_bytes());

    let url = format!(
        "https://generativelanguage.googleapis.com/upload/v1beta/files?key={}",
        api_key
    );

    let client = Client::new();
    let resp = client
        .post(&url)
        .header("Content-Type", format!("multipart/related; boundary={}", boundary))
        .body(body)
        .send()
        .await
        .map_err(|e| LoomError::ApiRequest(format!("File API upload failed: {}", e)))?;

    let status = resp.status();
    let resp_text: String = resp.text().await
        .map_err(|e| LoomError::ApiRequest(format!("File API read response failed: {}", e)))?;

    if !status.is_success() {
        return Err(LoomError::ApiRequest(format!("File API upload returned {}: {}", status, resp_text)));
    }

    let resp_json: serde_json::Value = serde_json::from_str(&resp_text)
        .map_err(|e| LoomError::ApiRequest(format!("File API invalid JSON: {}", e)))?;

    resp_json["file"]["uri"]
        .as_str()
        .map(|s: &str| s.to_string())
        .ok_or_else(|| LoomError::ApiRequest("File API response missing file.uri".to_string()))
}

/// Data needed to check/upload a file API URI (read from DB before dropping lock).
pub struct FileApiCacheInfo {
    pub item_id: String,
    pub asset_path: String,
    pub mime: String,
    pub cached_uri: Option<String>,
    pub cached_at: Option<String>,
}

/// Read File API cache info from DB for an item. Call this while holding the conn lock,
/// then drop the lock before calling `resolve_file_api_uri`.
pub fn read_file_api_cache_info(
    conn: &rusqlite::Connection,
    item_id: &str,
) -> Result<FileApiCacheInfo, LoomError> {
    let (asset_path, asset_meta, cached_uri, cached_at): (Option<String>, Option<String>, Option<String>, Option<String>) =
        conn.query_row(
            "SELECT asset_path, asset_meta, file_api_uri, file_api_uploaded_at FROM items WHERE id = ?1",
            rusqlite::params![item_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        ).map_err(|_| LoomError::ItemNotFound(item_id.to_string()))?;

    let asset_path = asset_path.ok_or_else(|| {
        LoomError::Validation(format!("Item {} has no asset_path", item_id))
    })?;
    let meta_json = asset_meta.unwrap_or_default();
    let meta: serde_json::Value = serde_json::from_str(&meta_json).unwrap_or_default();
    let mime = meta["mime"].as_str().unwrap_or("application/octet-stream").to_string();

    Ok(FileApiCacheInfo {
        item_id: item_id.to_string(),
        asset_path,
        mime,
        cached_uri,
        cached_at,
    })
}

/// Resolve a File API URI from cached info. If cached and fresh, returns immediately.
/// Otherwise uploads to File API. Does NOT write back to DB — caller must do that.
/// Returns `(uri, mime, needs_db_update)`.
pub async fn resolve_file_api_uri(
    info: &FileApiCacheInfo,
    world_dir: &std::path::Path,
    api_key: &str,
) -> Result<(String, String, bool), LoomError> {
    // Check if cached URI is fresh (< 47 hours old)
    if let (Some(ref uri), Some(ref at)) = (&info.cached_uri, &info.cached_at) {
        if let Ok(uploaded) = chrono::DateTime::parse_from_rfc3339(at) {
            let age = chrono::Utc::now().signed_duration_since(uploaded);
            if age.num_hours() < 47 {
                log::debug!("File API URI cache hit for item {}", info.item_id);
                return Ok((uri.clone(), info.mime.clone(), false));
            }
        }
    }

    // Need to upload (or re-upload)
    let file_path = world_dir.join(&info.asset_path);
    let bytes = std::fs::read(&file_path)
        .map_err(|e| LoomError::Internal(format!("Failed to read asset {}: {}", info.asset_path, e)))?;

    let uri = upload_to_file_api(api_key, &bytes, &info.mime, &info.item_id).await?;
    log::info!("File API URI uploaded for item {}", info.item_id);
    Ok((uri, info.mime.clone(), true))
}

/// Write back a new File API URI to the DB after upload.
pub fn save_file_api_uri(
    conn: &rusqlite::Connection,
    item_id: &str,
    uri: &str,
) -> Result<(), LoomError> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE items SET file_api_uri = ?1, file_api_uploaded_at = ?2 WHERE id = ?3",
        rusqlite::params![uri, now, item_id],
    )?;
    Ok(())
}

/// Default fake-user prompt for Accordion fake-pairs — Doc 18 §1.2.
const ACCORDION_FAKE_USER_DEFAULT: &str =
    "Summarize this chapter: actions, character states, and world state at the end of the chapter.";

/// Apply Accordion substitution to a history of messages — Doc 18 §6.1.
/// Collapsed segments have their messages replaced by a fake user+model pair
/// carrying the summary text.
pub fn build_history_with_accordion(
    branch_messages: &[ChatMessage],
    segments: &[crate::branch::AccordionSegment],
    checkpoints: &[crate::branch::Checkpoint],
    current_leaf_id: &str,
    fake_user_prompt: Option<&str>,
) -> Vec<ChatMessage> {
    use crate::branch::find_collapsed_segment_for_message;

    let fake_prompt = fake_user_prompt.unwrap_or(ACCORDION_FAKE_USER_DEFAULT);
    let mut result: Vec<ChatMessage> = Vec::new();
    let mut injected_seg_ids: std::collections::HashSet<String> = std::collections::HashSet::new();

    for msg in branch_messages {
        if let Some(seg) = find_collapsed_segment_for_message(
            &msg.id, segments, checkpoints, branch_messages, current_leaf_id,
        ) {
            if injected_seg_ids.contains(&seg.id) {
                // Already injected fake-pair for this segment — skip
                continue;
            }
            injected_seg_ids.insert(seg.id.clone());

            // Inject fake-pair
            let now = chrono::Utc::now().to_rfc3339();
            result.push(ChatMessage {
                id: format!("fake-user-{}", seg.id),
                story_id: msg.story_id.clone(),
                parent_id: None,
                role: "user".to_string(),
                content_type: "text".to_string(),
                content: fake_prompt.to_string(),
                token_count: None,
                model_name: None,
                finish_reason: None,
                created_at: now.clone(),
                deleted_at: None,
                user_feedback: None,
                ghostwriter_history: "[]".to_string(),
            });
            result.push(ChatMessage {
                id: format!("fake-model-{}", seg.id),
                story_id: msg.story_id.clone(),
                parent_id: None,
                role: "model".to_string(),
                content_type: "text".to_string(),
                content: seg.summary.clone().unwrap_or_default(),
                token_count: None,
                model_name: None,
                finish_reason: None,
                created_at: now,
                deleted_at: None,
                user_feedback: None,
                ghostwriter_history: "[]".to_string(),
            });
        } else {
            result.push(msg.clone());
        }
    }

    result
}

/// Assemble the complete Gemini API request body.
/// `output_length` is appended to system_instructions when Some and >= 200.
/// `user_turn_parts` and `context_doc_parts` are pre-built JSON Value arrays
/// (text parts, inline_data parts, fileData parts) — Doc 19 PATCH.
pub fn build_gemini_request(
    system_instructions: &str,
    history: &[ChatMessage],
    user_turn_parts: &[serde_json::Value],
    output_length: Option<u32>,
    context_doc_parts: &[serde_json::Value],
) -> serde_json::Value {
    let mut contents = Vec::new();

    // History messages (alternating user/model)
    for msg in history {
        let role = if msg.role == "user" { "user" } else { "model" };
        let text = if msg.role == "user" {
            // Parse stored JSON to reconstruct the turn text
            if msg.content_type == "json_user" {
                match serde_json::from_str::<UserContent>(&msg.content) {
                    Ok(uc) => build_user_turn_text(&uc),
                    Err(_) => msg.content.clone(),
                }
            } else {
                msg.content.clone()
            }
        } else {
            // Model message: inject feedback if present
            build_history_message_with_feedback(&msg.content, msg.user_feedback.as_deref())
        };

        contents.push(serde_json::json!({
            "role": role,
            "parts": [{ "text": text }]
        }));
    }

    // Current user turn: user input parts + context doc parts
    let mut all_parts: Vec<serde_json::Value> = user_turn_parts.to_vec();
    all_parts.extend(context_doc_parts.iter().cloned());

    contents.push(serde_json::json!({
        "role": "user",
        "parts": all_parts
    }));

    let mut body = serde_json::json!({ "contents": contents });

    // System instruction — with optional output length amendment
    let mut sys = system_instructions.trim().to_string();
    if let Some(len) = output_length {
        if len >= 200 {
            if !sys.is_empty() {
                sys.push_str("\n\n");
            }
            sys.push_str(&format!(
                "[OUTPUT LENGTH] write approximately {} words for your next output regardless of the length of other messages",
                len
            ));
        }
    }

    if !sys.is_empty() {
        body["system_instruction"] = serde_json::json!({
            "parts": [{ "text": sys }]
        });
    }

    body
}

// ─── Streaming ───────────────────────────────────────────────────────────────

/// Result from streaming: accumulated content + metadata.
pub struct StreamResult {
    pub content: String,
    pub token_count: Option<i64>,
    pub finish_reason: Option<String>,
}

/// Stream a Gemini generateContent request, emitting chunks via Tauri events.
///
/// Returns the accumulated result. Respects the cancel_rx signal.
pub async fn stream_generate(
    api_key: &str,
    model_name: &str,
    request_body: &serde_json::Value,
    app: &tauri::AppHandle,
    temp_model_id: &str,
    mut cancel_rx: watch::Receiver<bool>,
) -> Result<StreamResult, LoomError> {
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:streamGenerateContent?alt=sse&key={}",
        model_name, api_key
    );

    let client = Client::new();
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(request_body)
        .send()
        .await
        .map_err(|e| LoomError::ApiRequest(format!("Failed to connect to Gemini: {}", e)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(LoomError::ApiRequest(format!(
            "Gemini API returned {}: {}",
            status, body
        )));
    }

    let mut accumulated = String::new();
    let mut token_count: Option<i64> = None;
    let mut finish_reason: Option<String> = None;
    let mut cancelled = false;

    // Read SSE stream line by line
    use futures_util::StreamExt;
    let mut stream = response.bytes_stream();
    let mut line_buf = String::new();

    loop {
        let chunk_opt = tokio::select! {
            biased;
            _ = cancel_rx.changed() => {
                if *cancel_rx.borrow() {
                    cancelled = true;
                    None
                } else {
                    continue;
                }
            }
            chunk = stream.next() => chunk,
        };

        let chunk_result = match chunk_opt {
            Some(r) => r,
            None => break, // stream ended or cancelled
        };

        let bytes = chunk_result
            .map_err(|e| LoomError::ApiRequest(format!("Stream read error: {}", e)))?;

        let text = String::from_utf8_lossy(&bytes);
        line_buf.push_str(&text);

        // Process complete SSE lines
        while let Some(newline_pos) = line_buf.find('\n') {
            let line = line_buf[..newline_pos].trim_end_matches('\r').to_string();
            line_buf = line_buf[newline_pos + 1..].to_string();

            if let Some(data) = line.strip_prefix("data: ") {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                    // Extract text delta
                    if let Some(delta_text) = json
                        .pointer("/candidates/0/content/parts/0/text")
                        .and_then(|v| v.as_str())
                    {
                        accumulated.push_str(delta_text);
                        let _ = app.emit(
                            "stream_chunk",
                            StreamChunk {
                                message_id: temp_model_id.to_string(),
                                delta: delta_text.to_string(),
                            },
                        );
                    }

                    // Extract finish reason
                    if let Some(fr) = json
                        .pointer("/candidates/0/finishReason")
                        .and_then(|v| v.as_str())
                    {
                        finish_reason = Some(fr.to_string());
                    }

                    // Extract token count from usageMetadata
                    if let Some(tc) = json
                        .pointer("/usageMetadata/totalTokenCount")
                        .and_then(|v| v.as_i64())
                    {
                        token_count = Some(tc);
                    }
                }
            }
        }
    }

    if cancelled {
        return Err(LoomError::GenerationCancelled);
    }

    Ok(StreamResult {
        content: accumulated,
        token_count,
        finish_reason,
    })
}

// ─── Ghostwriter (non-streamed) — Doc 16 §3 ─────────────────────────────────

/// Build a Ghostwriter request payload.
/// Uses a custom system prompt with selected_text, instruction, and original_content.
pub fn build_ghostwriter_request(
    system_prompt: &str,
    history: &[ChatMessage],
    selected_text: &str,
    instruction: &str,
    context_before: &str,
    context_after: &str,
) -> serde_json::Value {
    let mut contents = Vec::new();

    // History messages — includes the full conversation up to and including
    // the AI message being edited (provides narrative arc + style context)
    for msg in history {
        let role = if msg.role == "user" { "user" } else { "model" };
        let text = if msg.role == "user" {
            if msg.content_type == "json_user" {
                match serde_json::from_str::<UserContent>(&msg.content) {
                    Ok(uc) => build_user_turn_text(&uc),
                    Err(_) => msg.content.clone(),
                }
            } else {
                msg.content.clone()
            }
        } else {
            build_history_message_with_feedback(&msg.content, msg.user_feedback.as_deref())
        };

        contents.push(serde_json::json!({
            "role": role,
            "parts": [{ "text": text }]
        }));
    }

    // User turn with the tagged editing request.
    // The AI returns ONLY the rewritten selected passage — the frontend stitches it back.
    let user_turn = format!(
        "<context_before>\n{}\n</context_before>\n\n<selected_passage>\n{}\n</selected_passage>\n\n<context_after>\n{}\n</context_after>\n\nInstruction: {}",
        context_before, selected_text, context_after, instruction
    );
    contents.push(serde_json::json!({
        "role": "user",
        "parts": [{ "text": user_turn }]
    }));

    let mut body = serde_json::json!({ "contents": contents });

    if !system_prompt.is_empty() {
        body["system_instruction"] = serde_json::json!({
            "parts": [{ "text": system_prompt }]
        });
    }

    body
}

/// Non-streaming Gemini generate call for Ghostwriter.
/// Returns the complete response text and token count.
pub async fn generate_non_streaming(
    api_key: &str,
    model_name: &str,
    request_body: &serde_json::Value,
) -> Result<(String, Option<i64>), LoomError> {
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
        model_name, api_key
    );

    let client = Client::new();
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(request_body)
        .send()
        .await
        .map_err(|e| LoomError::ApiRequest(format!("Failed to connect to Gemini: {}", e)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(LoomError::ApiRequest(format!(
            "Gemini API returned {}: {}",
            status, body
        )));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| LoomError::ApiRequest(format!("Failed to parse Gemini response: {}", e)))?;

    let content = json
        .pointer("/candidates/0/content/parts/0/text")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let token_count = json
        .pointer("/usageMetadata/totalTokenCount")
        .and_then(|v| v.as_i64());

    Ok((content, token_count))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_user_turn_text_full() {
        let uc = UserContent {
            plot_direction: "She opens the letter.".to_string(),
            background_information: "The letter is from her dead mother.".to_string(),
            modificators: vec!["dark".to_string(), "slow burn".to_string()],
            constraints: String::new(),
            output_length: None,
            context_doc_names: vec![],
            image_blocks: vec![],
        };
        let result = build_user_turn_text(&uc);
        assert!(result.contains("[PLOT DIRECTION]\nShe opens the letter."));
        assert!(result.contains("[BACKGROUND INFORMATION — NOT FOR THE READER]"));
        assert!(result.contains("[MODIFICATORS]\ndark · slow burn"));
        // output_length should NOT appear in user turn text
        assert!(!result.contains("[OUTPUT LENGTH]"));
    }

    #[test]
    fn test_build_user_turn_text_minimal() {
        let uc = UserContent {
            plot_direction: "Continue the story.".to_string(),
            background_information: String::new(),
            modificators: vec![],
            constraints: String::new(),
            output_length: None,
            context_doc_names: vec![],
            image_blocks: vec![],
        };
        let result = build_user_turn_text(&uc);
        assert_eq!(result, "[PLOT DIRECTION]\nContinue the story.");
    }

    #[test]
    fn test_build_user_turn_text_with_constraints() {
        let uc = UserContent {
            plot_direction: "Continue.".to_string(),
            background_information: String::new(),
            modificators: vec![],
            constraints: "No dialogue.".to_string(),
            output_length: Some(500),
            context_doc_names: vec![],
            image_blocks: vec![],
        };
        let result = build_user_turn_text(&uc);
        assert!(result.contains("[CONSTRAINTS — DO NOT INCLUDE IN OUTPUT]\nNo dialogue."));
        // output_length must NOT be in user turn — it goes in system instructions
        assert!(!result.contains("[OUTPUT LENGTH]"));
        assert!(!result.contains("500"));
    }

    #[test]
    fn test_feedback_injection() {
        let result =
            build_history_message_with_feedback("The sun set slowly.", Some("Too rushed."));
        assert!(result.contains("[WRITER FEEDBACK]\nToo rushed."));
    }

    #[test]
    fn test_feedback_injection_empty() {
        let result = build_history_message_with_feedback("Content here.", Some("  "));
        assert!(!result.contains("[WRITER FEEDBACK]"));
    }
}
